-- Deploy patch: Phase 7-3 objects missing on remote (requires 7-1 tables + classify/grounding RPCs already deployed)

CREATE TABLE IF NOT EXISTS public.customer_ai_consultations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID NOT NULL REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  conversation_id       UUID,
  question              TEXT NOT NULL,
  answer                TEXT NOT NULL,
  category              TEXT,
  route_target          TEXT,
  classification_id     UUID REFERENCES public.customer_question_classifications (id) ON DELETE SET NULL,
  grounding_packet_id   UUID REFERENCES public.customer_grounding_packets (id) ON DELETE SET NULL,
  supporting_documents  JSONB NOT NULL DEFAULT '[]'::JSONB,
  supporting_chunks     JSONB NOT NULL DEFAULT '[]'::JSONB,
  missing_information   JSONB NOT NULL DEFAULT '[]'::JSONB,
  confidence            NUMERIC(4, 3)
                        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  provider              TEXT NOT NULL DEFAULT 'claude',
  provider_model        TEXT,
  provider_status       TEXT NOT NULL DEFAULT 'completed'
                        CHECK (provider_status IN ('completed', 'context_only', 'failed', 'skipped')),
  metadata_json         JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_ai_consultations_customer_idx
  ON public.customer_ai_consultations (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_ai_consultations_conversation_idx
  ON public.customer_ai_consultations (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.lifeguard_prepare_customer_consultation(
  p_customer_id       UUID,
  p_question          TEXT,
  p_conversation_id   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_classification JSONB;
  v_grounding        JSONB;
  v_missing          JSONB := '[]'::JSONB;
  v_support_docs     JSONB := '[]'::JSONB;
  v_support_chunks   JSONB := '[]'::JSONB;
  v_retrieval        JSONB;
  v_confidence       NUMERIC(4, 3);
  v_missing_cnt      INT;
BEGIN
  IF NOT public.lifeguard_is_admin()
     AND NOT public.lifeguard_is_own_customer(p_customer_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_classification := public.lifeguard_classify_customer_question(
    p_customer_id, p_question, p_conversation_id
  );

  v_grounding := public.lifeguard_build_customer_grounding_packet(
    p_customer_id, p_question, p_conversation_id, TRUE
  );

  v_missing := COALESCE(v_grounding->'missing_information', '[]'::JSONB);
  v_retrieval := COALESCE(v_grounding->'retrieval_context', '{}'::JSONB);

  SELECT COALESCE(jsonb_agg(item), '[]'::JSONB) INTO v_support_docs
  FROM (
    SELECT jsonb_build_object(
      'document_id', pol->>'id',
      'insurer_name', pol->>'insurer_name',
      'product_name', pol->>'product_name',
      'policy_number', pol->>'policy_number',
      'source', 'insurance_policy'
    ) AS item
    FROM jsonb_array_elements(COALESCE(v_grounding->'insurance_context'->'policies', '[]'::JSONB)) pol
    UNION ALL
    SELECT jsonb_build_object(
      'document_id', d->>'id',
      'storage_path', d->>'storage_path',
      'original_filename', d->>'original_filename',
      'source', 'uploaded_document'
    ) AS item
    FROM jsonb_array_elements(COALESCE(v_grounding->'insurance_context'->'documents', '[]'::JSONB)) d
  ) docs;

  v_support_chunks := COALESCE(v_retrieval->'retrieved_chunks', '[]'::JSONB);

  v_missing_cnt := jsonb_array_length(v_missing);
  v_confidence := LEAST(
    1,
    GREATEST(
      0,
      COALESCE((v_classification->>'confidence')::NUMERIC, 0.45)
      - (v_missing_cnt * 0.04)
    )
  );

  RETURN jsonb_build_object(
    'question', trim(p_question),
    'customer_id', p_customer_id,
    'conversation_id', p_conversation_id,
    'classification', v_classification,
    'grounding_packet_id', v_grounding->'grounding_packet_id',
    'classification_id', v_classification->'classification_id',
    'missing_information', v_missing,
    'supporting_documents', v_support_docs,
    'supporting_chunks', v_support_chunks,
    'confidence', v_confidence,
    'provider_context', jsonb_build_object(
      'question', trim(p_question),
      'classification', v_classification,
      'grounding_packet', v_grounding,
      'retrieval_context', v_retrieval
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.lifeguard_save_customer_consultation(
  p_customer_id           UUID,
  p_question              TEXT,
  p_answer                TEXT,
  p_conversation_id       UUID DEFAULT NULL,
  p_classification_id     UUID DEFAULT NULL,
  p_grounding_packet_id   UUID DEFAULT NULL,
  p_category              TEXT DEFAULT NULL,
  p_route_target          TEXT DEFAULT NULL,
  p_supporting_documents  JSONB DEFAULT '[]'::JSONB,
  p_supporting_chunks     JSONB DEFAULT '[]'::JSONB,
  p_missing_information   JSONB DEFAULT '[]'::JSONB,
  p_confidence            NUMERIC DEFAULT NULL,
  p_provider              TEXT DEFAULT 'claude',
  p_provider_model        TEXT DEFAULT NULL,
  p_provider_status       TEXT DEFAULT 'completed',
  p_metadata_json         JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.lifeguard_is_admin()
     AND NOT public.lifeguard_is_own_customer(p_customer_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_question IS NULL OR length(trim(p_question)) = 0 THEN
    RAISE EXCEPTION 'question_required';
  END IF;

  IF p_answer IS NULL OR length(trim(p_answer)) = 0 THEN
    RAISE EXCEPTION 'answer_required';
  END IF;

  INSERT INTO public.customer_ai_consultations (
    customer_id,
    conversation_id,
    question,
    answer,
    category,
    route_target,
    classification_id,
    grounding_packet_id,
    supporting_documents,
    supporting_chunks,
    missing_information,
    confidence,
    provider,
    provider_model,
    provider_status,
    metadata_json
  )
  VALUES (
    p_customer_id,
    p_conversation_id,
    trim(p_question),
    trim(p_answer),
    p_category,
    p_route_target,
    p_classification_id,
    p_grounding_packet_id,
    COALESCE(p_supporting_documents, '[]'::JSONB),
    COALESCE(p_supporting_chunks, '[]'::JSONB),
    COALESCE(p_missing_information, '[]'::JSONB),
    p_confidence,
    COALESCE(p_provider, 'claude'),
    p_provider_model,
    COALESCE(p_provider_status, 'completed'),
    COALESCE(p_metadata_json, '{}'::JSONB)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'consultation_id', v_id,
    'customer_id', p_customer_id,
    'conversation_id', p_conversation_id,
    'created_at', NOW()
  );
END;
$$;

ALTER TABLE public.customer_ai_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_ai_consultations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lg_customer_ai_consultations_customer_select ON public.customer_ai_consultations;
CREATE POLICY lg_customer_ai_consultations_customer_select ON public.customer_ai_consultations
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_own_customer(customer_id));

DROP POLICY IF EXISTS lg_customer_ai_consultations_admin_select ON public.customer_ai_consultations;
CREATE POLICY lg_customer_ai_consultations_admin_select ON public.customer_ai_consultations
  FOR SELECT TO authenticated
  USING (public.lifeguard_is_admin());
