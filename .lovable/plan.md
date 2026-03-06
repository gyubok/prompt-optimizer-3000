

## Investigation Findings

### Root Cause: AI Gateway Rate Limiting (429)
The edge function logs show **every single AI call** is returning `429 Too Many Requests` from the AI gateway. Both Pass 1 (relevance) and Pass 2 (detection) fail for all 11 files. The error handling catches these errors but continues — writing results with `predicted_count: 0` and `pass1_relevant: true` (defaults on error). However, the upserts appear to silently fail too (0 rows in `iteration_results`), likely because the function hits the edge runtime timeout (~60s) while processing 11 files with back-to-back failing API calls, and the `Http: connection closed before message completed` error in logs confirms this.

### Cascade of Problems
1. **AI calls 429** → All AI calls fail due to rate limiting
2. **No error handling for upsert failures** → Results never saved, but function continues
3. **Iteration marked "completed" with 0 results** → Scoring runs on empty array, producing `after_gate_score: 0.0` and `e2e_score: 0.0`
4. **Run transitions to `paused_manual`** → UI shows review panel, but there's nothing to review
5. **"Best Accuracy: -Infinity%"** → `Math.max(...[])` on an empty filtered array returns `-Infinity`

### The 500 Errors in Browser
The red 500 errors in the console are from `otel-faro.p.l5e.io/collect` — a telemetry/observability service, not related to the app. These are harmless and can be ignored.

### What Needs Fixing

**1. Edge function: Add retry with backoff for 429 errors**
- In `callAI()`, retry up to 3 times with exponential backoff (2s, 4s, 8s) when receiving 429
- This handles transient rate limits gracefully

**2. Edge function: Check upsert errors**
- The upsert result is never checked for errors — add error logging so silent failures are visible

**3. Edge function: Don't mark iteration as "completed" with 0 results**
- After scoring, if `allResults.length === 0`, mark iteration as `failed` with a clear reason, not `completed`
- Update run status to `failed` or keep it `running` so the user knows something went wrong

**4. UI: Fix -Infinity% display**
- In `RunDetail.tsx` line 68: `Math.max(...[])` returns `-Infinity`. Guard against empty arrays:
  ```
  const scores = iterations.filter(i => i.after_gate_score != null).map(i => Number(i.after_gate_score));
  const bestFiltered = scores.length > 0 ? Math.max(...scores) : null;
  ```

**5. UI: Show error state when iteration completes with no results**
- In `IterationCard.tsx`, when `iteration.status === "completed"` but `totalPages === 0`, show a message like "Processing failed — no results were recorded. This may be due to rate limiting."

### Files to Change
- `supabase/functions/start-run/index.ts` — retry logic in `callAI()`, upsert error checking, handle 0-result scoring
- `src/pages/RunDetail.tsx` — fix `-Infinity%` bug
- `src/components/IterationCard.tsx` — show error state for completed iterations with 0 results

