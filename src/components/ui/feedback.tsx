import * as React from "react";
import { cn } from "@/src/lib/utils";

function Alert({ className, tone = "info", ...props }: React.ComponentProps<"div"> & { tone?: "info" | "success" | "warning" | "error" }) {
  return <div role={tone === "error" ? "alert" : "status"} className={cn("ui-alert", `ui-alert-${tone}`, className)} {...props} />;
}

function EmptyState({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("ui-empty-state", className)} {...props} />;
}

function LoadingState({ className, ...props }: React.ComponentProps<"div">) {
  return <div role="status" className={cn("py-8 text-sm text-[var(--muted-foreground)]", className)} {...props} />;
}

export { Alert, EmptyState, LoadingState };
