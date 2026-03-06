import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Play, Square, Edit, Loader2, Sparkles, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type Run = Tables<"runs">;
type Iteration = Tables<"iterations">;

interface ReviewPanelProps {
  run: Run;
  latestIteration?: Iteration;
}

export function ReviewPanel({ run, latestIteration }: ReviewPanelProps) {
  const reasoning = latestIteration?.reasoning_json as any;
  const suggestedPrompt = reasoning?.suggested_prompt;
  const lastPrompt = latestIteration?.prompt_text ?? run.initial_prompt;
  
  // Default to AI-suggested prompt if available, otherwise previous prompt
  const defaultPrompt = suggestedPrompt || lastPrompt;
  const [promptText, setPromptText] = useState(defaultPrompt);
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

  const handleRevertPrompt = () => {
    setPromptText(lastPrompt);
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
        {/* AI Analysis Section */}
        {reasoning && (reasoning.analysis || reasoning.changes_made) && (
          <div className="bg-accent/50 border border-accent rounded-md p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Analysis & Suggestions
            </div>
            {reasoning.analysis && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Error Analysis</p>
                <p className="text-sm">{reasoning.analysis}</p>
              </div>
            )}
            {reasoning.changes_made && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Prompt Changes</p>
                <p className="text-sm">{reasoning.changes_made}</p>
              </div>
            )}
            {reasoning.strategy_adjustment && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Strategy</p>
                <p className="text-sm">{reasoning.strategy_adjustment}</p>
              </div>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {suggestedPrompt ? (
                <span className="flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  AI-Suggested Prompt for Iteration {(latestIteration?.iteration_number ?? 0) + 1}
                </span>
              ) : (
                `Prompt for Iteration ${(latestIteration?.iteration_number ?? 0) + 1}`
              )}
            </p>
            <div className="flex gap-1">
              {suggestedPrompt && promptText !== lastPrompt && (
                <Button variant="ghost" size="sm" onClick={handleRevertPrompt} className="h-7 text-xs">
                  <RotateCcw className="mr-1 h-3 w-3" /> Use Previous
                </Button>
              )}
              {!isEditing && (
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)} className="h-7 text-xs">
                  <Edit className="mr-1 h-3 w-3" /> Edit
                </Button>
              )}
            </div>
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
