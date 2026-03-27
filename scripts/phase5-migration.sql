-- Phase 5: Chatbot widget config
-- Run this in the Supabase SQL editor

-- Add chatbot config columns to tenants
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS min_quote_gbp DECIMAL(10,2) DEFAULT 300,
  ADD COLUMN IF NOT EXISTS price_buffer_percent DECIMAL(5,2) DEFAULT 10;

-- Index on enquiries source for dashboard filtering
CREATE INDEX IF NOT EXISTS enquiries_source_idx ON enquiries (tenant_id, source, created_at DESC);
