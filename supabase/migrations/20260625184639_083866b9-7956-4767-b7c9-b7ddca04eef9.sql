
ALTER TABLE public.ground_truth ADD COLUMN IF NOT EXISTS locations JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS floor_plan_prompt TEXT;
ALTER TABLE public.iteration_results ADD COLUMN IF NOT EXISTS spatial_score NUMERIC(5,4);
ALTER TABLE public.iteration_results ADD COLUMN IF NOT EXISTS spatial_matches JSONB;
ALTER TABLE public.iterations ADD COLUMN IF NOT EXISTS gemini_file_cache JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.ground_truth.locations IS 'Bounding boxes in Gemini-native normalized integer coords [ymin,xmin,ymax,xmax] on 0-1000 scale. Stored as array of {id,label,ymin,xmin,ymax,xmax}.';
COMMENT ON COLUMN public.iteration_results.spatial_score IS 'IoU-based per-page spatial accuracy: matched / max(predicted_count, truth_count).';
COMMENT ON COLUMN public.iterations.gemini_file_cache IS 'Map of dataset_file_id -> {file_uri, expires_at} from Gemini File API.';
