import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Play, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function Runs() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: runs, isLoading } = useQuery({
    queryKey: ["runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("runs")
        .select("*, datasets(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch latest iteration scores for all runs
  const runIds = runs?.map((r) => r.id) ?? [];
  const { data: latestIterations } = useQuery({
    queryKey: ["latest-iterations", runIds],
    enabled: runIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("iterations")
        .select("run_id, iteration_number, e2e_score, after_gate_score, status")
        .in("run_id", runIds)
        .order("iteration_number", { ascending: false });
      if (error) throw error;
      // Get latest per run
      const map = new Map<string, (typeof data)[0]>();
      for (const iter of data) {
        if (!map.has(iter.run_id)) map.set(iter.run_id, iter);
      }
      return map;
    },
  });

  const handleDelete = async (e: React.MouseEvent, runId: string) => {
    e.stopPropagation();
    try {
      const { error } = await supabase.from("runs").delete().eq("id", runId);
      if (error) throw error;
      toast.success("Run deleted");
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to delete run");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Runs</h1>
          <p className="text-sm text-muted-foreground">Prompt optimization runs</p>
        </div>
        <Button onClick={() => navigate("/runs/new")}>
          <Plus className="mr-2 h-4 w-4" />
          New Run
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : runs?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Play className="h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">No runs yet. Start one to begin optimizing.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Dataset</TableHead>
                <TableHead>Asset Type</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Iteration</TableHead>
                <TableHead>Accuracy</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs?.map((run) => {
                const latest = latestIterations?.get(run.id);
                const accuracy = latest?.e2e_score != null ? Math.round(Number(latest.e2e_score) * 100) : null;
                return (
                  <TableRow
                    key={run.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/runs/${run.id}`)}
                  >
                    <TableCell className="font-mono text-xs">{run.id.slice(0, 8)}</TableCell>
                    <TableCell>{(run as any).datasets?.name ?? "—"}</TableCell>
                    <TableCell>{run.asset_type}</TableCell>
                    <TableCell className="capitalize">{run.mode}</TableCell>
                    <TableCell><StatusBadge status={run.status} /></TableCell>
                    <TableCell>{run.current_iteration}</TableCell>
                    <TableCell>{accuracy != null ? `${accuracy}%` : "—"}</TableCell>
                    <TableCell className="text-sm">{new Date(run.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Run</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete this run and all its iterations and results. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={(e) => handleDelete(e, run.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
