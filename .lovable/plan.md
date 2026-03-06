

## Plan: Build the `start-run` Edge Function for Iteration Creation & Processing

### Problem
When a run is created and transitions to `running`, nothing happens — no iterations are created, no files are processed. The system is missing the orchestration logic that kicks off the first iteration and processes files.

### Architecture
Per the existing design (hybrid architecture), a Supabase Edge Function handles orchestration. The function will:
1. Be invoked after a run is created (called from the frontend after run creation)
2. Create iteration #1 with the run's `initial_prompt`
3. Process each file in the dataset through Pass 1 (filter) and Pass 2 (detection) using Lovable AI
4. Score the iteration and update the run

### What we'll build

**Edge Function: `supabase/functions/start-run/index.ts`**

Core flow:
1. Receive `run_id` in the request body
2. Fetch the run (dataset_id, initial_prompt, asset_type, pass1_threshold)
3. Fetch all `dataset_files` for the dataset
4. Fetch all `ground_truth` for the dataset + asset_type
5. Create an iteration row (iteration_number=1, status=`processing`, prompt_text=run's initial_prompt)
6. Update run: `current_iteration = 1, status = 'running'`
7. For each file/page:
   - Download PDF page from storage bucket `pdfs`
   - **Pass 1**: Call Lovable AI (gemini-2.5-flash) asking "Is this page relevant to [asset_type]?" → get confidence score
   - If confidence >= pass1_threshold, proceed to Pass 2
   - **Pass 2**: Call Lovable AI (gemini-2.5-pro) with the detection prompt → parse JSON output for detections
   - Upsert into `iteration_results` with predicted_count, truth_count (from ground_truth), delta, pass1/pass2 fields
8. After all files processed:
   - Compute after_gate_score (accuracy of predictions vs ground truth)
   - Update iteration: status=`completed`, after_gate_score, e2e_score
   - If mode=`manual`, set run status to `paused_manual`
   - If mode=`auto` and iteration < max_iterations and score < 1.0, create next iteration (with AI-refined prompt)
   - If score meets threshold or max iterations reached, set run to `completed`

**Frontend change: `src/pages/NewRun.tsx`**
- After successful run creation, invoke the edge function: `supabase.functions.invoke('start-run', { body: { run_id: data.id } })`
- Fire-and-forget (don't await) since processing is long-running

**Config: `supabase/config.toml`**
- Add `[functions.start-run]` with `verify_jwt = false`

### Scoring logic
- `after_gate_score` = fraction of pages where `predicted_count == truth_count` (only for pass1-relevant pages)
- `e2e_score` = fraction of ALL pages where prediction matches truth (including pages filtered out by pass1)

### Edge cases
- Invalid JSON from Pass 2: log raw output in `pass2_raw_output`, set `pass2_valid_json = false`, `predicted_count = 0`
- Cursor-based processing with `batch_cursor` for resumability
- Function timeout: Edge functions have a ~60s limit. For large datasets (200+ files), we'll process in batches and use a self-invocation pattern (function calls itself with an offset to continue processing)

### Self-invocation for large datasets
Since edge functions timeout at ~60s and datasets can have 200+ files:
1. Process files in batches of ~20
2. After each batch, update `iteration.batch_cursor`
3. If more files remain, invoke itself with `{ run_id, continue: true }`
4. This creates a chain of short-lived invocations that process the full dataset

### Files to create/edit
- **Create**: `supabase/functions/start-run/index.ts` — main orchestration logic
- **Edit**: `supabase/config.toml` — add function config
- **Edit**: `src/pages/NewRun.tsx` — invoke edge function after run creation

