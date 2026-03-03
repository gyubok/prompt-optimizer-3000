import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Upload, Database, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type GroundTruthRow = { file_name: string; page_number: number; asset_type: string; count: number };

export default function Datasets() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [groundTruth, setGroundTruth] = useState<GroundTruthRow[]>([]);
  const [uploading, setUploading] = useState(false);

  const { data: datasets, isLoading } = useQuery({
    queryKey: ["datasets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("datasets")
        .select("*, dataset_files(count), ground_truth(count)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("datasets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success("Dataset deleted");
    },
  });

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.trim().split("\n");
      const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
      const rows: GroundTruthRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim());
        rows.push({
          file_name: cols[header.indexOf("file_name")] || cols[0],
          page_number: parseInt(cols[header.indexOf("page_number")] || cols[1] || "1"),
          asset_type: cols[header.indexOf("asset_type")] || cols[2],
          count: parseInt(cols[header.indexOf("count")] || cols[3]),
        });
      }
      setGroundTruth(rows);
      toast.success(`Parsed ${rows.length} ground truth rows`);
    };
    reader.readAsText(file);
  };

  const handleCreate = async () => {
    if (!name || pdfFiles.length === 0 || groundTruth.length === 0) {
      toast.error("Name, PDFs, and ground truth CSV are required");
      return;
    }
    setUploading(true);
    try {
      const { data: dataset, error: dsError } = await supabase
        .from("datasets")
        .insert({ name, description })
        .select()
        .single();
      if (dsError) throw dsError;

      // Upload PDFs
      const fileRecords = [];
      for (const file of pdfFiles) {
        const storagePath = `${dataset.id}/${file.name}`;
        const { error: uploadError } = await supabase.storage.from("pdfs").upload(storagePath, file);
        if (uploadError) throw uploadError;
        fileRecords.push({
          dataset_id: dataset.id,
          file_name: file.name,
          storage_path: storagePath,
          page_number: 1,
        });
      }
      const { error: filesError } = await supabase.from("dataset_files").insert(fileRecords);
      if (filesError) throw filesError;

      // Insert ground truth
      const gtRecords = groundTruth.map((gt) => ({ ...gt, dataset_id: dataset.id }));
      const { error: gtError } = await supabase.from("ground_truth").insert(gtRecords);
      if (gtError) throw gtError;

      toast.success("Dataset created successfully");
      setOpen(false);
      setName("");
      setDescription("");
      setPdfFiles([]);
      setGroundTruth([]);
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Datasets</h1>
          <p className="text-sm text-muted-foreground">Manage PDF datasets and ground truth data</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Dataset
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Dataset</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dataset name" />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
              </div>
              <div>
                <Label>PDF Files</Label>
                <div className="mt-1 rounded-lg border-2 border-dashed border-border p-6 text-center">
                  <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {pdfFiles.length > 0 ? `${pdfFiles.length} files selected` : "Drop PDFs here or click to browse"}
                  </p>
                  <input
                    type="file"
                    multiple
                    accept=".pdf"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    style={{ position: "relative" }}
                    onChange={(e) => setPdfFiles(Array.from(e.target.files || []))}
                  />
                </div>
              </div>
              <div>
                <Label>Ground Truth CSV</Label>
                <p className="text-xs text-muted-foreground mb-1">Columns: file_name, page_number, asset_type, count</p>
                <Input type="file" accept=".csv" onChange={handleCsvUpload} />
              </div>
              {groundTruth.length > 0 && (
                <div>
                  <Label>Preview ({groundTruth.length} rows)</Label>
                  <div className="max-h-48 overflow-auto rounded border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>File</TableHead>
                          <TableHead>Page</TableHead>
                          <TableHead>Asset Type</TableHead>
                          <TableHead>Count</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groundTruth.slice(0, 10).map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs">{row.file_name}</TableCell>
                            <TableCell>{row.page_number}</TableCell>
                            <TableCell>{row.asset_type}</TableCell>
                            <TableCell>{row.count}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
              <Button onClick={handleCreate} disabled={uploading} className="w-full">
                {uploading ? "Uploading..." : "Create Dataset"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : datasets?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Database className="h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">No datasets yet. Create one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {datasets?.map((ds) => (
            <Card key={ds.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate(`/datasets/${ds.id}`)}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base">{ds.name}</CardTitle>
                  {ds.description && <p className="text-sm text-muted-foreground">{ds.description}</p>}
                </div>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(ds.id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <span>{(ds as any).dataset_files?.[0]?.count ?? 0} files</span>
                  <span>{(ds as any).ground_truth?.[0]?.count ?? 0} ground truth rows</span>
                  <span>{new Date(ds.created_at).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
