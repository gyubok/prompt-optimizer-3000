import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 15;
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { run_id, continue_processing, iteration_id, offset } = await req.json();
    if (!run_id) throw new Error("run_id is required");

    // Fetch run
    const { data: run, error: runErr } = await supabase
      .from("runs")
      .select("*")
      .eq("id", run_id)
      .single();
    if (runErr) throw runErr;

    // Check if run was stopped/failed
    if (["stopped", "failed", "completed"].includes(run.status)) {
      return jsonResp({ status: "skipped", reason: `Run is ${run.status}` });
    }

    // Fetch dataset files
    const { data: files, error: filesErr } = await supabase
      .from("dataset_files")
      .select("*")
      .eq("dataset_id", run.dataset_id)
      .order("file_name")
      .order("page_number");
    if (filesErr) throw filesErr;

    // Fetch ground truth for this asset type
    const { data: truthRows, error: gtErr } = await supabase
      .from("ground_truth")
      .select("*")
      .eq("dataset_id", run.dataset_id)
      .eq("asset_type", run.asset_type);
    if (gtErr) throw gtErr;

    // Build truth lookup: file_name|page_number -> count
    const truthMap = new Map<string, number>();
    for (const gt of truthRows) {
      truthMap.set(`${gt.file_name}|${gt.page_number}`, gt.count);
    }

    let currentIterationId = iteration_id;
    let currentOffset = offset || 0;

    // If not continuing, create iteration #1
    if (!continue_processing) {
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

      // Update run status
      await supabase
        .from("runs")
        .update({ status: "running", current_iteration: iterNum })
        .eq("id", run_id);

      currentOffset = 0;
    }

    // Process batch
    const batch = files.slice(currentOffset, currentOffset + BATCH_SIZE);

    for (const file of batch) {
      // Check if run was stopped mid-processing
      const { data: freshRun } = await supabase
        .from("runs")
        .select("status")
        .eq("id", run_id)
        .single();
      if (freshRun && ["stopped", "stopping", "failed"].includes(freshRun.status)) {
        // Mark iteration as failed and stop
        await supabase
          .from("iterations")
          .update({ status: "failed" })
          .eq("id", currentIterationId);
        if (freshRun.status === "stopping") {
          await supabase.from("runs").update({ status: "stopped" }).eq("id", run_id);
        }
        return jsonResp({ status: "stopped" });
      }

      const truthCount = truthMap.get(`${file.file_name}|${file.page_number}`) ?? 0;

      // Download the PDF page from storage
      const { data: fileData, error: dlErr } = await supabase.storage
        .from("pdfs")
        .download(file.storage_path);

      let pass1Relevant = true;
      let pass1Confidence: number | null = null;
      let pass1Keywords: string[] | null = null;
      let pass1HintPoint: string | null = null;
      let predictedCount = 0;
      let pass2Detections: any = null;
      let pass2RawOutput: string | null = null;
      let pass2ValidJson: boolean | null = null;

      if (dlErr || !fileData) {
        console.error(`Failed to download ${file.storage_path}:`, dlErr);
        // Still record result with 0 predicted
      } else {
        // Convert PDF to base64
        const arrayBuffer = await fileData.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        const mimeType = "application/pdf";

        // === PASS 1: Relevance filter ===
        try {
          const pass1Response = await callAI(lovableApiKey, "google/gemini-2.5-flash", [
            {
              role: "system",
              content: `You are a document analysis assistant. Determine if the given PDF page is relevant to detecting "${run.asset_type}" assets. Respond with a JSON object: { "relevant": true/false, "confidence": 0.0-1.0, "keywords": ["keyword1", ...], "hint_point": "brief reason" }`,
            },
            {
              role: "user",
              content: [
                {
                  type: "file",
                  file: { filename: file.file_name, file_data: `data:${mimeType};base64,${base64}` },
                },
                {
                  type: "text",
                  text: `Is this page relevant to "${run.asset_type}" detection? Analyze and respond with JSON only.`,
                },
              ],
            },
          ]);

          const pass1Parsed = parseJsonFromText(pass1Response);
          if (pass1Parsed) {
            pass1Relevant = pass1Parsed.relevant ?? true;
            pass1Confidence = pass1Parsed.confidence ?? null;
            pass1Keywords = pass1Parsed.keywords ?? null;
            pass1HintPoint = pass1Parsed.hint_point ?? null;
          }
        } catch (e) {
          console.error("Pass 1 error:", e);
          // Default to relevant on error
        }

        // === PASS 2: Detection (only if relevant or above threshold) ===
        if (pass1Relevant && (pass1Confidence === null || pass1Confidence >= run.pass1_threshold)) {
          try {
            const pass2Response = await callAI(lovableApiKey, "google/gemini-2.5-pro", [
              {
                role: "system",
                content: `You are a document asset detection assistant. Use the following detection prompt to analyze the PDF page and return detections as JSON.\n\nDetection prompt:\n${run.initial_prompt}\n\nRespond ONLY with a JSON object: { "detections": [ { "description": "...", "location": "..." } ], "count": <number> }`,
              },
              {
                role: "user",
                content: [
                  {
                    type: "file",
                    file: { filename: file.file_name, file_data: `data:${mimeType};base64,${base64}` },
                  },
                  {
                    type: "text",
                    text: `Detect all "${run.asset_type}" assets on this page. Return JSON only.`,
                  },
                ],
              },
            ]);

            pass2RawOutput = pass2Response;
            const pass2Parsed = parseJsonFromText(pass2Response);
            if (pass2Parsed) {
              pass2ValidJson = true;
              pass2Detections = pass2Parsed.detections ?? [];
              predictedCount = pass2Parsed.count ?? (pass2Parsed.detections?.length ?? 0);
            } else {
              pass2ValidJson = false;
              predictedCount = 0;
            }
          } catch (e) {
            console.error("Pass 2 error:", e);
            pass2RawOutput = String(e);
            pass2ValidJson = false;
            predictedCount = 0;
          }
        } else {
          // Page filtered out by Pass 1
          pass1Relevant = false;
          predictedCount = 0;
        }
      }

      const delta = predictedCount - truthCount;

      // Upsert result
      await supabase.from("iteration_results").upsert(
        {
          iteration_id: currentIterationId,
          file_name: file.file_name,
          page_number: file.page_number,
          predicted_count: predictedCount,
          truth_count: truthCount,
          delta,
          pass1_relevant: pass1Relevant,
          pass1_confidence: pass1Confidence,
          pass1_keywords: pass1Keywords,
          pass1_hint_point: pass1HintPoint,
          pass2_detections: pass2Detections,
          pass2_raw_output: pass2RawOutput,
          pass2_valid_json: pass2ValidJson,
        },
        { onConflict: "iteration_id,file_name,page_number", ignoreDuplicates: false }
      );

      // Update batch cursor
      await supabase
        .from("iterations")
        .update({ batch_cursor: currentOffset + batch.indexOf(file) + 1 })
        .eq("id", currentIterationId);
    }

    const nextOffset = currentOffset + BATCH_SIZE;

    // If more files remain, self-invoke
    if (nextOffset < files.length) {
      // Fire-and-forget self-invocation
      const fnUrl = `${supabaseUrl}/functions/v1/start-run`;
      fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          run_id,
          continue_processing: true,
          iteration_id: currentIterationId,
          offset: nextOffset,
        }),
      }).catch((e) => console.error("Self-invocation error:", e));

      return jsonResp({ status: "processing", offset: nextOffset, total: files.length });
    }

    // All files processed — score the iteration
    const { data: results } = await supabase
      .from("iteration_results")
      .select("*")
      .eq("iteration_id", currentIterationId);

    const allResults = results || [];
    const relevantResults = allResults.filter((r) => r.pass1_relevant);

    const afterGateScore =
      relevantResults.length > 0
        ? relevantResults.filter((r) => r.predicted_count === r.truth_count).length / relevantResults.length
        : 0;

    const e2eScore =
      allResults.length > 0
        ? allResults.filter((r) => {
            if (!r.pass1_relevant) return r.truth_count === 0;
            return r.predicted_count === r.truth_count;
          }).length / allResults.length
        : 0;

    // Update iteration as completed
    await supabase
      .from("iterations")
      .update({
        status: "completed",
        after_gate_score: afterGateScore,
        e2e_score: e2eScore,
      })
      .eq("id", currentIterationId);

    // Determine next step based on mode
    if (run.mode === "manual") {
      await supabase.from("runs").update({ status: "paused_manual" }).eq("id", run_id);
    } else if (e2eScore >= 1.0 || run.current_iteration >= run.max_iterations) {
      await supabase.from("runs").update({ status: "completed" }).eq("id", run_id);
    } else {
      // Auto mode: check stall and potentially create next iteration
      // For now, mark completed (prompt refinement logic can be added later)
      await supabase.from("runs").update({ status: "completed" }).eq("id", run_id);
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

async function callAI(apiKey: string, model: string, messages: any[]): Promise<string> {
  const resp = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`AI gateway ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseJsonFromText(text: string): any | null {
  try {
    // Try direct parse
    return JSON.parse(text);
  } catch {
    // Try extracting JSON from markdown code blocks
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch {
        return null;
      }
    }
    // Try finding JSON object in text
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
