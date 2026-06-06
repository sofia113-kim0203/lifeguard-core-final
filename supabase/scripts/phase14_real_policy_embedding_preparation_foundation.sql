-- =============================================================================
-- LIFEGUARD Core — Phase 14-6 Real policy embedding preparation foundation (ONE-TIME)
-- Prepare approved real policy chunks for embedding queue workflow.
-- Run after phase14_real_policy_chunk_generation_foundation.sql. Does NOT modify 001–012.
-- No external embedding APIs, generated embeddings, or fake vectors.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Real policy embedding preparation status helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_real_policy_embedding_preparation_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['pending', 'processing', 'queued', 'completed', 'failed', 'partial']::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_real_policy_embedding_preparation_item_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['pending', 'queued', 'skipped', 'failed']::TEXT[];
$$;

-- ---------------------------------------------------------------------------
-- real_policy_embedding_preparation_runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.real_policy_embedding_preparation_runs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  real_chunk_generation_run_id UUID NOT NULL REFERENCES public.real_policy_chunk_generation_runs (id) ON DELETE CASCADE,
  rag_source_id               UUID NOT NULL REFERENCES public.policy_rag_source_registry (id) ON DELETE CASCADE,
  embedding_provider          TEXT NOT NULL,
  embedding_model             TEXT NOT NULL,
  preparation_status          TEXT NOT NULL DEFAULT 'pending'
                              CHECK (preparation_status = ANY (public.lifeguard_real_policy_embedding_preparation_statuses())),
  approved_chunk_count        INTEGER NOT NULL DEFAULT 0 CHECK (approved_chunk_count >= 0),
  queued_chunk_count          INTEGER NOT NULL DEFAULT 0 CHECK (queued_chunk_count >= 0),
  skipped_chunk_count         INTEGER NOT NULL DEFAULT 0 CHECK (skipped_chunk_count >= 0),
  preparation_context         JSONB NOT NULL DEFAULT '{}'::JSONB,
  missing_information         JSONB NOT NULL DEFAULT '[]'::JSONB,
  error_message               TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at                TIMESTAMPTZ,
  initiated_by                UUID REFERENCES public.users (id) ON DELETE SET NULL,
  engine_ref                  TEXT NOT NULL DEFAULT 'lifeguard_prepare_real_policy_embedding'
);

COMMENT ON TABLE public.real_policy_embedding_preparation_runs IS
  'Real policy embedding preparation runs; approved chunks to queue only — no API calls.';

-- ---------------------------------------------------------------------------
-- real_policy_embedding_preparation_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.real_policy_embedding_preparation_items (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  real_embedding_preparation_run_id UUID NOT NULL REFERENCES public.real_policy_embedding_preparation_runs (id) ON DELETE CASCADE,
  real_policy_chunk_item_id       UUID NOT NULL REFERENCES public.real_policy_chunk_items (id) ON DELETE CASCADE,
  chunk_registry_id               UUID REFERENCES public.policy_chunk_registry (id) ON DELETE SET NULL,
  embedding_queue_id              UUID REFERENCES public.policy_embedding_queue (id) ON DELETE SET NULL,
  item_status                     TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (item_status = ANY (public.lifeguard_real_policy_embedding_preparation_item_statuses())),
  missing_information             JSONB NOT NULL DEFAULT '[]'::JSONB,
  error_message                   TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT real_policy_embedding_preparation_items_run_chunk_unique
    UNIQUE (real_embedding_preparation_run_id, real_policy_chunk_item_id)
);

COMMENT ON TABLE public.real_policy_embedding_preparation_items IS
  'Real policy embedding preparation items; queue tracking only — no vector values.';

