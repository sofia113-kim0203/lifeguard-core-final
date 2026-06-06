-- =============================================================================
-- LIFEGUARD Core — Phase 14-5 Real policy chunk generation foundation (ONE-TIME)
-- Chunk generation workflow from stored real policy extracted text.
-- Run after phase14_real_policy_text_extraction_execution_foundation.sql. Does NOT modify 001–012.
-- No fake chunks, fake text, embeddings, or external AI.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Real policy chunk generation status helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_real_policy_chunk_generation_statuses()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['pending', 'processing', 'completed', 'failed']::TEXT[];
$$;

-- ---------------------------------------------------------------------------
-- real_policy_chunk_generation_runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.real_policy_chunk_generation_runs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text_extraction_run_id  UUID NOT NULL REFERENCES public.real_policy_text_extraction_runs (id) ON DELETE CASCADE,
  policy_pdf_id           UUID NOT NULL REFERENCES public.real_policy_pdf_registry (id) ON DELETE CASCADE,
  policy_source_id        UUID REFERENCES public.real_policy_knowledge_sources (id) ON DELETE SET NULL,
  generation_status       TEXT NOT NULL DEFAULT 'pending'
                          CHECK (generation_status = ANY (public.lifeguard_real_policy_chunk_generation_statuses())),
  source_page_count       INTEGER NOT NULL DEFAULT 0 CHECK (source_page_count >= 0),
  generated_chunk_count   INTEGER NOT NULL DEFAULT 0 CHECK (generated_chunk_count >= 0),
  generation_context      JSONB NOT NULL DEFAULT '{}'::JSONB,
  missing_information     JSONB NOT NULL DEFAULT '[]'::JSONB,
  error_message           TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ,
  initiated_by            UUID REFERENCES public.users (id) ON DELETE SET NULL,
  engine_ref              TEXT NOT NULL DEFAULT 'lifeguard_register_real_policy_chunk_generation'
);

COMMENT ON TABLE public.real_policy_chunk_generation_runs IS
  'Real policy chunk generation runs; extracted text only — no fake chunks.';

-- ---------------------------------------------------------------------------
-- real_policy_chunk_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.real_policy_chunk_items (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  real_chunk_generation_run_id UUID NOT NULL REFERENCES public.real_policy_chunk_generation_runs (id) ON DELETE CASCADE,
  chunk_registry_id           UUID REFERENCES public.policy_chunk_registry (id) ON DELETE SET NULL,
  policy_pdf_id               UUID NOT NULL REFERENCES public.real_policy_pdf_registry (id) ON DELETE CASCADE,
  policy_source_id            UUID REFERENCES public.real_policy_knowledge_sources (id) ON DELETE SET NULL,
  page_number                 INTEGER NOT NULL CHECK (page_number > 0),
  chunk_sequence              INTEGER NOT NULL CHECK (chunk_sequence > 0),
  chunk_text                  TEXT NOT NULL,
  chunk_status                TEXT NOT NULL DEFAULT 'created'
                              CHECK (chunk_status = ANY (public.lifeguard_policy_chunk_statuses())),
  source_reference            TEXT NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT real_policy_chunk_items_run_seq_unique UNIQUE (real_chunk_generation_run_id, chunk_sequence)
);

COMMENT ON TABLE public.real_policy_chunk_items IS
  'Real policy chunk items; copied from extracted text only — no fabrication.';

