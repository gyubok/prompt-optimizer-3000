import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function DatasetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: dataset, isLoading } = useQuery({
    queryKey: ["dataset", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("datasets")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: files } = useQuery({
    queryKey: ["dataset-files", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dataset_files")
        .select("*")
        .eq("dataset_id", id!)
        .order("file_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: groundTruth } = useQuery({
    queryKey: ["ground-truth", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ground_truth")
        .select("*")
        .eq("dataset_id", id!)
        .order("file_name");
      if (error) throw error;
      return data;
    },
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (dataset) {
      setName(dataset.name);
      setDescription(dataset.description ?? "");
    }
  }, [dataset]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("datasets")
        .update({ name, description: description || null })
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dataset", id] });
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success("Dataset updated");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("datasets").delete().eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success("Dataset deleted");
      navigate("/datasets");
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;
  if (!dataset) return <p className="text-muted-foreground">Dataset not found</p>;

  const hasChanges = name !== dataset.name || (description || "") !== (dataset.description || "");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/datasets")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{dataset.name}</h1>
          <p className="text-sm text-muted-foreground">
            Created {new Date(dataset.created_at).toLocaleDateString()}
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            if (confirm("Delete this dataset? This cannot be undone.")) {
              deleteMutation.mutate();
            }
          }}
        >
          <Trash2 className="mr-1 h-3 w-3" /> Delete
        </Button>
      </div>

      {/* Edit section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          {hasChanges && (
            <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              <Save className="mr-1 h-3 w-3" /> Save Changes
            </Button>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="files">
        <TabsList>
          <TabsTrigger value="files">Files ({files?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="ground-truth">Ground Truth ({groundTruth?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="mt-4">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead>Page</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files?.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">{f.file_name}</TableCell>
                    <TableCell>{f.page_number}</TableCell>
                    <TableCell className="text-sm">{new Date(f.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
                {(!files || files.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      No files
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="ground-truth" className="mt-4">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead>Page</TableHead>
                  <TableHead>Asset Type</TableHead>
                  <TableHead>Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groundTruth?.map((gt) => (
                  <TableRow key={gt.id}>
                    <TableCell className="font-mono text-xs">{gt.file_name}</TableCell>
                    <TableCell>{gt.page_number}</TableCell>
                    <TableCell>{gt.asset_type}</TableCell>
                    <TableCell>{gt.count}</TableCell>
                  </TableRow>
                ))}
                {(!groundTruth || groundTruth.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No ground truth data
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
