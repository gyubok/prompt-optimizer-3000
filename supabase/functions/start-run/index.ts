import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 10;
const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const PASS1_MODEL = "gemini-2.5-flash";
const PASS2_MODEL = "gemini-2.5-pro";
const REFINE_MODEL = "gemini-2.5-flash";
const LOVABLE_AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const IOU_MATCH_THRESHOLD = 0.5;

const DEFAULT_PASS1_PROMPT = `You are screening an architectural document page. Determine whether this page is a FLOOR PLAN (a scaled top-down plan view of a building or floor, typically showing walls, rooms, dimensions, and asset symbols) on which "{ASSET_TYPE}" assets could be detected.

Respond with STRICT JSON ONLY (no prose, no markdown fences):
{
  "relevant": true | false,
  "confidence": 0.0-1.0,
  "keywords": ["..."],
  "hint_point": "brief one-line reason"
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiKey = Deno.env.get("GEMINI_API_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let payload: any;
  try {
    payload = await req.json();
  } catch (e) {
    return jsonResp({ error: "Invalid JSON" }, 400);
  }
  const { run_id, continue_processing, iteration_id, offset, start_next, prompt_text } = payload;
  if (!run_id) return jsonResp({ error: "run_id required" }, 400);

  // Run the heavy work in the background so the HTTP request returns immediately
  // and never hits the 150s idle timeout. The function self-invokes for further batches.
  // @ts-ignore - EdgeRuntime is provided by Supabase Edge runtime
  EdgeRuntime.waitUntil((async () => {
    try {
    const { data: run, error: runErr } = await supabase.from("runs").select("*").eq("id", run_id).single();
    if (runErr) throw runErr;

    if (!start_next && !continue_processing && ["stopped", "failed", "completed"].includes(run.status)) {
      return;
    }

    const { data: files, error: filesErr } = await supabase
      .from("dataset_files")
      .select("*")
      .eq("dataset_id", run.dataset_id)
      .order("file_name")
      .order("page_number");
    if (filesErr) throw filesErr;

    const { data: truthRows, error: gtErr } = await supabase
      .from("ground_truth")
      .select("*")
      .eq("dataset_id", run.dataset_id)
      .eq("asset_type", run.asset_type);
    if (gtErr) throw gtErr;

    const truthMap = new Map<string, { count: number; locations: any[] }>();
    for (const gt of truthRows) {
      truthMap.set(`${gt.file_name}|${gt.page_number}`, {
        count: gt.count,
        locations: Array.isArray(gt.locations) ? gt.locations : [],
      });
    }

    let currentIterationId = iteration_id;
    let currentOffset = offset || 0;

    if (start_next) {
      const iterNum = run.current_iteration + 1;
      if (iterNum > run.max_iterations) {
        await supabase.from("runs").update({ status: "completed" }).eq("id", run_id);
        return;
      }
      const { data: iteration, error: iterErr } = await supabase
        .from("iterations")
        .insert({
          run_id,
          iteration_number: iterNum,
          prompt_text: prompt_text || run.initial_prompt,
          status: "processing",
          batch_cursor: 0,
        })
        .select()
        .single();
      if (iterErr) throw iterErr;
      currentIterationId = iteration.id;
      await supabase.from("runs").update({ status: "running", current_iteration: iterNum }).eq("id", run_id);
      currentOffset = 0;
    } else if (!continue_processing) {
      const iterNum = run.current_iteration + 1;
      const { data: iteration, error: iterErr } = await supabase
        .from("iterations")
        .insert({
          run_id,
          iteration_number: iterNum,
          prompt_text: run.initial_prompt,
          status: "processing",
          batch_cursor: 0,
        })
        .select()
        .single();
      if (iterErr) throw iterErr;
      currentIterationId = iteration.id;
      await supabase.from("runs").update({ status: "running", current_iteration: iterNum }).eq("id", run_id);
      currentOffset = 0;
    }

    const { data: currentIter } = await supabase
      .from("iterations")
      .select("prompt_text")
      .eq("id", currentIterationId)
      .single();
    const detectionPrompt = currentIter?.prompt_text || run.initial_prompt;
    const pass1PromptTemplate = run.floor_plan_prompt?.trim() || DEFAULT_PASS1_PROMPT;
    const pass1Prompt = pass1PromptTemplate.replace(/\{ASSET_TYPE\}/g, run.asset_type);

    const batch = files.slice(currentOffset, currentOffset + BATCH_SIZE);

    for (const file of batch) {
      const { data: freshRun } = await supabase.from("runs").select("status").eq("id", run_id).single();
      if (freshRun && ["stopped", "stopping", "failed"].includes(freshRun.status)) {
        await supabase.from("iterations").update({ status: "failed" }).eq("id", currentIterationId);
        if (freshRun.status === "stopping") {
          await supabase.from("runs").update({ status: "stopped" }).eq("id", run_id);
        }
        return;
      }

      const truth = truthMap.get(`${file.file_name}|${file.page_number}`) ?? { count: 0, locations: [] };

      let pass1Relevant = true;
      let pass1Confidence: number | null = null;
      let pass1Keywords: string[] | null = null;
      let pass1HintPoint: string | null = null;
      let predictedCount = 0;
      let pass2Detections: any = null;
      let pass2RawOutput: string | null = null;
      let pass2ValidJson: boolean | null = null;
      let spatialScore: number | null = null;
      let spatialMatches: any = null;

      try {
        // Ensure PDF is uploaded to Gemini File API (cached per storage_path).
        const fileUri = await ensureGeminiFile(supabase, geminiKey, file.storage_path);

        // === PASS 1: Floor-plan relevance ===
        try {
          const p1Text = await callGeminiJSON(
            geminiKey,
            PASS1_MODEL,
            [
              { text: pass1Prompt },
              { text: `Analyze page ${file.page_number} of the attached PDF and respond with strict JSON only.` },
              { fileData: { fileUri, mimeType: "application/pdf" } },
            ],
            {
              type: "OBJECT",
              properties: {
                relevant: { type: "BOOLEAN" },
                confidence: { type: "NUMBER" },
                keywords: { type: "ARRAY", items: { type: "STRING" } },
                hint_point: { type: "STRING" },
              },
              required: ["relevant", "confidence"],
            },
          );
          const p1 = JSON.parse(p1Text);
          pass1Relevant = !!p1.relevant;
          pass1Confidence = typeof p1.confidence === "number" ? p1.confidence : null;
          pass1Keywords = Array.isArray(p1.keywords) ? p1.keywords : null;
          pass1HintPoint = p1.hint_point ?? null;
        } catch (e) {
          console.error("Pass 1 error:", e);
          // On failure, default to relevant so Pass 2 still runs.
          pass1Relevant = true;
        }

        // === PASS 2: Detection with bounding boxes ===
        const passesGate = pass1Relevant && (pass1Confidence === null || pass1Confidence >= run.pass1_threshold);
        if (passesGate) {
          try {
            const p2Text = await callGeminiJSON(
              geminiKey,
              PASS2_MODEL,
              [
                {
                  text: `You are detecting "${run.asset_type}" assets on page ${file.page_number} of an architectural floor plan.

