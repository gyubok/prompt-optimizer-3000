import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { RunProgressSection } from "@/components/RunProgressSection";
import { IterationCard } from "@/components/IterationCard";
import { ReviewPanel } from "@/components/ReviewPanel";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: run, refetch: refetchRun } = useQuery({
    queryKey: ["run", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("runs")
        .select("*, datasets(name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: iterations, refetch: refetchIterations } = useQuery({
    queryKey: ["iterations", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("iterations")
        .select("*")
        .eq("run_id", id!)
        .order("iteration_number", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Realtime subscriptions
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`run-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "runs", filter: `id=eq.${id}` }, () => refetchRun())
      .on("postgres_changes", { event: "*", schema: "public", table: "iterations", filter: `run_id=eq.${id}` }, () => refetchIterations())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, refetchRun, refetchIterations]);

  const handleDelete = async () => {
    try {
      const { error } = await supabase.from("runs").delete().eq("id", id!);
      if (error) throw error;
      toast.success("Run deleted");
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      navigate("/runs");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete run");
    }
  };

  if (!run) return <p className="text-muted-foreground">Loading...</p>;

  const isPaused = run.status === "paused_manual";
  const isRunning = run.status === "running";
  const latestIteration = iterations?.at(-1);
  const scores = iterations?.filter((i) => i.after_gate_score != null).map((i) => Number(i.after_gate_score)) ?? [];
  const bestFiltered = scores.length > 0 ? Math.max(...scores) : null;

  // Chart data
  const chartData = iterations?.filter(i => i.after_gate_score != null || i.e2e_score != null).map((iter) => ({
    iteration: iter.iteration_number,
    filtered: iter.after_gate_score ? Math.round(Number(iter.after_gate_score) * 100) : null,
    overall: iter.e2e_score ? Math.round(Number(iter.e2e_score) * 100) : null,
  })) ?? [];

  const chartConfig = {
    filtered: { label: "Accuracy (Filtered)", color: "hsl(var(--primary))" },
    overall: { label: "Accuracy (Overall)", color: "hsl(var(--muted-foreground))" },
  };

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={() => navigate("/runs")} className="text-muted-foreground hover:text-foreground -ml-2">
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to Runs
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Run {run.id.slice(0, 8)}</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {(run as any).datasets?.name} · {run.asset_type} · {run.mode} mode
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
              <Trash2 className="mr-1 h-4 w-4" /> Delete Run
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Run</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this run and all its iterations and results. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Compact stats */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span>
          <span className="text-muted-foreground">Iteration:</span>{" "}
          <span className="font-semibold">{run.current_iteration}</span>
          <span className="text-muted-foreground"> / {run.max_iterations} max</span>
        </span>
        {bestFiltered != null && !isNaN(bestFiltered) && (
          <span>
            <span className="text-muted-foreground">Best Accuracy:</span>{" "}
            <span className="font-semibold">{Math.round(bestFiltered * 100)}%</span>
          </span>
        )}
        <span>
          <span className="text-muted-foreground">Relevance Threshold:</span>{" "}
          <span className="font-semibold">{run.pass1_threshold}</span>
        </span>
      </div>

      {/* Progress section (while processing) */}
      {(isRunning || run.status === "queued") && (
        <RunProgressSection run={run} iterations={iterations} />
      )}

      {/* Review panel (when paused) */}
      {isPaused && (
        <ReviewPanel run={run} latestIteration={latestIteration} />
      )}

      {/* Accuracy trend chart */}
      {chartData.length >= 2 && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium mb-3">Accuracy Trend</p>
            <ChartContainer config={chartConfig} className="h-[200px]">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="iteration" label={{ value: "Iteration", position: "insideBottom", offset: -5 }} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="filtered" stroke="var(--color-filtered)" strokeWidth={2} dot />
                <Line type="monotone" dataKey="overall" stroke="var(--color-overall)" strokeWidth={2} dot strokeDasharray="5 5" />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* Iteration timeline (latest first) */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Iterations</h2>
        {iterations && iterations.length > 0 ? (
          [...iterations].reverse().map((iter, idx) => (
            <IterationCard
              key={iter.id}
              iteration={iter}
              isLatest={idx === 0}
            />
          ))
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {isRunning ? (
                <div className="flex flex-col items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
                  </span>
                  <span>Preparing first iteration…</span>
                </div>
              ) : (
                "No iterations yet"
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