CREATE INDEX IF NOT EXISTS real_policy_chunk_generation_runs_extraction_idx
  ON public.real_policy_chunk_generation_runs (text_extraction_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS real_policy_chunk_generation_runs_status_idx
  ON public.real_policy_chunk_generation_runs (generation_status, created_at DESC);

CREATE INDEX IF NOT EXISTS real_policy_chunk_generation_runs_pdf_idx
  ON public.real_policy_chunk_generation_runs (policy_pdf_id, created_at DESC);

CREATE INDEX IF NOT EXISTS real_policy_chunk_items_run_idx
  ON public.real_policy_chunk_items (real_chunk_generation_run_id, chunk_sequence ASC);

-- ---------------------------------------------------------------------------
-- Register real policy chunk generation (workflow only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_register_real_policy_chunk_generation(
  p_text_extraction_run_id UUID,
  p_policy_pdf_id          UUID,
  p_policy_source_id       UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_register_real_policy_chunk_generation$
DECLARE
  v_run_id            UUID;
  v_user_id           UUID;
  v_missing           JSONB := '[]'::JSONB;
  v_generation_status TEXT := 'pending';
  v_rag_source_id     UUID;
  v_source_page_count INTEGER := 0;
  v_text_rec          RECORD;
  v_pdf_rec           RECORD;
BEGIN
  IF NOT public.lifeguard_is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_text_extraction_run_id IS NULL THEN
    RAISE EXCEPTION 'text_extraction_run_id_required';
  END IF;

  IF p_policy_pdf_id IS NULL THEN
    RAISE EXCEPTION 'policy_pdf_id_required';
  END IF;

  IF p_policy_source_id IS NULL THEN
    RAISE EXCEPTION 'policy_source_id_required';
  END IF;

  SELECT
    tr.id,
    tr.policy_pdf_id,
    tr.extraction_status
  INTO v_text_rec
  FROM public.real_policy_text_extraction_runs tr
  WHERE tr.id = p_text_extraction_run_id
    AND tr.policy_pdf_id = p_policy_pdf_id;

  IF v_text_rec.id IS NULL THEN
    v_missing := v_missing || jsonb_build_array('text_extraction_run_not_found');
    RAISE EXCEPTION 'text_extraction_run_not_found';
  END IF;

  IF v_text_rec.extraction_status NOT IN ('completed', 'processing') THEN
    v_missing := v_missing || jsonb_build_array('invalid_extraction_status');
    v_generation_status := 'failed';
  END IF;

  SELECT
    pdf.id,
    pdf.policy_source_id,
    pdf.carrier_id,
    pdf.product_id
  INTO v_pdf_rec
  FROM public.real_policy_pdf_registry pdf
  WHERE pdf.id = p_policy_pdf_id;

  IF v_pdf_rec.id IS NULL THEN
    v_missing := v_missing || jsonb_build_array('policy_pdf_not_found');
    RAISE EXCEPTION 'policy_pdf_not_found';
  END IF;

  IF v_pdf_rec.policy_source_id IS DISTINCT FROM p_policy_source_id THEN
    v_missing := v_missing || jsonb_build_array('policy_source_mismatch');
    v_generation_status := 'failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.real_policy_knowledge_sources s
    WHERE s.id = p_policy_source_id
  ) THEN
    v_missing := v_missing || jsonb_build_array('policy_source_not_found');
    v_generation_status := 'failed';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_source_page_count
  FROM public.real_policy_extracted_text_pages etp
  WHERE etp.text_extraction_run_id = p_text_extraction_run_id
    AND etp.policy_pdf_id = p_policy_pdf_id
    AND etp.text_status = 'extracted'
    AND etp.extracted_text IS NOT NULL
    AND length(trim(etp.extracted_text)) > 0;

  IF v_source_page_count = 0 THEN
    v_missing := v_missing || jsonb_build_array('no_extracted_pages');
    v_generation_status := 'failed';
  END IF;

  SELECT reg.id INTO v_rag_source_id
  FROM public.policy_rag_source_registry reg
  WHERE reg.source_type = 'policy_document'
    AND (
      reg.source_id = p_policy_pdf_id
      OR reg.source_id = p_policy_source_id
      OR reg.source_reference LIKE 'real-policy:%'
    )
  ORDER BY reg.created_at DESC
  LIMIT 1;

  IF v_rag_source_id IS NULL THEN
    v_missing := v_missing || jsonb_build_array('rag_source_not_found');
    IF v_generation_status <> 'failed' THEN
      v_generation_status := 'failed';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.real_policy_chunk_generation_runs cgr
    WHERE cgr.text_extraction_run_id = p_text_extraction_run_id
      AND cgr.policy_pdf_id = p_policy_pdf_id
      AND cgr.generation_status NOT IN ('failed', 'completed')
  ) THEN
    v_missing := v_missing || jsonb_build_array('active_chunk_generation_run_exists');
    RAISE EXCEPTION 'active_chunk_generation_run_exists';
  END IF;

  v_user_id := auth.uid();

  INSERT INTO public.real_policy_chunk_generation_runs (
    text_extraction_run_id,
    policy_pdf_id,
    policy_source_id,
    generation_status,
    source_page_count,
    generation_context,
    missing_information,
    error_message,
    initiated_by
  )
  VALUES (
    p_text_extraction_run_id,
    p_policy_pdf_id,
    p_policy_source_id,
    v_generation_status,
    v_source_page_count,
    jsonb_build_object(
      'text_extraction_run_id', p_text_extraction_run_id,
      'policy_pdf_id', p_policy_pdf_id,
      'policy_source_id', p_policy_source_id,
      'rag_source_id', v_rag_source_id,
      'source_page_count', v_source_page_count,
      'preparation_only', TRUE,
      'no_fake_chunks', TRUE,
      'no_embeddings', TRUE,
      'no_external_ai', TRUE,
      'registered_at', NOW()
    ),
    v_missing,
    CASE WHEN v_generation_status = 'failed' THEN 'chunk_generation_registration_failed' ELSE NULL END,
    v_user_id
  )
  RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'real_chunk_generation_run_id', v_run_id,
    'generation_status', v_generation_status,
    'missing_information', v_missing,
    'source_page_count', v_source_page_count,
    'rag_source_id', v_rag_source_id,
    'created_at', NOW()
  );
