

# Prompt Optimization Platform — Final Plan

## Database Schema (Supabase)

### Tables

**datasets** — id, name, description, created_at

**dataset_files** — id, dataset_id (FK), file_name, storage_path, page_number (always 1 for single-page PDFs), created_at

**ground_truth** — id, dataset_id (FK), file_name, page_number, asset_type, count

**runs** — id, dataset_id (FK), asset_type, mode (auto|manual), status (queued|running|paused_manual|stopping|stopped|completed|failed), current_iteration, pass1_threshold (default 0.70), initial_prompt, max_iterations, stall_threshold, created_at, updated_at

**iterations** — id, run_id (FK), iteration_number, prompt_text, prompt_diff, reasoning_json (changes_made, analysis, strategy_adjustment, risk_note), after_gate_score, e2e_score, token_usage_json (pass1, pass2, optimizer), estimated_cost, cumulative_cost, status (pending|processing|scoring|paused_manual|completed|failed), batch_cursor (offset for resumability), created_at

**iteration_results** — id, iteration_id (FK), file_name, page_number, pass1_relevant (bool), pass1_confidence, pass1_hint_point, pass1_keywords, pass2_detections (JSON array of {instance_name, instance_id, x, y, confidence}), pass2_raw_output (for debugging invalid JSON), pass2_valid_json (bool), truth_count, predicted_count, delta, created_at
- **Unique constraint**: (iteration_id, file_name, page_number) for idempotent upserts

**run_queue** — DB-level concurrency enforcement. A check constraint or trigger ensures max 10 runs with status = 'running' at any time. New runs go to 'queued'. When a run completes/stops/fails, the oldest queued run transitions to 'running'.

### Storage
- Bucket: `pdfs` — stores uploaded single-page PDF files

### Realtime
- Enable Realtime on `runs`, `iterations`, `iteration_results` tables

## Edge Functions

### 1. `start-run`
- Validates run config, checks concurrency (≤10 running), sets status to `running` or `queued`
- Creates first iteration record with status `pending`

### 2. `process-batch`
- Accepts: iteration_id, batch_size, cursor/offset
- Pulls next batch of files from dataset_files
- For each file: calls OpenAI Vision (Pass 1 filter → if confidence ≥ run's pass1_threshold → Pass 2 detection)
- Pass 2: hard-validates JSON schema {instance_name, instance_id, x, y, confidence}. If invalid JSON → logs raw output, marks pass2_valid_json = false, predicted_count = 0
- Upserts results keyed by (iteration_id, file_name, page_number) — idempotent on retry
- Updates batch_cursor in iteration record
- Returns: { processed, remaining, cursor }

### 3. `score-iteration`
- Computes after-gate exact match: over files where pass1_relevant = true, % where predicted_count == truth_count
- Computes e2e exact match (display only): over ALL files, treating pass1 misses as predicted_count = 0
- x/y and instance_name/id stored but NOT used in scoring (v1)
- Writes scores to iteration record

### 4. `run-optimizer`
- Receives iteration results + current prompt
- Calls OpenAI with Reflect-Then-Rewrite pattern (Pass 2 prompt only)
- Returns: revised prompt, diff, structured reasoning JSON
- Creates next iteration record

### 5. `check-stopping`
- Evaluates stopping conditions in order: perfect score (1.0) → max iterations → stall (N iterations no improvement)
- If auto mode + not stopped → advances to next iteration
- If manual mode → sets iteration to `paused_manual`, awaits user approval
- If stopping condition met → sets run to `completed`

### 6. `manage-run`
- Actions: stop (sets `stopping`, halts between batches), approve (manual mode → continue), reject (manual mode → stop), edit-prompt (manual mode → update prompt then continue)
- Handles state transitions per the state machine

## Run State Machine
```
queued → running → (processing iterations) → completed
                 ↘ paused_manual → running (on approve/edit)
                 ↘ stopping → stopped
                 ↘ failed
```
- Stop button sets status to `stopping`; process-batch checks this before each batch and exits cleanly if stopping
- Manual mode: after each iteration scored, run goes to `paused_manual`. User can Approve (continue with optimizer's prompt), Edit (modify prompt then continue), or Reject (stop run)

## UI Pages

### 1. Dataset Management Page (`/datasets`)
- List existing datasets
- "New Dataset" flow: name input → drag-and-drop PDF upload zone (batch upload ~200 files to Supabase Storage) → CSV upload for ground truth → validation preview table → save

### 2. New Run Page (`/runs/new`)
- Select dataset, select asset type (from ground truth entries)
- Mode toggle: Auto / Manual
- Initial detection prompt (large text area)
- Advanced settings (collapsible): pass1_threshold (slider, default 0.70), max_iterations, stall_threshold
- Start Run button

### 3. Runs Dashboard (`/runs`)
- Table: run ID, asset type, dataset, mode, status badge, current iteration, best after-gate score, cost
- Status badges color-coded per state machine
- Queue position shown for `queued` runs
- Click row → Run Detail

### 4. Run Detail Page (`/runs/:id`)
- **Header**: run info, status badge, stop button, manual approval controls (when paused)
- **Iteration table**: iteration #, after-gate score, e2e score, tokens (pass1/pass2/optimizer), cost, status
- **Accuracy trend chart** (Recharts): line chart of after-gate score + e2e score over iterations
- **Prompt diff viewer**: side-by-side view of prompt changes between iterations
- **Reasoning panel**: structured display of optimizer's changes_made, analysis, strategy_adjustment, risk_note
- **Per-page results table**: file, page, pass1 relevant, pass1 confidence, predicted count, truth count, delta — filterable to errors only, sortable
- **Failed JSON pages**: filtered view of pages where pass2_valid_json = false, showing raw output
- **Cost summary card**: token breakdown by stage, per-iteration and cumulative cost
- **Manual mode controls**: when paused_manual, show proposed prompt with editable text area + Approve / Edit / Reject buttons

### 5. Live Updates
- Supabase Realtime subscriptions on runs, iterations, iteration_results
- Progress bar during batch processing (processed / total files)
- Iteration results stream in as they're written

## Design
- Clean, data-dense, desktop-first layout
- Dark mode default with light mode toggle
- Sidebar navigation: Datasets, Runs, (future: Settings)

