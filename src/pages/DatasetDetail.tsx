import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Trash2, ChevronRight, Pencil, FileText } from "lucide-react";
import { toast } from "sonner";
import { AnnotationDialog } from "@/components/AnnotationDialog";

type FileRow = {
  id: string;
  file_name: string;
  page_number: number;
  storage_path: string;
  created_at: string;
};

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
        .order("file_name")
        .order("page_number");
      if (error) throw error;
      return data as FileRow[];
    },
  });

  const { data: groundTruth } = useQuery({
    queryKey: ["ground-truth", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ground_truth")
        .select("*")
        .eq("dataset_id", id!)
        .order("file_name")
        .order("page_number");
      if (error) throw error;
      return data;
    },
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [annotating, setAnnotating] = useState<{ fileName: string; pageNumber: number; storagePath: string } | null>(null);

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

  // Group files by file_name
  const fileGroups = useMemo(() => {
    if (!files) return [];
    const map = new Map<string, FileRow[]>();
    for (const f of files) {
      if (!map.has(f.file_name)) map.set(f.file_name, []);
      map.get(f.file_name)!.push(f);
    }
    return Array.from(map.entries()).map(([file_name, pages]) => ({ file_name, pages }));
  }, [files]);

  // Group ground truth by file_name
  const gtGroups = useMemo(() => {
    if (!groundTruth) return [];
    const map = new Map<string, any[]>();
    for (const g of groundTruth) {
      if (!map.has(g.file_name)) map.set(g.file_name, []);
      map.get(g.file_name)!.push(g);
    }
    return Array.from(map.entries()).map(([file_name, rows]) => ({ file_name, rows }));
  }, [groundTruth]);

  // Distinct asset types in this dataset (for annotation picker)
  const assetTypes = useMemo(() => {
    const s = new Set<string>();
    groundTruth?.forEach((g: any) => s.add(g.asset_type));
    return Array.from(s).sort();
  }, [groundTruth]);

  // Count annotated boxes per (file, page) for badge display
  const annotationCount = (fileName: string, page: number) => {
    if (!groundTruth) return 0;
    return groundTruth
      .filter((g: any) => g.file_name === fileName && g.page_number === page)
      .reduce((sum: number, g: any) => sum + (Array.isArray(g.locations) ? g.locations.length : 0), 0);
  };

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
          <TabsTrigger value="files">Files ({fileGroups.length} PDFs · {files?.length ?? 0} pages)</TabsTrigger>
          <TabsTrigger value="ground-truth">Ground Truth ({groundTruth?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="mt-4">
          <div className="rounded-lg border divide-y">
            {fileGroups.map(({ file_name, pages }) => (
              <Collapsible key={file_name} defaultOpen={fileGroups.length <= 3}>
                <CollapsibleTrigger className="w-full flex items-center gap-2 p-3 hover:bg-muted/30 text-left group">
                  <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-sm flex-1">{file_name}</span>
                  <Badge variant="secondary">{pages.length} {pages.length === 1 ? "page" : "pages"}</Badge>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-3 pb-3">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-20">Page</TableHead>
                          <TableHead>Annotations</TableHead>
                          <TableHead className="w-32"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pages.map((p) => {
                          const count = annotationCount(file_name, p.page_number);
                          return (
                            <TableRow key={p.id}>
                              <TableCell>Page {p.page_number}</TableCell>
                              <TableCell>
                                {count > 0 ? (
                                  <Badge variant="default">{count} boxes</Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">None</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setAnnotating({
                                      fileName: p.file_name,
                                      pageNumber: p.page_number,
                                      storagePath: p.storage_path,
                                    })
                                  }
                                >
                                  <Pencil className="h-3 w-3 mr-1" /> Annotate
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
            {fileGroups.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">No files</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="ground-truth" className="mt-4">
          <div className="rounded-lg border divide-y">
            {gtGroups.map(({ file_name, rows }) => (
              <Collapsible key={file_name} defaultOpen={gtGroups.length <= 3}>
                <CollapsibleTrigger className="w-full flex items-center gap-2 p-3 hover:bg-muted/30 text-left group">
                  <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                  <span className="font-mono text-sm flex-1">{file_name}</span>
                  <Badge variant="secondary">{rows.length} entries</Badge>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Page</TableHead>
                        <TableHead>Asset Type</TableHead>
                        <TableHead>Count</TableHead>
                        <TableHead>Boxes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((gt: any) => (
                        <TableRow key={gt.id}>
                          <TableCell>{gt.page_number}</TableCell>
                          <TableCell>{gt.asset_type}</TableCell>
                          <TableCell>{gt.count}</TableCell>
                          <TableCell>{Array.isArray(gt.locations) ? gt.locations.length : 0}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CollapsibleContent>
              </Collapsible>
            ))}
            {gtGroups.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">No ground truth data</div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {annotating && id && (
        <AnnotationDialog
          open={!!annotating}
          onOpenChange={(o) => !o && setAnnotating(null)}
          datasetId={id}
          fileName={annotating.fileName}
          pageNumber={annotating.pageNumber}
          storagePath={annotating.storagePath}
          assetTypes={assetTypes}
        />
      )}
    </div>
  );
}
