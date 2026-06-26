import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDistanceToNow } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";

type Run = Tables<"runs"> & { datasets?: { name: string } | null };
type Iteration = Tables<"iterations">;

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

function getStageLabel(status?: string) {
  switch (status) {
    case "pending": return "Preparing";
    case "processing": return "Processing";
    case "scoring": return "Scoring";
    case "paused_manual": return "Paused (Manual Review)";
    default: return "Idle";
  }
}

const ACTIVE_STATUSES = new Set(["queued", "running", "paused_manual", "stopping"]);

export function RunProgressSection({ run, iterations }: { run: Run; iterations?: Iteration[] }) {
  const isActive = ACTIVE_STATUSES.has(run.status);
  const latestIteration = iterations?.at(-1);
  const activeIteration = latestIteration && ["processing", "scoring", "pending"].includes(latestIteration.status)
    ? latestIteration : null;

  // Total files
  const { data: totalFiles } = useQuery({
    queryKey: ["dataset-file-count", run.dataset_id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("dataset_files")
        .select("id", { count: "exact", head: true })
        .eq("dataset_id", run.dataset_id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Processed files for active iteration
  const { data: processedFiles, refetch: refetchProcessed } = useQuery({
    queryKey: ["iteration-result-count", activeIteration?.id],
    enabled: !!activeIteration,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("iteration_results")
        .select("id", { count: "exact", head: true })
        .eq("iteration_id", activeIteration!.id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Realtime for iteration_results count
  useEffect(() => {
    if (!activeIteration) return;
    const channel = supabase
      .channel(`progress-${activeIteration.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "iteration_results",
        filter: `iteration_id=eq.${activeIteration.id}`,
      }, () => refetchProcessed())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeIteration?.id, refetchProcessed]);

  // Elapsed time
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!isActive) {
      setElapsed("—");
      return;
    }
    const start = new Date(run.created_at).getTime();
    const tick = () => setElapsed(formatElapsed(Date.now() - start));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isActive, run.created_at]);

  // Last activity (prefer iteration.last_progress_at when present)
  const lastActivity = useMemo(() => {
    const dates = [new Date(run.updated_at)];
    if (latestIteration) dates.push(new Date(latestIteration.created_at));
    const lpa = (latestIteration as any)?.last_progress_at;
    if (lpa) dates.push(new Date(lpa));
    return new Date(Math.max(...dates.map(d => d.getTime())));
  }, [run.updated_at, latestIteration?.created_at, (latestIteration as any)?.last_progress_at]);

  const progressLog: { ts: string; message: string }[] = Array.isArray((latestIteration as any)?.progress_log)
    ? ((latestIteration as any).progress_log as any[]).slice(-5).reverse()
    : [];

  const stage = getStageLabel(latestIteration?.status);
  const total = totalFiles ?? 0;
  const processed = activeIteration ? (processedFiles ?? 0) : 0;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Stage: {stage}</span>
          <span className="text-muted-foreground font-mono">{elapsed}</span>
        </div>
        {activeIteration && total > 0 && (
          <div className="space-y-1">
            <Progress value={pct} className="h-2" />
            <p className="text-xs text-muted-foreground">{processed} / {total} files</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Last activity: {formatDistanceToNow(lastActivity, { addSuffix: true })}
        </p>
        {progressLog.length > 0 && (
          <div className="mt-2 border-t pt-2 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Recent activity</p>
            <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {progressLog.map((p, i) => (
                <li key={i} className="truncate">
                  <span className="opacity-60">{new Date(p.ts).toLocaleTimeString()}</span> — {p.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
