-- =============================================================================
-- LIFEGUARD Core — Phase 14-7 Real policy embedding execution integration (ONE-TIME)
-- Thin wrapper connecting real-policy preparation runs to generic execution infra.
-- Run after phase14_real_policy_embedding_preparation_foundation.sql. Does NOT modify 001–012.
-- Reuses policy_embedding_execution_* and policy_embedding_queue — no duplicate engine.
-- No external embedding APIs or fake vectors.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Real policy embedding execution status helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_real_policy_embedding_execution_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['pending', 'processing', 'completed', 'failed', 'partial']::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_real_policy_embedding_execution_item_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['pending', 'processing', 'embedded', 'failed', 'skipped']::TEXT[];
$$;

-- ---------------------------------------------------------------------------
-- real_policy_embedding_execution_runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.real_policy_embedding_execution_runs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  real_embedding_preparation_run_id UUID NOT NULL REFERENCES public.real_policy_embedding_preparation_runs (id) ON DELETE CASCADE,
  embedding_execution_run_id  UUID NOT NULL REFERENCES public.policy_embedding_execution_runs (id) ON DELETE CASCADE,
  rag_source_id               UUID NOT NULL REFERENCES public.policy_rag_source_registry (id) ON DELETE CASCADE,
  embedding_provider          TEXT NOT NULL,
  embedding_model             TEXT NOT NULL,
  execution_status            TEXT NOT NULL DEFAULT 'pending'
                              CHECK (execution_status = ANY (public.lifeguard_real_policy_embedding_execution_statuses())),
  queued_chunk_count          INTEGER NOT NULL DEFAULT 0 CHECK (queued_chunk_count >= 0),
  processed_chunk_count       INTEGER NOT NULL DEFAULT 0 CHECK (processed_chunk_count >= 0),
  failed_chunk_count          INTEGER NOT NULL DEFAULT 0 CHECK (failed_chunk_count >= 0),
  execution_context           JSONB NOT NULL DEFAULT '{}'::JSONB,
  missing_information         JSONB NOT NULL DEFAULT '[]'::JSONB,
  error_message               TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at                TIMESTAMPTZ,
  initiated_by                UUID REFERENCES public.users (id) ON DELETE SET NULL,
  engine_ref                  TEXT NOT NULL DEFAULT 'lifeguard_prepare_real_policy_embedding_execution'
);

COMMENT ON TABLE public.real_policy_embedding_execution_runs IS
  'Real policy embedding execution wrapper runs; links prep to generic execution — no API calls.';

-- ---------------------------------------------------------------------------
-- real_policy_embedding_execution_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.real_policy_embedding_execution_items (
  id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  real_policy_embedding_execution_run_id UUID NOT NULL REFERENCES public.real_policy_embedding_execution_runs (id) ON DELETE CASCADE,
  real_embedding_preparation_item_id  UUID NOT NULL REFERENCES public.real_policy_embedding_preparation_items (id) ON DELETE CASCADE,
  real_policy_chunk_item_id           UUID NOT NULL REFERENCES public.real_policy_chunk_items (id) ON DELETE CASCADE,
  embedding_queue_id                UUID NOT NULL REFERENCES public.policy_embedding_queue (id) ON DELETE CASCADE,
  embedding_execution_item_id         UUID NOT NULL REFERENCES public.policy_embedding_execution_items (id) ON DELETE CASCADE,
  chunk_registry_id                 UUID NOT NULL REFERENCES public.policy_chunk_registry (id) ON DELETE CASCADE,
  item_status                       TEXT NOT NULL DEFAULT 'pending'
                                    CHECK (item_status = ANY (public.lifeguard_real_policy_embedding_execution_item_statuses())),
  vector_reference                  TEXT,
  error_message                     TEXT,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at                      TIMESTAMPTZ,
  CONSTRAINT real_policy_embedding_execution_items_run_prep_unique
    UNIQUE (real_policy_embedding_execution_run_id, real_embedding_preparation_item_id)
);

COMMENT ON TABLE public.real_policy_embedding_execution_items IS
  'Real policy embedding execution wrapper items; vector references only — no raw arrays.';

