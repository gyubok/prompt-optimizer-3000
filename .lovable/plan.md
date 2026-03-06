

## Findings

**Issue 1: No results to access.** Iteration 1 has status "completed" but 0 results in the database — every AI call was rate-limited (429), so nothing was saved. The UI correctly shows "Processing failed" for 0-result iterations, but the root issue is that iteration 1 never actually produced data.

**Issue 2: Prompt for iteration 2 is "test".** The ReviewPanel simply pre-fills with the previous iteration's prompt and lets the user type freely. There is no AI-driven prompt refinement step. The user typed "test" and clicked "Start Next Iteration" — the system accepted it as-is. There is no logic anywhere that analyzes results and suggests an improved prompt.

## Plan

### 1. Add AI prompt refinement to the edge function

After scoring an iteration (when results exist), call the AI to analyze the results and generate a refined prompt for the next iteration. Store both the suggested prompt and the analysis reasoning.

**File: `supabase/functions/start-run/index.ts`**
- After computing scores, if `allResults.length > 0`, call the AI with:
  - The current prompt
  - A summary of errors (which files had wrong counts, false positives/negatives)
  - Ask it to produce: `{ "revised_prompt": "...", "changes_made": "...", "analysis": "..." }`
- Save `reasoning_json` and a new field or use `prompt_diff` to store the suggested next prompt
- Store the suggested prompt in the iteration's `reasoning_json.suggested_prompt`

### 2. Update ReviewPanel to use AI-suggested prompt

**File: `src/components/ReviewPanel.tsx`**
- Read `latestIteration.reasoning_json.suggested_prompt` as the default prompt text (falling back to the iteration's `prompt_text`)
- Show a clear label: "AI-suggested prompt for next iteration" with a note about what changed
- Show the AI's analysis of what went wrong and what it changed
- User can still edit before starting

### 3. Show results expanded by default for latest completed iteration

**File: `src/components/IterationCard.tsx`**
- Default `resultsOpen` to `true` when `isLatest && iteration.status === "completed" && totalPages > 0`
- This ensures the user sees results immediately without clicking

### 4. Handle the "completed with 0 results" case better

The current code already marks iterations as `failed` when 0 results exist (from the previous fix), but iteration 1 was created before that fix. Going forward this won't happen. No change needed.

### Files to change
- `supabase/functions/start-run/index.ts` — add AI prompt refinement after scoring
- `src/components/ReviewPanel.tsx` — use AI-suggested prompt, show analysis
- `src/components/IterationCard.tsx` — auto-expand results for latest iteration

