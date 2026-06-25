import { useEffect, useRef, useState, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, Save } from "lucide-react";
// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

// Coordinate convention: Gemini-native normalized integers [ymin, xmin, ymax, xmax] on 0–1000.
export type Box = {
  id: string;
  label: string;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
};

interface AnnotationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: string;
  fileName: string;
  pageNumber: number;
  storagePath: string;
  assetTypes: string[]; // available asset types in this dataset's ground truth
}

const PAGE_DISPLAY_WIDTH = 800;

export function AnnotationDialog({
  open,
  onOpenChange,
  datasetId,
  fileName,
  pageNumber,
  storagePath,
  assetTypes,
}: AnnotationDialogProps) {
  const queryClient = useQueryClient();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [assetType, setAssetType] = useState<string>(assetTypes[0] ?? "");
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const [renderedSize, setRenderedSize] = useState<{ w: number; h: number }>({ w: PAGE_DISPLAY_WIDTH, h: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);

  // Reset asset type when dialog opens
  useEffect(() => {
    if (open && assetTypes.length > 0 && !assetTypes.includes(assetType)) {
      setAssetType(assetTypes[0]);
    }
  }, [open, assetTypes]);

  // Fetch signed URL for the PDF
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.storage.from("pdfs").createSignedUrl(storagePath, 3600);
      if (cancelled) return;
      if (error) {
        toast.error(`Failed to load PDF: ${error.message}`);
        return;
      }
      setPdfUrl(data.signedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, storagePath]);

  // Fetch existing ground truth row for this (file, page, asset_type)
  const { data: gtRow, refetch: refetchGt } = useQuery({
    queryKey: ["gt-locations", datasetId, fileName, pageNumber, assetType],
    queryFn: async () => {
      if (!assetType) return null;
      const { data, error } = await supabase
        .from("ground_truth")
        .select("*")
        .eq("dataset_id", datasetId)
        .eq("file_name", fileName)
        .eq("page_number", pageNumber)
        .eq("asset_type", assetType)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: open && !!assetType,
  });

  useEffect(() => {
    if (gtRow) {
      const locs = (gtRow.locations as any) ?? [];
      setBoxes(Array.isArray(locs) ? locs : []);
    } else {
      setBoxes([]);
    }
    setSelectedId(null);
  }, [gtRow?.id, assetType]);

  // Keyboard delete
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        setBoxes((prev) => prev.filter((b) => b.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, selectedId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!assetType) throw new Error("Asset type required");
      if (gtRow) {
        const { error } = await supabase
          .from("ground_truth")
          .update({ locations: boxes as any, count: Math.max(gtRow.count, boxes.length) })
          .eq("id", gtRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("ground_truth").insert({
          dataset_id: datasetId,
          file_name: fileName,
          page_number: pageNumber,
          asset_type: assetType,
          count: boxes.length,
          locations: boxes as any,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Annotations saved");
      queryClient.invalidateQueries({ queryKey: ["ground-truth", datasetId] });
      refetchGt();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Mouse handlers — overlay uses display px; we convert to 0–1000 on save
  const toNormalized = (px: number, py: number) => {
    const xN = Math.round((px / renderedSize.w) * 1000);
    const yN = Math.round((py / renderedSize.h) * 1000);
    return { xN: Math.max(0, Math.min(1000, xN)), yN: Math.max(0, Math.min(1000, yN)) };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Check if clicking an existing box
    const hit = [...boxes].reverse().find((b) => {
      const bx = (b.xmin / 1000) * renderedSize.w;
      const by = (b.ymin / 1000) * renderedSize.h;
      const bw = ((b.xmax - b.xmin) / 1000) * renderedSize.w;
      const bh = ((b.ymax - b.ymin) / 1000) * renderedSize.h;
      return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
    });
    if (hit) {
      setSelectedId(hit.id);
      return;
    }
    setSelectedId(null);
    setDrawing({ startX: x, startY: y, curX: x, curY: y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    setDrawing({ ...drawing, curX: e.clientX - rect.left, curY: e.clientY - rect.top });
  };

  const handleMouseUp = () => {
    if (!drawing) return;
    const { startX, startY, curX, curY } = drawing;
    setDrawing(null);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    if (w < 5 || h < 5) return; // ignore tiny drags
    const x1 = Math.min(startX, curX);
    const y1 = Math.min(startY, curY);
    const x2 = Math.max(startX, curX);
    const y2 = Math.max(startY, curY);
    const p1 = toNormalized(x1, y1);
    const p2 = toNormalized(x2, y2);
    const newBox: Box = {
      id: crypto.randomUUID(),
      label: assetType || "asset",
      xmin: p1.xN,
      ymin: p1.yN,
      xmax: p2.xN,
      ymax: p2.yN,
    };
    setBoxes((prev) => [...prev, newBox]);
    setSelectedId(newBox.id);
  };

  const selectedBox = useMemo(() => boxes.find((b) => b.id === selectedId) ?? null, [boxes, selectedId]);

  const updateSelectedLabel = (label: string) => {
    if (!selectedId) return;
    setBoxes((prev) => prev.map((b) => (b.id === selectedId ? { ...b, label } : b)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Annotate — {fileName} · Page {pageNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_280px] gap-4">
          {/* PDF + overlay */}
          <div className="relative inline-block bg-muted/30 rounded border self-start">
            {pdfUrl ? (
              <Document file={pdfUrl} loading={<p className="p-8 text-sm">Loading PDF…</p>} error={<p className="p-8 text-sm text-destructive">Failed to load PDF</p>}>
                <Page
                  pageNumber={pageNumber}
                  width={PAGE_DISPLAY_WIDTH}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  onRenderSuccess={(page) => {
                    setRenderedSize({ w: page.width, h: page.height });
                  }}
                />
              </Document>
            ) : (
              <div className="p-8 text-sm text-muted-foreground">Loading…</div>
            )}
            <div
              ref={overlayRef}
              className="absolute inset-0 cursor-crosshair"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {boxes.map((b) => {
                const bx = (b.xmin / 1000) * renderedSize.w;
                const by = (b.ymin / 1000) * renderedSize.h;
                const bw = ((b.xmax - b.xmin) / 1000) * renderedSize.w;
                const bh = ((b.ymax - b.ymin) / 1000) * renderedSize.h;
                const isSel = b.id === selectedId;
                return (
                  <div
                    key={b.id}
                    className={`absolute border-2 ${isSel ? "border-primary bg-primary/10" : "border-emerald-500 bg-emerald-500/10"}`}
                    style={{ left: bx, top: by, width: bw, height: bh }}
                  >
                    <span className="absolute -top-5 left-0 text-[10px] bg-background px-1 rounded border">
                      {b.label}
                    </span>
                  </div>
                );
              })}
              {drawing && (
                <div
                  className="absolute border-2 border-primary/70 bg-primary/5 pointer-events-none"
                  style={{
                    left: Math.min(drawing.startX, drawing.curX),
                    top: Math.min(drawing.startY, drawing.curY),
                    width: Math.abs(drawing.curX - drawing.startX),
                    height: Math.abs(drawing.curY - drawing.startY),
                  }}
                />
              )}
            </div>
          </div>

          {/* Side panel */}
          <div className="space-y-4">
            <div>
              <Label>Asset Type</Label>
              {assetTypes.length > 0 ? (
                <Select value={assetType} onValueChange={setAssetType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assetTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={assetType} onChange={(e) => setAssetType(e.target.value)} placeholder="e.g. door" />
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Annotations are saved per asset type.
              </p>
            </div>

            <div>
              <Label>Boxes ({boxes.length})</Label>
              <div className="max-h-64 overflow-y-auto space-y-1 mt-1">
                {boxes.map((b, i) => (
                  <div
                    key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    className={`text-xs p-2 rounded border cursor-pointer flex items-center justify-between ${
                      b.id === selectedId ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <span>
                      #{i + 1} {b.label}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBoxes((prev) => prev.filter((x) => x.id !== b.id));
                        if (selectedId === b.id) setSelectedId(null);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {boxes.length === 0 && (
                  <p className="text-xs text-muted-foreground">Drag on the PDF to draw a box.</p>
                )}
              </div>
            </div>

            {selectedBox && (
              <div className="space-y-2 rounded border p-3 bg-muted/30">
                <Label>Selected label</Label>
                <Input
                  value={selectedBox.label}
                  onChange={(e) => updateSelectedLabel(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground font-mono">
                  [{selectedBox.ymin}, {selectedBox.xmin}, {selectedBox.ymax}, {selectedBox.xmax}]
                </p>
                <p className="text-[10px] text-muted-foreground">Press Delete to remove.</p>
              </div>
            )}

            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !assetType}
              className="w-full"
            >
              <Save className="h-3 w-3 mr-1" /> Save Annotations
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
