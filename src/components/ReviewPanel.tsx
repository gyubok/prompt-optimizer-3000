import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Play, Square, Edit, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type Run = Tables<"runs">;
type Iteration = Tables<"iterations">;

interface ReviewPanelProps {
  run: Run;
  latestIteration?: Iteration;
}

export function ReviewPanel({ run, latestIteration }: ReviewPanelProps) {
  const lastPrompt = latestIteration?.prompt_text ?? run.initial_prompt;
  const [promptText, setPromptText] = useState(lastPrompt);
  const [isEditing, setIsEditing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const handleStartNext = async () => {
    setIsStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("start-run", {
        body: {
          run_id: run.id,
          start_next: true,
          prompt_text: promptText,
        },
      });
      if (error) throw error;
      toast.success("Next iteration started");
      setIsEditing(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to start next iteration");
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    const { error } = await supabase.from("runs").update({ status: "stopped" }).eq("id", run.id);
    if (error) toast.error(error.message);
    else toast.success("Run stopped");
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Review & Start Next Iteration</CardTitle>
        <p className="text-sm text-muted-foreground">
          Review the results above, then adjust the prompt if needed and start the next iteration.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Prompt for Iteration {(latestIteration?.iteration_number ?? 0) + 1}
            </p>
            {!isEditing && (
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)} className="h-7 text-xs">
                <Edit className="mr-1 h-3 w-3" /> Edit
              </Button>
            )}
          </div>
          {isEditing ? (
            <Textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              className="min-h-[200px] font-mono text-sm"
            />
          ) : (
            <div className="bg-background border rounded-md p-3 text-sm font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              {promptText}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button onClick={handleStartNext} disabled={isStarting || !promptText.trim()}>
            {isStarting ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Play className="mr-1 h-3 w-3" />
            )}
            Start Next Iteration
          </Button>
          <Button variant="destructive" size="default" onClick={handleStop}>
            <Square className="mr-1 h-3 w-3" /> Stop Run
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
