-- Corporate Chart Hand Slice 1 — minimal document ownership link.
-- Personal docs: entity_id IS NULL. Corporate docs: entity_id = owning corporate entity.
-- Does not create a new document system; only attributes existing customer_documents.

ALTER TABLE public.customer_documents
  ADD COLUMN IF NOT EXISTS entity_id UUID NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'entities'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_documents_entity_id_fkey'
  ) THEN
    ALTER TABLE public.customer_documents
      ADD CONSTRAINT customer_documents_entity_id_fkey
      FOREIGN KEY (entity_id) REFERENCES public.entities (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS customer_documents_entity_id_idx
  ON public.customer_documents (entity_id)
  WHERE deleted_at IS NULL AND entity_id IS NOT NULL;

COMMENT ON COLUMN public.customer_documents.entity_id IS
  'Corporate ownership (entities.id). NULL = personal customer document. Never invents facts.';
