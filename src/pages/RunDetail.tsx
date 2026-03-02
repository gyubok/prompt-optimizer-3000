import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { Square, Check, X, Edit } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [editPrompt, setEditPrompt] = useState("");
  const [editing, setEditing] = useState(false);

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

  const [selectedIteration, setSelectedIteration] = useState<string | null>(null);

  const { data: results } = useQuery({
    queryKey: ["iteration-results", selectedIteration],
    enabled: !!selectedIteration,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("iteration_results")
        .select("*")
        .eq("iteration_id", selectedIteration!)
        .order("file_name");
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

  const handleStop = async () => {
    const { error } = await supabase.from("runs").update({ status: "stopping" }).eq("id", id!);
    if (error) toast.error(error.message);
    else toast.success("Stop signal sent");
  };

  const handleApprove = async () => {
    const { error } = await supabase.from("runs").update({ status: "running" }).eq("id", id!);
    if (error) toast.error(error.message);
    else toast.success("Run approved to continue");
  };

  const handleReject = async () => {
    const { error } = await supabase.from("runs").update({ status: "stopped" }).eq("id", id!);
    if (error) toast.error(error.message);
    else toast.success("Run rejected");
  };

  const handleEditPrompt = async () => {
    if (!selectedIteration || !editPrompt) return;
    const { error } = await supabase
      .from("iterations")
      .update({ prompt_text: editPrompt, status: "pending" })
      .eq("id", selectedIteration);
    if (error) toast.error(error.message);
    else {
      await supabase.from("runs").update({ status: "running" }).eq("id", id!);
      toast.success("Prompt updated, resuming run");
      setEditing(false);
    }
  };

  const chartData = iterations?.map((iter) => ({
    iteration: iter.iteration_number,
    afterGate: iter.after_gate_score ? Number(iter.after_gate_score) : null,
    e2e: iter.e2e_score ? Number(iter.e2e_score) : null,
  })) ?? [];

  const chartConfig = {
    afterGate: { label: "After-Gate Score", color: "hsl(var(--primary))" },
    e2e: { label: "E2E Score", color: "hsl(var(--muted-foreground))" },
  };

  if (!run) return <p className="text-muted-foreground">Loading...</p>;

  const isPaused = run.status === "paused_manual";
  const isRunning = run.status === "running";

  return (
    <div className="space-y-6">
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
        <div className="flex gap-2">
          {(isRunning || run.status === "stopping") && (
            <Button variant="destructive" size="sm" onClick={handleStop}>
              <Square className="mr-1 h-3 w-3" /> Stop
            </Button>
          )}
          {isPaused && (
            <>
              <Button size="sm" onClick={handleApprove}>
                <Check className="mr-1 h-3 w-3" /> Approve
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditing(!editing)}>
                <Edit className="mr-1 h-3 w-3" /> Edit Prompt
              </Button>
              <Button variant="destructive" size="sm" onClick={handleReject}>
                <X className="mr-1 h-3 w-3" /> Reject
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Edit prompt panel */}
      {editing && isPaused && (
        <Card>
          <CardHeader><CardTitle className="text-base">Edit Prompt</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              className="min-h-[200px] font-mono text-sm"
              placeholder="Enter revised prompt..."
            />
            <div className="flex gap-2">
              <Button onClick={handleEditPrompt}>Save & Continue</Button>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Current Iteration</p>
            <p className="text-2xl font-bold">{run.current_iteration}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Best After-Gate</p>
            <p className="text-2xl font-bold">
              {iterations?.length
                ? Math.max(...iterations.filter((i) => i.after_gate_score != null).map((i) => Number(i.after_gate_score))).toFixed(2) || "—"
                : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Pass 1 Threshold</p>
            <p className="text-2xl font-bold">{run.pass1_threshold}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Cumulative Cost</p>
            <p className="text-2xl font-bold">
              ${iterations?.length
                ? iterations[iterations.length - 1].cumulative_cost?.toFixed(4) ?? "—"
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="iterations">
        <TabsList>
          <TabsTrigger value="iterations">Iterations</TabsTrigger>
          <TabsTrigger value="chart">Accuracy Trend</TabsTrigger>
          <TabsTrigger value="results">Per-Page Results</TabsTrigger>
          <TabsTrigger value="reasoning">Reasoning</TabsTrigger>
        </TabsList>

        <TabsContent value="iterations" className="mt-4">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>After-Gate</TableHead>
                  <TableHead>E2E</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {iterations?.map((iter) => (
                  <TableRow
                    key={iter.id}
                    className={`cursor-pointer ${selectedIteration === iter.id ? "bg-accent" : ""}`}
                    onClick={() => setSelectedIteration(iter.id)}
                  >
                    <TableCell>{iter.iteration_number}</TableCell>
                    <TableCell>{iter.after_gate_score != null ? Number(iter.after_gate_score).toFixed(4) : "—"}</TableCell>
                    <TableCell>{iter.e2e_score != null ? Number(iter.e2e_score).toFixed(4) : "—"}</TableCell>
                    <TableCell>${iter.estimated_cost?.toFixed(4) ?? "—"}</TableCell>
                    <TableCell><StatusBadge status={iter.status} /></TableCell>
                  </TableRow>
                ))}
                {(!iterations || iterations.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">No iterations yet</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="chart" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              {chartData.length > 0 ? (
                <ChartContainer config={chartConfig} className="h-[300px]">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="iteration" />
                    <YAxis domain={[0, 1]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="afterGate" stroke="var(--color-afterGate)" strokeWidth={2} dot />
                    <Line type="monotone" dataKey="e2e" stroke="var(--color-e2e)" strokeWidth={2} dot strokeDasharray="5 5" />
                  </LineChart>
                </ChartContainer>
              ) : (
                <p className="py-12 text-center text-muted-foreground">No data yet</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="results" className="mt-4">
          {selectedIteration ? (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Page</TableHead>
                    <TableHead>Pass 1</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Predicted</TableHead>
                    <TableHead>Truth</TableHead>
                    <TableHead>Delta</TableHead>
                    <TableHead>Valid JSON</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results?.map((r) => (
                    <TableRow key={r.id} className={r.delta !== 0 ? "bg-destructive/5" : ""}>
                      <TableCell className="text-xs font-mono">{r.file_name}</TableCell>
                      <TableCell>{r.page_number}</TableCell>
                      <TableCell>{r.pass1_relevant ? "✓" : "✗"}</TableCell>
                      <TableCell>{r.pass1_confidence?.toFixed(2) ?? "—"}</TableCell>
                      <TableCell>{r.predicted_count}</TableCell>
                      <TableCell>{r.truth_count}</TableCell>
                      <TableCell className={r.delta !== 0 ? "text-destructive font-semibold" : ""}>{r.delta}</TableCell>
                      <TableCell>{r.pass2_valid_json === false ? "✗" : r.pass2_valid_json === true ? "✓" : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {(!results || results.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">Select an iteration to view results</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground">Select an iteration from the Iterations tab first</p>
          )}
        </TabsContent>

        <TabsContent value="reasoning" className="mt-4">
          {selectedIteration && iterations ? (
            (() => {
              const iter = iterations.find((i) => i.id === selectedIteration);
              const reasoning = iter?.reasoning_json as any;
              if (!reasoning) return <p className="text-muted-foreground">No reasoning data for this iteration</p>;
              return (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Changes Made</CardTitle></CardHeader>
                    <CardContent><p className="text-sm">{reasoning.changes_made || "—"}</p></CardContent>
                  </Card>
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Analysis</CardTitle></CardHeader>
                    <CardContent><p className="text-sm">{reasoning.analysis || "—"}</p></CardContent>
                  </Card>
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Strategy Adjustment</CardTitle></CardHeader>
                    <CardContent><p className="text-sm">{reasoning.strategy_adjustment || "—"}</p></CardContent>
                  </Card>
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Risk Note</CardTitle></CardHeader>
                    <CardContent><p className="text-sm">{reasoning.risk_note || "—"}</p></CardContent>
                  </Card>
                </div>
              );
            })()
          ) : (
            <p className="text-muted-foreground">Select an iteration to view reasoning</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
