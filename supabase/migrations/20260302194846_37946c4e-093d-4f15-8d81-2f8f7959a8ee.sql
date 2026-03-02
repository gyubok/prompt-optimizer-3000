
-- Create run status and mode enums
CREATE TYPE public.run_status AS ENUM ('queued', 'running', 'paused_manual', 'stopping', 'stopped', 'completed', 'failed');
CREATE TYPE public.run_mode AS ENUM ('auto', 'manual');
CREATE TYPE public.iteration_status AS ENUM ('pending', 'processing', 'scoring', 'paused_manual', 'completed', 'failed');

-- Datasets
CREATE TABLE public.datasets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read datasets" ON public.datasets FOR SELECT USING (true);
CREATE POLICY "Anyone can insert datasets" ON public.datasets FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update datasets" ON public.datasets FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete datasets" ON public.datasets FOR DELETE USING (true);

-- Dataset files
CREATE TABLE public.dataset_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  page_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.dataset_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read dataset_files" ON public.dataset_files FOR SELECT USING (true);
CREATE POLICY "Anyone can insert dataset_files" ON public.dataset_files FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete dataset_files" ON public.dataset_files FOR DELETE USING (true);

-- Ground truth
CREATE TABLE public.ground_truth (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  page_number INTEGER NOT NULL DEFAULT 1,
  asset_type TEXT NOT NULL,
  count INTEGER NOT NULL
);
ALTER TABLE public.ground_truth ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read ground_truth" ON public.ground_truth FOR SELECT USING (true);
CREATE POLICY "Anyone can insert ground_truth" ON public.ground_truth FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete ground_truth" ON public.ground_truth FOR DELETE USING (true);

-- Runs
CREATE TABLE public.runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  mode public.run_mode NOT NULL DEFAULT 'auto',
  status public.run_status NOT NULL DEFAULT 'queued',
  current_iteration INTEGER NOT NULL DEFAULT 0,
  pass1_threshold NUMERIC(4,2) NOT NULL DEFAULT 0.70,
  initial_prompt TEXT NOT NULL,
  max_iterations INTEGER NOT NULL DEFAULT 20,
  stall_threshold INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read runs" ON public.runs FOR SELECT USING (true);
CREATE POLICY "Anyone can insert runs" ON public.runs FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update runs" ON public.runs FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete runs" ON public.runs FOR DELETE USING (true);

-- Iterations
CREATE TABLE public.iterations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  iteration_number INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  prompt_diff TEXT,
  reasoning_json JSONB,
  after_gate_score NUMERIC(5,4),
  e2e_score NUMERIC(5,4),
  token_usage_json JSONB,
  estimated_cost NUMERIC(10,6),
  cumulative_cost NUMERIC(10,6),
  status public.iteration_status NOT NULL DEFAULT 'pending',
  batch_cursor INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.iterations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read iterations" ON public.iterations FOR SELECT USING (true);
CREATE POLICY "Anyone can insert iterations" ON public.iterations FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update iterations" ON public.iterations FOR UPDATE USING (true);

-- Iteration results
CREATE TABLE public.iteration_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  iteration_id UUID NOT NULL REFERENCES public.iterations(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  page_number INTEGER NOT NULL DEFAULT 1,
  pass1_relevant BOOLEAN,
  pass1_confidence NUMERIC(5,4),
  pass1_hint_point TEXT,
  pass1_keywords TEXT[],
  pass2_detections JSONB,
  pass2_raw_output TEXT,
  pass2_valid_json BOOLEAN,
  truth_count INTEGER NOT NULL,
  predicted_count INTEGER NOT NULL DEFAULT 0,
  delta INTEGER GENERATED ALWAYS AS (predicted_count - truth_count) STORED,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (iteration_id, file_name, page_number)
);
ALTER TABLE public.iteration_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read iteration_results" ON public.iteration_results FOR SELECT USING (true);
CREATE POLICY "Anyone can insert iteration_results" ON public.iteration_results FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update iteration_results" ON public.iteration_results FOR UPDATE USING (true);

-- Concurrency enforcement function
CREATE OR REPLACE FUNCTION public.check_run_concurrency()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'running' THEN
    IF (SELECT COUNT(*) FROM public.runs WHERE status = 'running' AND id != NEW.id) >= 10 THEN
      NEW.status := 'queued';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER enforce_run_concurrency
BEFORE INSERT OR UPDATE ON public.runs
FOR EACH ROW EXECUTE FUNCTION public.check_run_concurrency();

-- Auto-promote queued runs when a run finishes
CREATE OR REPLACE FUNCTION public.promote_queued_runs()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'running' AND NEW.status IN ('completed', 'stopped', 'failed') THEN
    UPDATE public.runs
    SET status = 'running', updated_at = now()
    WHERE id = (
      SELECT id FROM public.runs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER promote_queued_on_finish
AFTER UPDATE ON public.runs
FOR EACH ROW EXECUTE FUNCTION public.promote_queued_runs();

-- Updated_at trigger for runs
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_runs_updated_at
BEFORE UPDATE ON public.runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for PDFs
INSERT INTO storage.buckets (id, name, public) VALUES ('pdfs', 'pdfs', false);

CREATE POLICY "Anyone can upload PDFs" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'pdfs');
CREATE POLICY "Anyone can read PDFs" ON storage.objects FOR SELECT USING (bucket_id = 'pdfs');
CREATE POLICY "Anyone can delete PDFs" ON storage.objects FOR DELETE USING (bucket_id = 'pdfs');

-- Enable realtime on key tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.iterations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.iteration_results;
