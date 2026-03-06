

## Plan: Add Progress Bar, Stage, Last Activity, and Elapsed Time to Run Detail

### What we're adding

A new status/progress section between the header and stats cards on the Run Detail page with:

1. **Progress bar** showing processed files vs total files for the current active iteration
2. **Current stage** label (e.g., "Processing Pass 1", "Scoring", "Idle")
3. **Last activity** timestamp (most recent `updated_at` from run or latest iteration)
4. **Elapsed time** live counter since `run.created_at` (ticks every second while run is active)

### Data sources

- **Total files**: Query `dataset_files` count where `dataset_id = run.dataset_id`
- **Processed files**: Query `iteration_results` count for the latest active iteration
- **Current stage**: Derived from the latest iteration's `status` field (`pending` → "Preparing", `processing` → "Processing", `scoring` → "Scoring", else "Idle")
- **Last activity**: `run.updated_at` or latest iteration's `created_at`, whichever is newer
- **Elapsed time**: `Date.now() - run.created_at`, updated via `setInterval` every second (only while status is active)

### Technical changes

**File: `src/pages/RunDetail.tsx`**

- Add a new `useQuery` for total file count: `supabase.from("dataset_files").select("id", { count: "exact", head: true }).eq("dataset_id", run.dataset_id)`
- Add a new `useQuery` for current iteration result count (enabled only when there's an active iteration with `processing`/`scoring` status): count from `iteration_results` for that iteration
- Add realtime subscription on `iteration_results` table filtered by the active iteration to trigger refetch of the count
- Add a `useEffect` with `setInterval(1000)` to compute elapsed time from `run.created_at`, clearing when run is no longer active
- Render a new `Card` section between header and stats cards containing:
  - Progress bar (using existing `Progress` component) with label like "12 / 48 files"
  - Stage text derived from latest iteration status
  - Last activity as relative time (e.g., "3s ago") using `date-fns.formatDistanceToNow`
  - Elapsed time formatted as `HH:MM:SS`

### UI layout

```text
┌──────────────────────────────────────────────────┐
│  Stage: Processing Pass 1    Elapsed: 00:04:32   │
│  ████████████░░░░░░░░░░░░  12 / 48 files         │
│  Last activity: 3s ago                           │
└──────────────────────────────────────────────────┘
```

The progress section only shows meaningful data when the run is in an active state; otherwise it shows "Idle" with no progress bar.