CREATE INDEX IF NOT EXISTS real_policy_embedding_preparation_runs_chunk_gen_idx
  ON public.real_policy_embedding_preparation_runs (real_chunk_generation_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS real_policy_embedding_preparation_runs_status_idx
  ON public.real_policy_embedding_preparation_runs (preparation_status, created_at DESC);

CREATE INDEX IF NOT EXISTS real_policy_embedding_preparation_items_run_idx
  ON public.real_policy_embedding_preparation_items (real_embedding_preparation_run_id, item_status);

-- ---------------------------------------------------------------------------
-- Prepare real policy embedding (approved chunks → queue only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_prepare_real_policy_embedding(
  p_real_chunk_generation_run_id UUID,
  p_rag_source_id                UUID,
  p_embedding_provider           TEXT,
  p_embedding_model              TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_prepare_real_policy_embedding$
DECLARE
  v_run_id              UUID;
  v_user_id             UUID;
  v_missing             JSONB := '[]'::JSONB;
  v_preparation_status  TEXT := 'pending';
  v_approved_count      INTEGER := 0;
  v_queued_count        INTEGER := 0;
  v_skipped_count       INTEGER := 0;
  v_generation_status   TEXT;
  v_queue_id            UUID;
  v_item_missing        JSONB;
  v_item_status         TEXT;
  v_rec                 RECORD;
BEGIN
  IF NOT public.lifeguard_is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_real_chunk_generation_run_id IS NULL THEN
    RAISE EXCEPTION 'real_chunk_generation_run_id_required';
  END IF;

  IF p_rag_source_id IS NULL THEN
    RAISE EXCEPTION 'rag_source_id_required';
  END IF;

  IF p_embedding_provider IS NULL OR length(trim(p_embedding_provider)) = 0 THEN
    RAISE EXCEPTION 'embedding_provider_required';
  END IF;

  IF p_embedding_model IS NULL OR length(trim(p_embedding_model)) = 0 THEN
    RAISE EXCEPTION 'embedding_model_required';
  END IF;

  SELECT cgr.generation_status
  INTO v_generation_status
  FROM public.real_policy_chunk_generation_runs cgr
  WHERE cgr.id = p_real_chunk_generation_run_id;

  IF v_generation_status IS NULL THEN
    v_missing := v_missing || jsonb_build_array('chunk_generation_run_not_found');
    RAISE EXCEPTION 'chunk_generation_run_not_found';
  END IF;

  IF v_generation_status <> 'completed' THEN
    v_missing := v_missing || jsonb_build_array('chunk_generation_not_completed');
    RAISE EXCEPTION 'chunk_generation_not_completed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.policy_rag_source_registry reg
    WHERE reg.id = p_rag_source_id
  ) THEN
    v_missing := v_missing || jsonb_build_array('rag_source_not_found');
    RAISE EXCEPTION 'rag_source_not_found';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_approved_count
  FROM public.real_policy_chunk_items rci
  INNER JOIN public.policy_chunk_registry cr
    ON cr.id = rci.chunk_registry_id
  WHERE rci.real_chunk_generation_run_id = p_real_chunk_generation_run_id
    AND rci.chunk_status = 'approved'
    AND cr.chunk_status = 'approved'
    AND cr.rag_source_id = p_rag_source_id
    AND rci.chunk_registry_id IS NOT NULL;

  IF v_approved_count = 0 THEN
    v_missing := v_missing || jsonb_build_array('no_approved_chunks');
    v_preparation_status := 'failed';
  END IF;

  v_user_id := auth.uid();

  INSERT INTO public.real_policy_embedding_preparation_runs (
    real_chunk_generation_run_id,
    rag_source_id,
    embedding_provider,
    embedding_model,
    preparation_status,
    approved_chunk_count,
    preparation_context,
    missing_information,
    error_message,
    initiated_by
  )
  VALUES (
    p_real_chunk_generation_run_id,
    p_rag_source_id,
    trim(p_embedding_provider),
    trim(p_embedding_model),
    v_preparation_status,
    v_approved_count,
    jsonb_build_object(
      'real_chunk_generation_run_id', p_real_chunk_generation_run_id,
      'rag_source_id', p_rag_source_id,
      'embedding_provider', trim(p_embedding_provider),
      'embedding_model', trim(p_embedding_model),
      'preparation_only', TRUE,
      'no_external_api', TRUE,
      'no_fake_vectors', TRUE,
      'registered_at', NOW()
    ),
    v_missing,
    CASE WHEN v_preparation_status = 'failed' THEN 'no_approved_chunks' ELSE NULL END,
    v_user_id
  )
  RETURNING id INTO v_run_id;

  IF v_approved_count = 0 THEN
    RETURN jsonb_build_object(
      'real_embedding_preparation_run_id', v_run_id,
      'approved_chunk_count', v_approved_count,
      'queued_chunk_count', 0,
      'skipped_chunk_count', 0,
      'preparation_status', v_preparation_status,
      'missing_information', v_missing,
      'created_at', NOW()
    );
  END IF;

  UPDATE public.real_policy_embedding_preparation_runs
  SET preparation_status = 'processing'
  WHERE id = v_run_id;

  v_preparation_status := 'processing';

  FOR v_rec IN
    SELECT
      rci.id AS real_policy_chunk_item_id,
      rci.chunk_registry_id,
      rci.chunk_sequence,
      rci.source_reference,
      rci.chunk_status AS item_chunk_status,
      cr.chunk_status AS registry_chunk_status,
      cr.rag_source_id
    FROM public.real_policy_chunk_items rci
    LEFT JOIN public.policy_chunk_registry cr
      ON cr.id = rci.chunk_registry_id
    WHERE rci.real_chunk_generation_run_id = p_real_chunk_generation_run_id
    ORDER BY rci.chunk_sequence ASC
  LOOP
    v_item_missing := '[]'::JSONB;
    v_item_status := 'pending';
    v_queue_id := NULL;

    IF v_rec.chunk_registry_id IS NULL THEN
      v_item_status := 'skipped';
      v_item_missing := v_item_missing || jsonb_build_array('chunk_registry_missing');
      v_skipped_count := v_skipped_count + 1;
    ELSIF v_rec.item_chunk_status <> 'approved' OR v_rec.registry_chunk_status <> 'approved' THEN
      v_item_status := 'skipped';
      v_item_missing := v_item_missing || jsonb_build_array('chunk_not_approved');
      v_skipped_count := v_skipped_count + 1;
    ELSIF v_rec.rag_source_id IS DISTINCT FROM p_rag_source_id THEN
      v_item_status := 'skipped';
      v_item_missing := v_item_missing || jsonb_build_array('rag_source_mismatch');
      v_skipped_count := v_skipped_count + 1;
    ELSIF EXISTS (
      SELECT 1 FROM public.policy_embedding_queue eq
      WHERE eq.chunk_registry_id = v_rec.chunk_registry_id
        AND eq.embedding_status IN ('queued', 'processing', 'embedded')
    ) THEN
      v_item_status := 'skipped';
      v_item_missing := v_item_missing || jsonb_build_array('already_queued');
      v_skipped_count := v_skipped_count + 1;

      SELECT eq.id INTO v_queue_id
      FROM public.policy_embedding_queue eq
      WHERE eq.chunk_registry_id = v_rec.chunk_registry_id
      ORDER BY eq.created_at DESC
      LIMIT 1;
    ELSE
      INSERT INTO public.policy_embedding_queue (
        chunk_registry_id,
        rag_source_id,
        embedding_status,
        embedding_provider,
        embedding_model,
        queue_context,
        initiated_by
      )
      VALUES (
        v_rec.chunk_registry_id,
        p_rag_source_id,
        'queued',
        trim(p_embedding_provider),
        trim(p_embedding_model),
        jsonb_build_object(
          'real_chunk_generation_run_id', p_real_chunk_generation_run_id,
          'real_policy_chunk_item_id', v_rec.real_policy_chunk_item_id,
          'chunk_sequence', v_rec.chunk_sequence,
          'source_reference', v_rec.source_reference,
          'preparation_only', TRUE,
          'no_external_api', TRUE,
          'no_fake_vectors', TRUE,
          'queued_at', NOW()
        ),
        v_user_id
      )
      ON CONFLICT (chunk_registry_id) DO UPDATE
      SET embedding_status = 'queued',
          rag_source_id = EXCLUDED.rag_source_id,
          embedding_provider = EXCLUDED.embedding_provider,
          embedding_model = EXCLUDED.embedding_model,
          queue_context = EXCLUDED.queue_context,
          error_message = NULL,
          processed_at = NULL
      WHERE public.policy_embedding_queue.embedding_status IN ('failed', 'skipped')
      RETURNING id INTO v_queue_id;

      IF v_queue_id IS NOT NULL THEN
        v_item_status := 'queued';
        v_queued_count := v_queued_count + 1;
      ELSE
        v_item_status := 'skipped';
        v_item_missing := v_item_missing || jsonb_build_array('queue_insert_skipped');
        v_skipped_count := v_skipped_count + 1;
      END IF;
    END IF;

    INSERT INTO public.real_policy_embedding_preparation_items (
      real_embedding_preparation_run_id,
      real_policy_chunk_item_id,
      chunk_registry_id,
      embedding_queue_id,
      item_status,
      missing_information
    )
    VALUES (
      v_run_id,
      v_rec.real_policy_chunk_item_id,
      v_rec.chunk_registry_id,
      v_queue_id,
      v_item_status,
      v_item_missing
    )
    ON CONFLICT (real_embedding_preparation_run_id, real_policy_chunk_item_id) DO UPDATE
    SET chunk_registry_id = EXCLUDED.chunk_registry_id,
        embedding_queue_id = EXCLUDED.embedding_queue_id,
        item_status = EXCLUDED.item_status,
        missing_information = EXCLUDED.missing_information;
  END LOOP;

  IF v_queued_count = v_approved_count THEN
    v_preparation_status := 'completed';
  ELSIF v_queued_count > 0 THEN
    v_preparation_status := 'partial';
  ELSIF v_skipped_count >= v_approved_count AND v_approved_count > 0 THEN
    v_preparation_status := 'queued';
  ELSE
    v_preparation_status := 'failed';
    v_missing := v_missing || jsonb_build_array('no_chunks_queued');
  END IF;

  IF v_queued_count > 0 THEN
    UPDATE public.policy_rag_source_registry
    SET source_status = 'queued'
    WHERE id = p_rag_source_id
      AND source_status NOT IN ('embedded', 'failed');
  END IF;

  UPDATE public.real_policy_embedding_preparation_runs
  SET preparation_status = v_preparation_status,
      queued_chunk_count = v_queued_count,
      skipped_chunk_count = v_skipped_count,
      approved_chunk_count = v_approved_count,
      completed_at = NOW(),
      error_message = CASE WHEN v_preparation_status = 'failed' THEN 'embedding_preparation_failed' ELSE NULL END,
      preparation_context = preparation_context || jsonb_build_object(
        'queued_chunk_count', v_queued_count,
        'skipped_chunk_count', v_skipped_count,
        'approved_chunk_count', v_approved_count,
        'prepared_at', NOW()
      ),
      missing_information = missing_information || v_missing
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'real_embedding_preparation_run_id', v_run_id,
    'approved_chunk_count', v_approved_count,
    'queued_chunk_count', v_queued_count,
    'skipped_chunk_count', v_skipped_count,
    'preparation_status', v_preparation_status,
    'missing_information', v_missing,
    'preparation_only', TRUE,
    'no_external_api', TRUE,
    'created_at', NOW()
  );
END;
$lifeguard_prepare_real_policy_embedding$;

COMMENT ON FUNCTION public.lifeguard_prepare_real_policy_embedding IS
  'Admin: prepare approved real policy chunks for embedding queue — no API calls or fake vectors.';

-- ---------------------------------------------------------------------------
-- Row Level Security — admin only
-- ---------------------------------------------------------------------------
ALTER TABLE public.real_policy_embedding_preparation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.real_policy_embedding_preparation_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.real_policy_embedding_preparation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.real_policy_embedding_preparation_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lg_real_policy_embedding_preparation_runs_admin_select ON public.real_policy_embedding_preparation_runs;
CREATE POLICY lg_real_policy_embedding_preparation_runs_admin_select ON public.real_policy_embedding_preparation_runs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_embedding_preparation_runs_admin_insert ON public.real_policy_embedding_preparation_runs;
CREATE POLICY lg_real_policy_embedding_preparation_runs_admin_insert ON public.real_policy_embedding_preparation_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_embedding_preparation_runs_admin_update ON public.real_policy_embedding_preparation_runs;
CREATE POLICY lg_real_policy_embedding_preparation_runs_admin_update ON public.real_policy_embedding_preparation_runs
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_embedding_preparation_items_admin_select ON public.real_policy_embedding_preparation_items;
CREATE POLICY lg_real_policy_embedding_preparation_items_admin_select ON public.real_policy_embedding_preparation_items
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_embedding_preparation_items_admin_insert ON public.real_policy_embedding_preparation_items;
CREATE POLICY lg_real_policy_embedding_preparation_items_admin_insert ON public.real_policy_embedding_preparation_items
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_embedding_preparation_items_admin_update ON public.real_policy_embedding_preparation_items;
CREATE POLICY lg_real_policy_embedding_preparation_items_admin_update ON public.real_policy_embedding_preparation_items
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());