CREATE INDEX IF NOT EXISTS real_policy_embedding_execution_runs_prep_idx
  ON public.real_policy_embedding_execution_runs (real_embedding_preparation_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS real_policy_embedding_execution_runs_status_idx
  ON public.real_policy_embedding_execution_runs (execution_status, created_at DESC);

CREATE INDEX IF NOT EXISTS real_policy_embedding_execution_items_run_idx
  ON public.real_policy_embedding_execution_items (real_policy_embedding_execution_run_id, item_status);

-- ---------------------------------------------------------------------------
-- Prepare scoped real policy embedding execution
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_prepare_real_policy_embedding_execution(
  p_real_embedding_preparation_run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_prepare_real_policy_embedding_execution$
DECLARE
  v_wrapper_run_id        UUID;
  v_generic_run_id        UUID;
  v_user_id               UUID;
  v_missing               JSONB := '[]'::JSONB;
  v_execution_status      TEXT := 'pending';
  v_queued_count          INTEGER := 0;
  v_prep_status           TEXT;
  v_rag_source_id         UUID;
  v_provider              TEXT;
  v_model                 TEXT;
  v_generic_item_id       UUID;
  v_rec                   RECORD;
BEGIN
  IF NOT public.lifeguard_is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_real_embedding_preparation_run_id IS NULL THEN
    RAISE EXCEPTION 'real_embedding_preparation_run_id_required';
  END IF;

  SELECT
    pr.preparation_status,
    pr.rag_source_id,
    pr.embedding_provider,
    pr.embedding_model
  INTO v_prep_status, v_rag_source_id, v_provider, v_model
  FROM public.real_policy_embedding_preparation_runs pr
  WHERE pr.id = p_real_embedding_preparation_run_id;

  IF v_prep_status IS NULL THEN
    v_missing := v_missing || jsonb_build_array('preparation_run_not_found');
    RAISE EXCEPTION 'preparation_run_not_found';
  END IF;

  IF v_prep_status NOT IN ('completed', 'partial', 'queued') THEN
    v_missing := v_missing || jsonb_build_array('preparation_run_not_ready');
    RAISE EXCEPTION 'preparation_run_not_ready';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_queued_count
  FROM public.real_policy_embedding_preparation_items pi
  INNER JOIN public.policy_embedding_queue eq
    ON eq.id = pi.embedding_queue_id
   AND eq.embedding_status = 'queued'
  INNER JOIN public.policy_chunk_registry cr
    ON cr.id = pi.chunk_registry_id
   AND cr.chunk_status = 'approved'
   AND cr.rag_source_id = v_rag_source_id
  WHERE pi.real_embedding_preparation_run_id = p_real_embedding_preparation_run_id
    AND pi.item_status = 'queued'
    AND pi.embedding_queue_id IS NOT NULL
    AND pi.chunk_registry_id IS NOT NULL;

  IF v_queued_count = 0 THEN
    v_missing := v_missing || jsonb_build_array('no_queued_preparation_items');
    v_execution_status := 'failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.real_policy_embedding_execution_runs er
    WHERE er.real_embedding_preparation_run_id = p_real_embedding_preparation_run_id
      AND er.execution_status IN ('pending', 'processing', 'partial')
  ) THEN
    v_missing := v_missing || jsonb_build_array('active_execution_run_exists');
    RAISE EXCEPTION 'active_execution_run_exists';
  END IF;

  v_user_id := auth.uid();

  INSERT INTO public.policy_embedding_execution_runs (
    embedding_provider,
    embedding_model,
    execution_status,
    queued_count,
    execution_context,
    initiated_by
  )
  VALUES (
    v_provider,
    v_model,
    CASE WHEN v_queued_count = 0 THEN 'failed' ELSE 'pending' END,
    v_queued_count,
    jsonb_build_object(
      'real_embedding_preparation_run_id', p_real_embedding_preparation_run_id,
      'rag_source_id', v_rag_source_id,
      'scoped_preparation_only', TRUE,
      'no_global_queue_scan', TRUE,
      'no_external_api', TRUE,
      'no_fake_vectors', TRUE,
      'prepared_at', NOW()
    ),
    v_user_id
  )
  RETURNING id INTO v_generic_run_id;

  INSERT INTO public.real_policy_embedding_execution_runs (
    real_embedding_preparation_run_id,
    embedding_execution_run_id,
    rag_source_id,
    embedding_provider,
    embedding_model,
    execution_status,
    queued_chunk_count,
    execution_context,
    missing_information,
    error_message,
    initiated_by
  )
  VALUES (
    p_real_embedding_preparation_run_id,
    v_generic_run_id,
    v_rag_source_id,
    v_provider,
    v_model,
    v_execution_status,
    v_queued_count,
    jsonb_build_object(
      'real_embedding_preparation_run_id', p_real_embedding_preparation_run_id,
      'embedding_execution_run_id', v_generic_run_id,
      'rag_source_id', v_rag_source_id,
      'integration_only', TRUE,
      'no_external_api', TRUE,
      'registered_at', NOW()
    ),
    v_missing,
    CASE WHEN v_execution_status = 'failed' THEN 'no_queued_preparation_items' ELSE NULL END,
    v_user_id
  )
  RETURNING id INTO v_wrapper_run_id;

  IF v_queued_count = 0 THEN
    RETURN jsonb_build_object(
      'real_policy_embedding_execution_run_id', v_wrapper_run_id,
      'embedding_execution_run_id', v_generic_run_id,
      'queued_chunk_count', 0,
      'execution_status', v_execution_status,
      'missing_information', v_missing,
      'created_at', NOW()
    );
  END IF;

  UPDATE public.real_policy_embedding_execution_runs
  SET execution_status = 'processing'
  WHERE id = v_wrapper_run_id;

  v_execution_status := 'processing';
  v_queued_count := 0;

  FOR v_rec IN
    SELECT
      pi.id AS real_embedding_preparation_item_id,
      pi.real_policy_chunk_item_id,
      pi.embedding_queue_id,
      pi.chunk_registry_id
    FROM public.real_policy_embedding_preparation_items pi
    INNER JOIN public.policy_embedding_queue eq
      ON eq.id = pi.embedding_queue_id
     AND eq.embedding_status = 'queued'
    INNER JOIN public.policy_chunk_registry cr
      ON cr.id = pi.chunk_registry_id
     AND cr.chunk_status = 'approved'
     AND cr.rag_source_id = v_rag_source_id
    WHERE pi.real_embedding_preparation_run_id = p_real_embedding_preparation_run_id
      AND pi.item_status = 'queued'
      AND pi.embedding_queue_id IS NOT NULL
      AND pi.chunk_registry_id IS NOT NULL
    ORDER BY pi.created_at ASC
  LOOP
    INSERT INTO public.policy_embedding_execution_items (
      embedding_execution_run_id,
      embedding_queue_id,
      chunk_registry_id,
      execution_status
    )
    VALUES (
      v_generic_run_id,
      v_rec.embedding_queue_id,
      v_rec.chunk_registry_id,
      'pending'
    )
    ON CONFLICT (embedding_queue_id) DO NOTHING
    RETURNING id INTO v_generic_item_id;

    IF v_generic_item_id IS NULL THEN
      SELECT ei.id INTO v_generic_item_id
      FROM public.policy_embedding_execution_items ei
      WHERE ei.embedding_queue_id = v_rec.embedding_queue_id
      ORDER BY ei.created_at DESC
      LIMIT 1;
    END IF;

    IF v_generic_item_id IS NULL THEN
      v_missing := v_missing || jsonb_build_array('execution_item_create_failed');
      CONTINUE;
    END IF;

    UPDATE public.policy_embedding_queue
    SET embedding_status = 'processing',
        embedding_provider = v_provider,
        embedding_model = v_model
    WHERE id = v_rec.embedding_queue_id
      AND embedding_status = 'queued';

    INSERT INTO public.real_policy_embedding_execution_items (
      real_policy_embedding_execution_run_id,
      real_embedding_preparation_item_id,
      real_policy_chunk_item_id,
      embedding_queue_id,
      embedding_execution_item_id,
      chunk_registry_id,
      item_status
    )
    VALUES (
      v_wrapper_run_id,
      v_rec.real_embedding_preparation_item_id,
      v_rec.real_policy_chunk_item_id,
      v_rec.embedding_queue_id,
      v_generic_item_id,
      v_rec.chunk_registry_id,
      'pending'
    )
    ON CONFLICT (real_policy_embedding_execution_run_id, real_embedding_preparation_item_id) DO UPDATE
    SET embedding_execution_item_id = EXCLUDED.embedding_execution_item_id,
        item_status = 'pending';

    v_queued_count := v_queued_count + 1;
  END LOOP;

  IF v_queued_count = 0 THEN
    v_execution_status := 'failed';
    v_missing := v_missing || jsonb_build_array('no_execution_items_created');

    UPDATE public.policy_embedding_execution_runs
    SET execution_status = 'failed',
        queued_count = 0,
        error_message = 'no_execution_items_created'
    WHERE id = v_generic_run_id;
  ELSE
    v_execution_status := 'processing';

    UPDATE public.policy_embedding_execution_runs
    SET execution_status = 'pending',
        queued_count = v_queued_count
    WHERE id = v_generic_run_id;
  END IF;

  UPDATE public.real_policy_embedding_execution_runs
  SET execution_status = v_execution_status,
      queued_chunk_count = v_queued_count,
      missing_information = missing_information || v_missing,
      error_message = CASE WHEN v_execution_status = 'failed' THEN 'embedding_execution_preparation_failed' ELSE NULL END,
      execution_context = execution_context || jsonb_build_object(
        'queued_chunk_count', v_queued_count,
        'embedding_execution_run_id', v_generic_run_id,
        'prepared_at', NOW()
      )
  WHERE id = v_wrapper_run_id;

  RETURN jsonb_build_object(
    'real_policy_embedding_execution_run_id', v_wrapper_run_id,
    'embedding_execution_run_id', v_generic_run_id,
    'queued_chunk_count', v_queued_count,
    'execution_status', v_execution_status,
    'missing_information', v_missing,
    'integration_only', TRUE,
    'no_external_api', TRUE,
    'created_at', NOW()
  );
END;
$lifeguard_prepare_real_policy_embedding_execution$;

COMMENT ON FUNCTION public.lifeguard_prepare_real_policy_embedding_execution IS
  'Admin: prepare scoped real policy embedding execution from preparation run only — no global queue scan.';

-- ---------------------------------------------------------------------------
-- Store scoped real policy embedding execution result
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_store_real_policy_embedding_execution_result(
  p_real_policy_embedding_execution_item_id UUID,
  p_vector_reference                      TEXT DEFAULT NULL,
  p_item_status                           TEXT DEFAULT NULL,
  p_error_message                         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_store_real_policy_embedding_execution_result$
DECLARE
  v_missing                 JSONB := '[]'::JSONB;
  v_item_status             TEXT;
  v_wrapper_run_id          UUID;
  v_execution_item_id       UUID;
  v_store_result            JSONB;
  v_processed_count         INTEGER := 0;
  v_failed_count            INTEGER := 0;
  v_pending_count           INTEGER := 0;
  v_run_status              TEXT;
BEGIN
  IF NOT public.lifeguard_is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_real_policy_embedding_execution_item_id IS NULL THEN
    RAISE EXCEPTION 'real_policy_embedding_execution_item_id_required';
  END IF;

  IF p_item_status IS NULL OR length(trim(p_item_status)) = 0 THEN
    RAISE EXCEPTION 'item_status_required';
  END IF;

  IF NOT (trim(p_item_status) = ANY (public.lifeguard_real_policy_embedding_execution_item_statuses())) THEN
    RAISE EXCEPTION 'invalid_item_status';
  END IF;

  SELECT
    wi.real_policy_embedding_execution_run_id,
    wi.embedding_execution_item_id
  INTO v_wrapper_run_id, v_execution_item_id
  FROM public.real_policy_embedding_execution_items wi
  WHERE wi.id = p_real_policy_embedding_execution_item_id;

  IF v_wrapper_run_id IS NULL THEN
    v_missing := v_missing || jsonb_build_array('execution_item_not_found');
    RAISE EXCEPTION 'execution_item_not_found';
  END IF;

  v_item_status := trim(p_item_status);

  IF v_item_status = 'embedded' AND (p_vector_reference IS NULL OR length(trim(p_vector_reference)) = 0) THEN
    v_missing := v_missing || jsonb_build_array('vector_reference_required');
    RAISE EXCEPTION 'vector_reference_required';
  END IF;

  IF v_item_status IN ('embedded', 'failed', 'skipped') THEN
    v_store_result := public.lifeguard_store_embedding_execution_result(
      v_execution_item_id,
      p_vector_reference,
      v_item_status,
      p_error_message
    );
  END IF;

  UPDATE public.real_policy_embedding_execution_items
  SET item_status = v_item_status,
      vector_reference = NULLIF(trim(p_vector_reference), ''),
      error_message = NULLIF(trim(p_error_message), ''),
      completed_at = CASE
        WHEN v_item_status IN ('embedded', 'failed', 'skipped') THEN NOW()
        ELSE completed_at
      END
  WHERE id = p_real_policy_embedding_execution_item_id;

  SELECT
    COUNT(*) FILTER (WHERE item_status = 'embedded')::INTEGER,
    COUNT(*) FILTER (WHERE item_status IN ('failed', 'skipped'))::INTEGER,
    COUNT(*) FILTER (WHERE item_status IN ('pending', 'processing'))::INTEGER
  INTO v_processed_count, v_failed_count, v_pending_count
  FROM public.real_policy_embedding_execution_items
  WHERE real_policy_embedding_execution_run_id = v_wrapper_run_id;

  IF v_pending_count > 0 THEN
    v_run_status := 'processing';
  ELSIF v_processed_count > 0 AND v_failed_count > 0 THEN
    v_run_status := 'partial';
  ELSIF v_processed_count > 0 THEN
    v_run_status := 'completed';
  ELSE
    v_run_status := 'failed';
  END IF;

  UPDATE public.real_policy_embedding_execution_runs
  SET execution_status = v_run_status,
      processed_chunk_count = v_processed_count,
      failed_chunk_count = v_failed_count,
      completed_at = CASE
        WHEN v_run_status IN ('completed', 'failed', 'partial') THEN NOW()
        ELSE completed_at
      END,
      error_message = CASE WHEN v_run_status = 'failed' THEN COALESCE(NULLIF(trim(p_error_message), ''), error_message) ELSE error_message END,
      execution_context = execution_context || jsonb_build_object(
        'processed_chunk_count', v_processed_count,
        'failed_chunk_count', v_failed_count,
        'last_item_status', v_item_status,
        'stored_at', NOW()
      )
  WHERE id = v_wrapper_run_id;

  RETURN jsonb_build_object(
    'real_policy_embedding_execution_item_id', p_real_policy_embedding_execution_item_id,
    'real_policy_embedding_execution_run_id', v_wrapper_run_id,
    'item_status', v_item_status,
    'vector_reference', NULLIF(trim(p_vector_reference), ''),
    'execution_status', v_run_status,
    'processed_chunk_count', v_processed_count,
    'failed_chunk_count', v_failed_count,
    'missing_information', v_missing,
    'reference_only', TRUE,
    'stored_at', NOW()
  );
END;
$lifeguard_store_real_policy_embedding_execution_result$;

COMMENT ON FUNCTION public.lifeguard_store_real_policy_embedding_execution_result IS
  'Admin: store real policy embedding execution result via generic delegate — reference only.';

-- ---------------------------------------------------------------------------
-- Row Level Security — admin only
-- ---------------------------------------------------------------------------
ALTER TABLE public.real_policy_embedding_execution_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.real_policy_embedding_execution_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.real_policy_embedding_execution_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.real_policy_embedding_execution_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lg_real_policy_embedding_execution_runs_admin_select ON public.real_policy_embedding_execution_runs;
CREATE POLICY lg_real_policy_embedding_execution_runs_admin_select ON public.real_policy_embedding_execution_runs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_embedding_execution_runs_admin_insert ON public.real_policy_embedding_execution_runs;
CREATE POLICY lg_real_policy_embedding_execution_runs_admin_insert ON public.real_policy_embedding_execution_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_embedding_execution_runs_admin_update ON public.real_policy_embedding_execution_runs;
CREATE POLICY lg_real_policy_embedding_execution_runs_admin_update ON public.real_policy_embedding_execution_runs
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_embedding_execution_items_admin_select ON public.real_policy_embedding_execution_items;
CREATE POLICY lg_real_policy_embedding_execution_items_admin_select ON public.real_policy_embedding_execution_items
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_embedding_execution_items_admin_insert ON public.real_policy_embedding_execution_items;
CREATE POLICY lg_real_policy_embedding_execution_items_admin_insert ON public.real_policy_embedding_execution_items
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_embedding_execution_items_admin_update ON public.real_policy_embedding_execution_items;
CREATE POLICY lg_real_policy_embedding_execution_items_admin_update ON public.real_policy_embedding_execution_items
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());
