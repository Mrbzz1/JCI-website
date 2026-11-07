-- JCI Oudhref: run in Supabase SQL Editor.
-- This is additive and does not drop existing tables, rows, or buckets.

ALTER TABLE public.gallery_images
  ADD COLUMN IF NOT EXISTS storage_path text;

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS storage_path text;

CREATE INDEX IF NOT EXISTS idx_gallery_storage_path
  ON public.gallery_images(storage_path);

CREATE INDEX IF NOT EXISTS idx_partners_storage_path
  ON public.partners(storage_path);

ALTER TABLE public.gallery_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_stats ENABLE ROW LEVEL SECURITY;

-- The API uses the Supabase service-role key, which bypasses RLS.
-- With no anonymous table policies, public clients cannot write to the tables.