END;
$lifeguard_register_real_policy_chunk_generation$;

COMMENT ON FUNCTION public.lifeguard_register_real_policy_chunk_generation IS
  'Admin: register real policy chunk generation from extracted text only — no fake chunks.';

-- ---------------------------------------------------------------------------
-- Generate real policy chunk records from extracted text (real text only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifeguard_generate_real_policy_chunks(
  p_real_chunk_generation_run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $lifeguard_generate_real_policy_chunks$
DECLARE
  v_missing               JSONB := '[]'::JSONB;
  v_generation_status     TEXT;
  v_rag_source_id         UUID;
  v_text_run_id           UUID;
  v_policy_pdf_id         UUID;
  v_policy_source_id      UUID;
  v_generated_chunk_count INTEGER := 0;
  v_source_page_count     INTEGER := 0;
  v_seq                   INTEGER := 0;
  v_chunk_registry_id     UUID;
  v_page_rec              RECORD;
  v_line                  TEXT;
  v_source_ref            TEXT;
  v_existing_chunks       INTEGER := 0;
BEGIN
  IF NOT public.lifeguard_is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_real_chunk_generation_run_id IS NULL THEN
    RAISE EXCEPTION 'real_chunk_generation_run_id_required';
  END IF;

  SELECT
    cgr.generation_status,
    cgr.text_extraction_run_id,
    cgr.policy_pdf_id,
    cgr.policy_source_id,
    cgr.source_page_count,
    COALESCE((cgr.generation_context ->> 'rag_source_id')::UUID, NULL)
  INTO
    v_generation_status,
    v_text_run_id,
    v_policy_pdf_id,
    v_policy_source_id,
    v_source_page_count,
    v_rag_source_id
  FROM public.real_policy_chunk_generation_runs cgr
  WHERE cgr.id = p_real_chunk_generation_run_id;

  IF v_generation_status IS NULL THEN
    v_missing := v_missing || jsonb_build_array('chunk_generation_run_not_found');
    RAISE EXCEPTION 'chunk_generation_run_not_found';
  END IF;

  IF v_generation_status = 'completed' THEN
    v_missing := v_missing || jsonb_build_array('already_generated');
    RAISE EXCEPTION 'already_generated';
  END IF;

  IF v_generation_status NOT IN ('pending', 'processing') THEN
    v_missing := v_missing || jsonb_build_array('invalid_generation_status');
    RAISE EXCEPTION 'invalid_generation_status';
  END IF;

  IF v_rag_source_id IS NULL THEN
    SELECT reg.id INTO v_rag_source_id
    FROM public.policy_rag_source_registry reg
    WHERE reg.source_type = 'policy_document'
      AND (
        reg.source_id = v_policy_pdf_id
        OR reg.source_id = v_policy_source_id
        OR reg.source_reference LIKE 'real-policy:%'
      )
    ORDER BY reg.created_at DESC
    LIMIT 1;
  END IF;

  IF v_rag_source_id IS NULL THEN
    v_missing := v_missing || jsonb_build_array('rag_source_not_found');
    RAISE EXCEPTION 'rag_source_not_found';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_existing_chunks
  FROM public.real_policy_chunk_items ci
  WHERE ci.real_chunk_generation_run_id = p_real_chunk_generation_run_id;

  IF v_existing_chunks > 0 THEN
    v_missing := v_missing || jsonb_build_array('chunks_already_exist');
    RAISE EXCEPTION 'chunks_already_exist';
  END IF;

  UPDATE public.real_policy_chunk_generation_runs
  SET generation_status = 'processing'
  WHERE id = p_real_chunk_generation_run_id;

  FOR v_page_rec IN
    SELECT etp.page_number, etp.extracted_text
    FROM public.real_policy_extracted_text_pages etp
    WHERE etp.text_extraction_run_id = v_text_run_id
      AND etp.policy_pdf_id = v_policy_pdf_id
      AND etp.text_status = 'extracted'
      AND etp.extracted_text IS NOT NULL
      AND length(trim(etp.extracted_text)) > 0
    ORDER BY etp.page_number ASC
  LOOP
    FOR v_line IN
      SELECT trim(line_part) AS line_text
      FROM unnest(string_to_array(v_page_rec.extracted_text, E'\n')) AS line_part
      WHERE length(trim(line_part)) > 0
    LOOP
      v_seq := v_seq + 1;
      v_source_ref := 'real-policy:page-' || v_page_rec.page_number::TEXT || ':line-' || v_seq::TEXT;

      INSERT INTO public.policy_chunk_registry (
        rag_source_id,
        source_type,
        source_reference,
        chunk_sequence,
        chunk_text,
        chunk_status,
        engine_ref
      )
      VALUES (
        v_rag_source_id,
        'policy_document',
        v_source_ref,
        v_seq,
        v_line,
        'created',
        'lifeguard_generate_real_policy_chunks'
      )
      ON CONFLICT (rag_source_id, chunk_sequence) DO UPDATE
      SET chunk_text = EXCLUDED.chunk_text,
          source_reference = EXCLUDED.source_reference,
          chunk_status = EXCLUDED.chunk_status
      RETURNING id INTO v_chunk_registry_id;

      INSERT INTO public.real_policy_chunk_items (
        real_chunk_generation_run_id,
        chunk_registry_id,
        policy_pdf_id,
        policy_source_id,
        page_number,
        chunk_sequence,
        chunk_text,
        chunk_status,
        source_reference
      )
      VALUES (
        p_real_chunk_generation_run_id,
        v_chunk_registry_id,
        v_policy_pdf_id,
        v_policy_source_id,
        v_page_rec.page_number,
        v_seq,
        v_line,
        'created',
        v_source_ref
      );

      v_generated_chunk_count := v_generated_chunk_count + 1;
    END LOOP;
  END LOOP;

  IF v_generated_chunk_count = 0 THEN
    v_missing := v_missing || jsonb_build_array('no_extracted_text_for_chunks');
    v_generation_status := 'failed';

    UPDATE public.real_policy_chunk_generation_runs
    SET generation_status = v_generation_status,
        generated_chunk_count = 0,
        error_message = 'no_extracted_text_for_chunks',
        generation_context = generation_context || jsonb_build_object('failed_at', NOW())
    WHERE id = p_real_chunk_generation_run_id;
  ELSE
    v_generation_status := 'completed';

    UPDATE public.real_policy_chunk_generation_runs
    SET generation_status = v_generation_status,
        generated_chunk_count = v_generated_chunk_count,
        source_page_count = v_source_page_count,
        completed_at = NOW(),
        error_message = NULL,
        generation_context = generation_context || jsonb_build_object(
          'generated_chunk_count', v_generated_chunk_count,
          'rag_source_id', v_rag_source_id,
          'generated_only', TRUE,
          'no_fake_chunks', TRUE,
          'no_embeddings', TRUE,
          'generated_at', NOW()
        ),
        missing_information = missing_information || v_missing
    WHERE id = p_real_chunk_generation_run_id;
  END IF;

  RETURN jsonb_build_object(
    'real_chunk_generation_run_id', p_real_chunk_generation_run_id,
    'generated_chunk_count', v_generated_chunk_count,
    'generation_status', v_generation_status,
    'missing_information', v_missing,
    'generated_at', NOW()
  );
END;
$lifeguard_generate_real_policy_chunks$;

COMMENT ON FUNCTION public.lifeguard_generate_real_policy_chunks IS
  'Admin: generate real policy chunk records from extracted page text only — no AI or embeddings.';

-- ---------------------------------------------------------------------------
-- Row Level Security — admin only
-- ---------------------------------------------------------------------------
ALTER TABLE public.real_policy_chunk_generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.real_policy_chunk_generation_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.real_policy_chunk_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.real_policy_chunk_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lg_real_policy_chunk_generation_runs_admin_select ON public.real_policy_chunk_generation_runs;
CREATE POLICY lg_real_policy_chunk_generation_runs_admin_select ON public.real_policy_chunk_generation_runs
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_chunk_generation_runs_admin_insert ON public.real_policy_chunk_generation_runs;
CREATE POLICY lg_real_policy_chunk_generation_runs_admin_insert ON public.real_policy_chunk_generation_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_chunk_generation_runs_admin_update ON public.real_policy_chunk_generation_runs;
CREATE POLICY lg_real_policy_chunk_generation_runs_admin_update ON public.real_policy_chunk_generation_runs
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_chunk_items_admin_select ON public.real_policy_chunk_items;
CREATE POLICY lg_real_policy_chunk_items_admin_select ON public.real_policy_chunk_items
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_chunk_items_admin_insert ON public.real_policy_chunk_items;
CREATE POLICY lg_real_policy_chunk_items_admin_insert ON public.real_policy_chunk_items
  FOR INSERT TO authenticated
  WITH CHECK (public.lifeguard_is_admin());

DROP POLICY IF EXISTS lg_real_policy_chunk_items_admin_update ON public.real_policy_chunk_items;
CREATE POLICY lg_real_policy_chunk_items_admin_update ON public.real_policy_chunk_items
  FOR UPDATE TO authenticated
  USING (public.lifeguard_is_admin())
  WITH CHECK (public.lifeguard_is_admin());
