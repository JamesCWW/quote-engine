-- Phase 3: RAG Quoting Engine — Supabase migrations
-- Run these in the Supabase SQL editor

-- 1. Vector similarity search function (tenant-scoped, golden-prioritised)
CREATE OR REPLACE FUNCTION match_quotes(
  query_embedding vector(1536),
  match_tenant_id UUID,
  match_count INT DEFAULT 3
)
RETURNS TABLE (
  id UUID, product_type TEXT, material TEXT, description TEXT,
  price_low DECIMAL, price_high DECIMAL, final_price DECIMAL,
  is_golden BOOLEAN, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT q.id, q.product_type, q.material, q.description,
         q.price_low, q.price_high, q.final_price, q.is_golden,
         1 - (q.embedding <=> query_embedding) AS similarity
  FROM quotes q
  WHERE q.tenant_id = match_tenant_id
    AND q.embedding IS NOT NULL
  ORDER BY
    -- Prioritise golden quotes, then by similarity
    q.is_golden DESC,
    q.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 2. Create storage bucket for enquiry photos (run in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('enquiry-photos', 'enquiry-photos', true);
-- Or use the Supabase dashboard: Storage → New bucket → name: enquiry-photos, Public: ON

-- 3. Storage bucket RLS (allow authenticated users to upload)
-- CREATE POLICY "Authenticated users can upload photos"
--   ON storage.objects FOR INSERT
--   TO authenticated
--   WITH CHECK (bucket_id = 'enquiry-photos');

-- CREATE POLICY "Public read for enquiry photos"
--   ON storage.objects FOR SELECT
--   TO public
--   USING (bucket_id = 'enquiry-photos');
