-- Shopify AI Image Generator - Database Schema
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- ============================================
-- Jobs Table
-- ============================================
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'analyzing_products', 'generating_images', 'completed', 'failed', 'stopping', 'stopped')),
    product_ids INTEGER[] NOT NULL,
    settings JSONB NOT NULL,
    creation_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    product_states JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT,
    store_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries by store
CREATE INDEX IF NOT EXISTS idx_jobs_store_url ON jobs(store_url);
CREATE INDEX IF NOT EXISTS idx_jobs_creation_date ON jobs(creation_date DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
CREATE TRIGGER update_jobs_updated_at
    BEFORE UPDATE ON jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Row Level Security (RLS)
-- ============================================
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Allow all operations for anonymous users (since this is a client-side app)
-- In production, you'd want to add proper authentication
CREATE POLICY "Allow all operations on jobs" ON jobs
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ============================================
-- Storage Bucket for Generated Images
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-images', 'generated-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies - allow public read and authenticated write
CREATE POLICY "Public read access for generated images"
ON storage.objects FOR SELECT
USING (bucket_id = 'generated-images');

CREATE POLICY "Allow uploads to generated images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'generated-images');

CREATE POLICY "Allow updates to generated images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'generated-images');

CREATE POLICY "Allow deletes from generated images"
ON storage.objects FOR DELETE
USING (bucket_id = 'generated-images');
