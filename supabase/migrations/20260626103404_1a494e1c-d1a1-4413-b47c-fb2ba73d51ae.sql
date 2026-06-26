CREATE TABLE IF NOT EXISTS public.pdf_uploads (
  storage_path TEXT PRIMARY KEY,
  gemini_file_uri TEXT NOT NULL,
  gemini_file_name TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pdf_uploads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pdf_uploads TO anon;
GRANT ALL ON public.pdf_uploads TO service_role;
ALTER TABLE public.pdf_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permissive pdf_uploads" ON public.pdf_uploads FOR ALL USING (true) WITH CHECK (true);