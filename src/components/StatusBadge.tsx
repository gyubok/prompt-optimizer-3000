import { Badge } from "@/components/ui/badge";
import type { Enums } from "@/integrations/supabase/types";

const statusConfig: Record<string, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-muted text-muted-foreground" },
  running: { label: "Running", className: "bg-info text-info-foreground" },
  paused_manual: { label: "Paused", className: "bg-warning text-warning-foreground" },
  stopping: { label: "Stopping", className: "bg-warning text-warning-foreground" },
  stopped: { label: "Stopped", className: "bg-muted text-muted-foreground" },
  completed: { label: "Completed", className: "bg-success text-success-foreground" },
  failed: { label: "Failed", className: "bg-destructive text-destructive-foreground" },
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  processing: { label: "Processing", className: "bg-info text-info-foreground" },
  scoring: { label: "Scoring", className: "bg-info text-info-foreground" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <Badge variant="secondary" className={config.className}>
      {config.label}
    </Badge>
  );
}
