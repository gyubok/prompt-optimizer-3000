import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Runs() {
  const navigate = useNavigate();

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
                <TableHead>Pass 1 Threshold</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs?.map((run) => (
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
                  <TableCell>{run.pass1_threshold}</TableCell>
                  <TableCell className="text-sm">{new Date(run.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
