-- Phase 7: Email Inbound Pipeline
-- Run this in Supabase SQL Editor before deploying the process-email edge function.

-- ── Add email metadata columns to enquiries ──────────────────────────────────

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS email_message_id    TEXT,
  ADD COLUMN IF NOT EXISTS email_thread_id     TEXT,
  ADD COLUMN IF NOT EXISTS email_subject       TEXT,
  ADD COLUMN IF NOT EXISTS email_from          TEXT,
  ADD COLUMN IF NOT EXISTS parent_enquiry_id   UUID REFERENCES enquiries(id),
  ADD COLUMN IF NOT EXISTS duplicate_of_id     UUID REFERENCES enquiries(id),
  ADD COLUMN IF NOT EXISTS embedding           vector(1536);

-- Fast lookup for deduplication by message ID
CREATE INDEX IF NOT EXISTS enquiries_email_message_id_idx
  ON enquiries (tenant_id, email_message_id)
  WHERE email_message_id IS NOT NULL;

-- Fast lookup for thread grouping
CREATE INDEX IF NOT EXISTS enquiries_email_thread_id_idx
  ON enquiries (tenant_id, email_thread_id)
  WHERE email_thread_id IS NOT NULL;

-- HNSW index for embedding similarity search on enquiries
CREATE INDEX IF NOT EXISTS enquiries_embedding_idx
  ON enquiries USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- ── RPC: match_enquiries ─────────────────────────────────────────────────────
-- Used by the edge function for embedding-based duplicate detection.

CREATE OR REPLACE FUNCTION match_enquiries(
  query_embedding  vector(1536),
  match_threshold  float,
  match_count      int,
  p_tenant_id      uuid
)
RETURNS TABLE (
  id              uuid,
  raw_input       text,
  extracted_specs jsonb,
  similarity      float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    raw_input,
    extracted_specs,
    1 - (embedding <=> query_embedding) AS similarity
  FROM enquiries
  WHERE
    tenant_id = p_tenant_id
    AND embedding IS NOT NULL
    AND source = 'email'
    AND status != 'archived'
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ── Grant execute to service role (edge functions use service role) ───────────
GRANT EXECUTE ON FUNCTION match_enquiries TO service_role;
