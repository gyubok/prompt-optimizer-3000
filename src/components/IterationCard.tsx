import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusBadge } from "@/components/StatusBadge";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Iteration = Tables<"iterations">;

export function IterationCard({ iteration, isLatest }: { iteration: Iteration; isLatest: boolean }) {
  const shouldAutoExpand = isLatest && iteration.status === "completed";
  const [resultsOpen, setResultsOpen] = useState(shouldAutoExpand);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  const { data: results } = useQuery({
    queryKey: ["iteration-results", iteration.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("iteration_results")
        .select("*")
        .eq("iteration_id", iteration.id)
        .order("file_name");
      if (error) throw error;
      return data;
    },
  });

  const totalPages = results?.length ?? 0;
  const relevantPages = results?.filter((r) => r.pass1_relevant).length ?? 0;
  const correctFiltered = results?.filter((r) => r.pass1_relevant && r.predicted_count === r.truth_count).length ?? 0;
  const correctOverall = results?.filter((r) => {
    if (!r.pass1_relevant) return r.truth_count === 0;
    return r.predicted_count === r.truth_count;
  }).length ?? 0;
  const invalidOutputs = results?.filter((r) => r.pass2_valid_json === false).length ?? 0;

  const filteredAccuracy = relevantPages > 0 ? Math.round((correctFiltered / relevantPages) * 100) : null;
  const overallAccuracy = totalPages > 0 ? Math.round((correctOverall / totalPages) * 100) : null;

  const reasoning = iteration.reasoning_json as any;

  return (
    <Card className={isLatest ? "border-primary/50 shadow-md" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="bg-muted text-muted-foreground rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold">
              {iteration.iteration_number}
            </span>
            Iteration {iteration.iteration_number}
          </CardTitle>
          <StatusBadge status={iteration.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Prompt used */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Prompt Used</p>
          <div className="bg-muted/50 border rounded-md p-3 text-sm font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto">
            {iteration.prompt_text}
          </div>
        </div>

        {/* Prompt changes from previous */}
        {iteration.prompt_diff && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Changes from Previous</p>
            <p className="text-sm text-muted-foreground">{iteration.prompt_diff}</p>
          </div>
        )}

        {/* Results summary */}
        {iteration.status === "completed" && totalPages > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-muted/30 rounded-md p-2.5">
              <p className="text-xs text-muted-foreground">Accuracy (Filtered)</p>
              <p className="text-lg font-bold">{filteredAccuracy !== null ? `${filteredAccuracy}%` : "—"}</p>
              <p className="text-xs text-muted-foreground">{correctFiltered}/{relevantPages} correct</p>
            </div>
            <div className="bg-muted/30 rounded-md p-2.5">
              <p className="text-xs text-muted-foreground">Accuracy (Overall)</p>
              <p className="text-lg font-bold">{overallAccuracy !== null ? `${overallAccuracy}%` : "—"}</p>
              <p className="text-xs text-muted-foreground">{correctOverall}/{totalPages} correct</p>
            </div>
            <div className="bg-muted/30 rounded-md p-2.5">
              <p className="text-xs text-muted-foreground">Pages Analyzed</p>
              <p className="text-lg font-bold">{totalPages}</p>
              <p className="text-xs text-muted-foreground">{relevantPages} relevant</p>
            </div>
            <div className="bg-muted/30 rounded-md p-2.5">
              <p className="text-xs text-muted-foreground">Issues</p>
              <p className="text-lg font-bold">{invalidOutputs}</p>
              <p className="text-xs text-muted-foreground">invalid outputs</p>
            </div>
          </div>
        )}

        {/* Failed / no results state */}
        {iteration.status === "completed" && totalPages === 0 && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 text-sm text-destructive">
            Processing failed — no results were recorded. This may be due to rate limiting or a timeout.
          </div>
        )}
        {iteration.status === "failed" && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 text-sm text-destructive">
            This iteration failed. The AI service may have been unavailable or rate limited.
          </div>
        )}

        {/* Processing indicator */}
        {["processing", "scoring", "pending"].includes(iteration.status) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
            </span>
            {iteration.status === "processing" ? "Processing files…" : iteration.status === "scoring" ? "Scoring results…" : "Preparing…"}
          </div>
        )}

        {/* Expandable: Per-page results */}
        {results && results.length > 0 && (
          <Collapsible open={resultsOpen} onOpenChange={setResultsOpen}>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              {resultsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <FileText className="h-4 w-4" />
              Per-Page Results ({results.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="rounded-lg border max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Page</TableHead>
                      <TableHead>Relevant?</TableHead>
                      <TableHead>AI Count</TableHead>
                      <TableHead>Actual Count</TableHead>
                      <TableHead>Correct?</TableHead>
                      <TableHead>Valid Output</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => {
                      const isCorrect = r.pass1_relevant
                        ? r.predicted_count === r.truth_count
                        : r.truth_count === 0;
                      return (
                        <TableRow key={r.id} className={!isCorrect ? "bg-destructive/5" : ""}>
                          <TableCell className="text-xs font-mono">{r.file_name}</TableCell>
                          <TableCell>{r.page_number}</TableCell>
                          <TableCell>{r.pass1_relevant ? "✓" : "✗"}</TableCell>
                          <TableCell>{r.predicted_count}</TableCell>
                          <TableCell>{r.truth_count}</TableCell>
                          <TableCell className={!isCorrect ? "text-destructive font-semibold" : "text-green-600"}>
                            {isCorrect ? "✓" : `✗ (${r.predicted_count - r.truth_count > 0 ? "+" : ""}${r.predicted_count - r.truth_count})`}
                          </TableCell>
                          <TableCell>{r.pass2_valid_json === false ? "✗" : r.pass2_valid_json === true ? "✓" : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Expandable: AI Reasoning */}
        {reasoning && (
          <Collapsible open={reasoningOpen} onOpenChange={setReasoningOpen}>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              {reasoningOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              AI Reasoning
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="grid gap-3 sm:grid-cols-2">
                {reasoning.changes_made && (
                  <div className="bg-muted/30 rounded-md p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Changes Made</p>
                    <p className="text-sm">{reasoning.changes_made}</p>
                  </div>
                )}
                {reasoning.analysis && (
                  <div className="bg-muted/30 rounded-md p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Analysis</p>
                    <p className="text-sm">{reasoning.analysis}</p>
                  </div>
                )}
                {reasoning.strategy_adjustment && (
                  <div className="bg-muted/30 rounded-md p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Strategy Adjustment</p>
                    <p className="text-sm">{reasoning.strategy_adjustment}</p>
                  </div>
                )}
                {reasoning.risk_note && (
                  <div className="bg-muted/30 rounded-md p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Risk Note</p>
                    <p className="text-sm">{reasoning.risk_note}</p>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Cost info */}
        {iteration.estimated_cost != null && (
          <p className="text-xs text-muted-foreground">
            Cost: ${iteration.estimated_cost.toFixed(4)}
            {iteration.cumulative_cost != null && ` · Total: $${iteration.cumulative_cost.toFixed(4)}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
