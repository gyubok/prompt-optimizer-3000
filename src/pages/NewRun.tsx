import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function NewRun() {
  const navigate = useNavigate();
  const [datasetId, setDatasetId] = useState("");
  const [assetType, setAssetType] = useState("");
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [prompt, setPrompt] = useState("");
  const [pass1Threshold, setPass1Threshold] = useState(0.7);
  const [maxIterations, setMaxIterations] = useState(20);
  const [stallThreshold, setStallThreshold] = useState(3);
  const [floorPlanPrompt, setFloorPlanPrompt] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const { data: datasets } = useQuery({
    queryKey: ["datasets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("datasets").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: assetTypes } = useQuery({
    queryKey: ["asset-types", datasetId],
    enabled: !!datasetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ground_truth")
        .select("asset_type")
        .eq("dataset_id", datasetId);
      if (error) throw error;
      const unique = [...new Set(data.map((d) => d.asset_type))];
      return unique;
    },
  });

  const createRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("runs")
        .insert({
          dataset_id: datasetId,
          asset_type: assetType,
          mode,
          initial_prompt: prompt,
          pass1_threshold: pass1Threshold,
          max_iterations: maxIterations,
          stall_threshold: stallThreshold,
          status: "queued",
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("Run created – processing started");
      // Fire-and-forget: invoke edge function to start processing
      supabase.functions.invoke("start-run", { body: { run_id: data.id } }).catch((err) =>
        console.error("Failed to invoke start-run:", err)
      );
      navigate(`/runs/${data.id}`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Run</h1>
        <p className="text-sm text-muted-foreground">Configure and start a prompt optimization run</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Dataset</Label>
              <Select value={datasetId} onValueChange={setDatasetId}>
                <SelectTrigger><SelectValue placeholder="Select dataset" /></SelectTrigger>
                <SelectContent>
                  {datasets?.map((ds) => (
                    <SelectItem key={ds.id} value={ds.id}>{ds.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Asset Type</Label>
              <Select value={assetType} onValueChange={setAssetType} disabled={!datasetId}>
                <SelectTrigger><SelectValue placeholder="Select asset type" /></SelectTrigger>
                <SelectContent>
                  {assetTypes?.map((at) => (
                    <SelectItem key={at} value={at}>{at}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Label>Mode</Label>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${mode === "auto" ? "text-foreground" : "text-muted-foreground"}`}>Auto</span>
              <Switch checked={mode === "manual"} onCheckedChange={(v) => setMode(v ? "manual" : "auto")} />
              <span className={`text-sm ${mode === "manual" ? "text-foreground" : "text-muted-foreground"}`}>Manual</span>
            </div>
          </div>

          <div>
            <Label>Initial Detection Prompt (Pass 2)</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter your detection prompt..."
              className="mt-1 min-h-[200px] font-mono text-sm"
            />
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
              Advanced Settings
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-4">
              <div>
                <Label>Pass 1 Threshold: {pass1Threshold.toFixed(2)}</Label>
                <Slider
                  value={[pass1Threshold]}
                  onValueChange={([v]) => setPass1Threshold(v)}
                  min={0}
                  max={1}
                  step={0.05}
                  className="mt-2"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Max Iterations</Label>
                  <Input type="number" value={maxIterations} onChange={(e) => setMaxIterations(parseInt(e.target.value))} />
                </div>
                <div>
                  <Label>Stall Threshold</Label>
                  <Input type="number" value={stallThreshold} onChange={(e) => setStallThreshold(parseInt(e.target.value))} />
                  <p className="mt-1 text-xs text-muted-foreground">Stop after N iterations without improvement</p>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Button
            onClick={() => createRun.mutate()}
            disabled={!datasetId || !assetType || !prompt || createRun.isPending}
            className="w-full"
          >
            <Play className="mr-2 h-4 w-4" />
            {createRun.isPending ? "Starting..." : "Start Run"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