Detection instructions:
${detectionPrompt}

Return STRICT JSON ONLY following the schema. Use Gemini-native normalized integer coordinates on a 0-1000 scale: [ymin, xmin, ymax, xmax]. instance_id must be a stable short string unique within this page (e.g. "1", "2", ...).`,
                },
                { fileData: { fileUri, mimeType: "application/pdf" } },
              ],
              {
                type: "OBJECT",
                properties: {
                  detections: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        instance_name: { type: "STRING" },
                        instance_id: { type: "STRING" },
                        ymin: { type: "INTEGER" },
                        xmin: { type: "INTEGER" },
                        ymax: { type: "INTEGER" },
                        xmax: { type: "INTEGER" },
                        confidence: { type: "NUMBER" },
                      },
                      required: ["instance_name", "instance_id", "ymin", "xmin", "ymax", "xmax"],
                    },
                  },
                  count: { type: "INTEGER" },
                },
                required: ["detections", "count"],
              },
            );
            pass2RawOutput = p2Text;
            const p2 = JSON.parse(p2Text);
            pass2ValidJson = true;
            pass2Detections = Array.isArray(p2.detections) ? p2.detections : [];
            predictedCount = typeof p2.count === "number" ? p2.count : pass2Detections.length;

            // IoU matching against ground truth (display-only in v1; not used in scoring).
            const matches = matchByIoU(pass2Detections, truth.locations, IOU_MATCH_THRESHOLD);
            spatialMatches = matches;
            const denom = Math.max(pass2Detections.length, truth.locations.length);
            spatialScore = denom > 0 ? matches.length / denom : null;
          } catch (e) {
            console.error("Pass 2 error:", e);
            pass2RawOutput = String(e);
            pass2ValidJson = false;
            predictedCount = 0;
          }
        } else {
          pass1Relevant = false;
          predictedCount = 0;
        }
      } catch (e) {
        console.error(`File processing failed (${file.file_name} p${file.page_number}):`, e);
      }

      const { error: upsertErr } = await supabase.from("iteration_results").upsert(
        {
          iteration_id: currentIterationId,
          file_name: file.file_name,
          page_number: file.page_number,
          predicted_count: predictedCount,
          truth_count: truth.count,
          pass1_relevant: pass1Relevant,
          pass1_confidence: pass1Confidence,
          pass1_keywords: pass1Keywords,
          pass1_hint_point: pass1HintPoint,
          pass2_detections: pass2Detections,
          pass2_raw_output: pass2RawOutput,
          pass2_valid_json: pass2ValidJson,
          spatial_score: spatialScore,
          spatial_matches: spatialMatches,
        },
        { onConflict: "iteration_id,file_name,page_number", ignoreDuplicates: false },
      );
      if (upsertErr) console.error(`Upsert error for ${file.file_name} p${file.page_number}:`, upsertErr);

      await supabase
        .from("iterations")
        .update({ batch_cursor: currentOffset + batch.indexOf(file) + 1 })
        .eq("id", currentIterationId);
    }

    const nextOffset = currentOffset + BATCH_SIZE;

    if (nextOffset < files.length) {
      const fnUrl = `${supabaseUrl}/functions/v1/start-run`;
      fetch(fnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({
          run_id,
          continue_processing: true,
          iteration_id: currentIterationId,
          offset: nextOffset,
        }),
      }).catch((e) => console.error("Self-invocation error:", e));
      return;
    }

    // === SCORING ===
    const { data: results } = await supabase
      .from("iteration_results")
      .select("*")
      .eq("iteration_id", currentIterationId);
    const allResults = results || [];

    if (allResults.length === 0) {
      await supabase.from("iterations").update({ status: "failed" }).eq("id", currentIterationId);
      await supabase.from("runs").update({ status: "failed" }).eq("id", run_id);
      return;
    }

    // Primary metric: after-gate exact match rate over (file, page) that reached Pass 2.
    const gated = allResults.filter((r) => r.pass1_relevant);
    const afterGateScore = gated.length > 0
      ? gated.filter((r) => r.predicted_count === r.truth_count).length / gated.length
      : 0;

    // Secondary (display only): E2E exact match — Pass 1 misses count as predicted_count = 0.
    const e2eScore = allResults.length > 0
      ? allResults.filter((r) => {
          const predicted = r.pass1_relevant ? r.predicted_count : 0;
          return predicted === r.truth_count;
        }).length / allResults.length
      : 0;

    // === Prompt Refinement via Lovable AI Gateway ===
    let reasoningJson: any = null;
    try {
      const errors = allResults
        .filter((r) => (r.pass1_relevant ? r.predicted_count !== r.truth_count : r.truth_count !== 0))
        .map((r) => ({
          file: r.file_name,
          page: r.page_number,
          predicted: r.pass1_relevant ? r.predicted_count : 0,
          actual: r.truth_count,
          delta: (r.pass1_relevant ? r.predicted_count : 0) - r.truth_count,
          gate_passed: r.pass1_relevant,
        }));
      const correctCount = allResults.length - errors.length;

      const refinementPrompt = `You are a prompt engineering expert improving an architectural floor-plan asset detection prompt.

