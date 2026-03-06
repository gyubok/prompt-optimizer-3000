

## Plan: Redesign Run Detail Page and Fix "Approve" Flow

### Problems Identified

1. **Jargon**: "After-Gate", "E2E", "Pass 1", "Pass 2", "Delta" are internal terms. Users need plain language like "Accuracy (Filtered)", "Accuracy (Overall)", "Relevance Check", "Detection", "Difference".
2. **Layout is data-dump, not workflow**: The page should reflect the iteration loop: **Prompt In -> Processing -> Results Out -> Review -> Next Iteration**. Currently it's a flat dashboard with tabs that hide the most important information.
3. **Approve does nothing**: `handleApprove` just sets `status: "running"` but nothing listens for that change. No edge function is invoked to start the next iteration. The backend needs to be triggered.
4. **No visibility into the prompt**: The prompt used for each iteration is stored but never shown. Users need to see what prompt produced what results.

### New Layout Design

Replace the current tab-heavy layout with a **vertical iteration timeline** that tells the story of each iteration:

```text
[Header: Run name, dataset, asset type, status, Stop button]
[Progress bar if processing]

--- Iteration 1 ---------------------------------------------------
| Prompt Used:                                                      |
|   [readonly textarea showing prompt_text]                         |
|                                                                   |
| Results Summary:                                                  |
|   Accuracy: 85% (17/20 correct)  |  Overall: 80% (24/30 pages)   |
|   Pages analyzed: 30  |  Relevant: 20  |  Errors: 2               |
|                                                                   |
| [Expandable: Per-Page Results table]                              |
|   File | Page | Relevant? | Predicted | Actual | Correct? |       |
|                                                                   |
| [Expandable: AI Reasoning]                                        |
--------------------------------------------------------------------

--- Review & Next Iteration (shown when paused) -------------------
| The AI analyzed the results and suggests this revised prompt:     |
|   [editable textarea with next prompt]                            |
|                                                                   |
| [Start Next Iteration]  [Edit Prompt First]  [Stop Run]          |
--------------------------------------------------------------------

--- Accuracy Trend (shown when 2+ iterations) ---------------------
| [Line chart]                                                      |
--------------------------------------------------------------------
```

### Terminology Changes

| Old | New |
|-----|-----|
| After-Gate Score | Accuracy (Filtered) |
| E2E Score | Accuracy (Overall) |
| Pass 1 | Relevance Check |
| Pass 2 | Detection |
| Delta | Difference |
| Pass 1 Threshold | Relevance Threshold |
| Predicted | AI Count |
| Truth | Actual Count |
| Valid JSON | Valid Output |

### Backend Fix: Approve -> Start Next Iteration

The `handleApprove` / "Start Next Iteration" action must:
1. Create a new iteration row (iteration_number + 1) with the prompt text
2. Update run status to `running` and increment `current_iteration`
3. Invoke `start-run` edge function with `{ run_id, continue_processing: true, iteration_id: newIterationId }`

The edge function already supports `continue_processing` but expects an existing iteration. We need to adjust: the frontend creates the iteration, then the edge function processes it. Alternatively, add a `next_iteration` mode to the edge function that handles iteration creation with a provided prompt.

I'll add a new parameter to `start-run`: `{ run_id, start_next: true, prompt_text: "..." }` which creates iteration N+1 and processes it.

### Stats Cards Simplification

Replace the 4-card grid with a compact inline summary:
- **Iteration X of Y max** | **Best Accuracy: 85%** | **Relevance Threshold: 0.7**

### Files to Change

1. **`src/pages/RunDetail.tsx`** -- Complete redesign with iteration timeline layout, renamed terminology, review panel with "Start Next Iteration" button
2. **`src/components/RunProgressSection.tsx`** -- Simplify labels
3. **`supabase/functions/start-run/index.ts`** -- Add `start_next` mode: accepts `{ run_id, start_next: true, prompt_text }`, creates next iteration, processes files

### Implementation Approach

- Build `RunDetail.tsx` as a single scrollable page with iteration cards rendered in reverse order (latest first)
- Each iteration card shows: prompt, summary stats, expandable results table, expandable reasoning
- When `paused_manual`, show a prominent review section at the top with the current prompt (pre-filled with last iteration's prompt for editing) and a "Start Next Iteration" button
- The button invokes the edge function which creates and processes the next iteration
- Auto-select the latest iteration's results for display

