

## Investigation Results

### Console Errors
The browser console warnings (`Function components cannot be given refs`) are harmless React warnings from the Sidebar/Sheet components — not related to processing.

### The Real Problem
The edge function `start-run` is crashing with `Maximum call stack size exceeded` at line ~106 (actually triggered by the `String.fromCharCode(...uint8.subarray(i, i + chunkSize))` spread on line 138). Even with 8192-element chunks, spreading that many arguments exceeds Deno edge runtime's stack limit.

The run `bbd7cb8d` has status `running` with iteration #1 at `batch_cursor: 9`, meaning it processed 9 files before crashing on a large file. It's now stuck — no further processing will happen.

### Fix

**File: `supabase/functions/start-run/index.ts`** — Replace the chunked `String.fromCharCode(...spread)` base64 conversion with a byte-by-byte loop that avoids spreading entirely:

```typescript
// Replace lines 134-140:
const arrayBuffer = await fileData.arrayBuffer();
const uint8 = new Uint8Array(arrayBuffer);
let binary = "";
for (let i = 0; i < uint8.length; i++) {
  binary += String.fromCharCode(uint8[i]);
}
const base64 = btoa(binary);
```

This eliminates the spread operator entirely. While slightly slower for very large files, it's stack-safe regardless of file size.

**Additionally**, we should fix the stuck run by updating its status or allowing the user to re-trigger processing. The run `bbd7cb8d` is stuck at `running` with a half-processed iteration. We can either:
- Reset it via a DB migration (set status back to `queued` and delete the partial iteration)
- Or add a "Retry" button in the UI

### Files to change
- `supabase/functions/start-run/index.ts` — fix base64 conversion (remove spread operator)
- Database fix for stuck run `bbd7cb8d` — reset status to allow re-processing

