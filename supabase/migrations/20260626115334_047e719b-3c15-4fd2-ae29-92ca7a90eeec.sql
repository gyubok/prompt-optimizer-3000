
ALTER TABLE public.iterations ADD COLUMN IF NOT EXISTS progress_log jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.iterations ADD COLUMN IF NOT EXISTS last_progress_at timestamptz;

-- Mark stuck run as failed so user can restart
UPDATE public.iterations SET status='failed' WHERE id='55213f74-6ade-48c2-a33e-60cc0ed6d98c' AND status='processing';
UPDATE public.runs SET status='failed' WHERE id='e6fc6f15-1a2a-4c4e-802f-236baa9957c5' AND status='running';