Current detection prompt:
---
${detectionPrompt}
---

Asset type: "${run.asset_type}"

Results:
- Pages processed: ${allResults.length}
- Correct: ${correctCount}/${allResults.length}
- After-gate accuracy (primary): ${(afterGateScore * 100).toFixed(1)}%
- End-to-end accuracy: ${(e2eScore * 100).toFixed(1)}%

Errors (${errors.length}):
${errors.length > 0 ? JSON.stringify(errors.slice(0, 25), null, 2) : "None"}

Produce a revised detection prompt that should improve after-gate accuracy. Respond with JSON only:
{
  "revised_prompt": "...",
  "changes_made": "...",
  "analysis": "...",
  "strategy_adjustment": "..."
}`;

      const resp = await fetch(LOVABLE_AI_GATEWAY, {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: refinementPrompt }],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content ?? "";
        const parsed = extractJson(content);
        if (parsed?.revised_prompt) {
          reasoningJson = {
            suggested_prompt: parsed.revised_prompt,
            changes_made: parsed.changes_made ?? null,
            analysis: parsed.analysis ?? null,
            strategy_adjustment: parsed.strategy_adjustment ?? null,
          };
        }
      }
    } catch (e) {
      console.error("Prompt refinement error:", e);
    }

    await supabase
      .from("iterations")
      .update({
        status: "completed",
        after_gate_score: afterGateScore,
        e2e_score: e2eScore,
        reasoning_json: reasoningJson,
      })
      .eq("id", currentIterationId);

    if (run.mode === "manual") {
      await supabase.from("runs").update({ status: "paused_manual" }).eq("id", run_id);
    } else if (afterGateScore >= 1.0 || run.current_iteration >= run.max_iterations) {
      await supabase.from("runs").update({ status: "completed" }).eq("id", run_id);
    } else {
      // Auto mode: kick off next iteration with the refined prompt.
      if (reasoningJson?.suggested_prompt) {
        const fnUrl = `${supabaseUrl}/functions/v1/start-run`;
        fetch(fnUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({ run_id, start_next: true, prompt_text: reasoningJson.suggested_prompt }),
        }).catch((e) => console.error("Auto-next self-invocation error:", e));
      } else {
        await supabase.from("runs").update({ status: "completed" }).eq("id", run_id);
      }
    }

    return jsonResp({
      status: "completed",
      iteration_id: currentIterationId,
      after_gate_score: afterGateScore,
      e2e_score: e2eScore,
    });
  } catch (e) {
    console.error("start-run error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ===== Gemini File API caching =====
async function ensureGeminiFile(supabase: any, geminiKey: string, storagePath: string): Promise<string> {
  const nowIso = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5-min safety margin
  const { data: cached } = await supabase
    .from("pdf_uploads")
    .select("*")
    .eq("storage_path", storagePath)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (cached?.gemini_file_uri) return cached.gemini_file_uri;

  // Download from Supabase storage
  const { data: fileData, error: dlErr } = await supabase.storage.from("pdfs").download(storagePath);
  if (dlErr || !fileData) throw new Error(`Failed to download ${storagePath}: ${dlErr?.message}`);

  const arrayBuffer = await fileData.arrayBuffer();
  const size = arrayBuffer.byteLength;

  // Start resumable upload
  const startResp = await fetch(
    `${GEMINI_BASE}/upload/v1beta/files?key=${geminiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(size),
        "X-Goog-Upload-Header-Content-Type": "application/pdf",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: storagePath } }),
    },
  );
  if (!startResp.ok) throw new Error(`Gemini upload start failed: ${startResp.status} ${await startResp.text()}`);
  const uploadUrl = startResp.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("Gemini upload URL missing");

  const finalResp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: arrayBuffer,
  });
  if (!finalResp.ok) throw new Error(`Gemini upload finalize failed: ${finalResp.status} ${await finalResp.text()}`);
  const meta = await finalResp.json();
  const fileUri = meta?.file?.uri;
  const fileName = meta?.file?.name;
  if (!fileUri) throw new Error("Gemini file URI missing in response");

  // Poll until ACTIVE (PDF processing)
  for (let i = 0; i < 20; i++) {
    const stateResp = await fetch(`${GEMINI_BASE}/v1beta/${fileName}?key=${geminiKey}`);
    if (stateResp.ok) {
      const s = await stateResp.json();
      if (s.state === "ACTIVE") break;
      if (s.state === "FAILED") throw new Error("Gemini file processing FAILED");
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Cache (Gemini files live ~48h)
  const expiresAt = new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString();
  await supabase.from("pdf_uploads").upsert(
    { storage_path: storagePath, gemini_file_uri: fileUri, gemini_file_name: fileName, expires_at: expiresAt },
    { onConflict: "storage_path" },
  );
  return fileUri;
}

// ===== Gemini generateContent with strict JSON schema =====
async function callGeminiJSON(
  apiKey: string,
  model: string,
  parts: any[],
  responseSchema: any,
  maxRetries = 3,
): Promise<string> {
  const url = `${GEMINI_BASE}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: "user", parts: parts.map(normalizePart) }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.1,
    },
  };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if ((resp.status === 429 || resp.status >= 500) && attempt < maxRetries) {
      const backoff = Math.pow(2, attempt + 1) * 1000;
      console.log(`Gemini ${resp.status}, retrying in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Gemini ${resp.status}: ${errText}`);
    }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("") ?? "";
    return text;
  }
  throw new Error("Gemini max retries exceeded");
}

function normalizePart(p: any): any {
  if (p.fileData) return { file_data: { mime_type: p.fileData.mimeType, file_uri: p.fileData.fileUri } };
  return p;
}

function extractJson(text: string): any | null {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  return null;
}

// ===== IoU matching =====
function iou(a: { ymin: number; xmin: number; ymax: number; xmax: number }, b: typeof a): number {
  const ix1 = Math.max(a.xmin, b.xmin);
  const iy1 = Math.max(a.ymin, b.ymin);
  const ix2 = Math.min(a.xmax, b.xmax);
  const iy2 = Math.min(a.ymax, b.ymax);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const areaA = Math.max(0, a.xmax - a.xmin) * Math.max(0, a.ymax - a.ymin);
  const areaB = Math.max(0, b.xmax - b.xmin) * Math.max(0, b.ymax - b.ymin);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

function matchByIoU(predictions: any[], truths: any[], threshold: number): any[] {
  const matches: any[] = [];
  const usedTruth = new Set<number>();
  // Greedy: for each prediction, find best unused truth above threshold
  for (let pi = 0; pi < predictions.length; pi++) {
    const p = predictions[pi];
    if (![p.ymin, p.xmin, p.ymax, p.xmax].every((v) => typeof v === "number")) continue;
    let bestIdx = -1;
    let bestScore = threshold;
    for (let ti = 0; ti < truths.length; ti++) {
      if (usedTruth.has(ti)) continue;
      const t = truths[ti];
      if (![t.ymin, t.xmin, t.ymax, t.xmax].every((v) => typeof v === "number")) continue;
      const score = iou(p, t);
      if (score >= bestScore) {
        bestScore = score;
        bestIdx = ti;
      }
    }
    if (bestIdx >= 0) {
      usedTruth.add(bestIdx);
      matches.push({ pred_idx: pi, truth_idx: bestIdx, iou: Number(bestScore.toFixed(4)) });
    }
  }
  return matches;
}
