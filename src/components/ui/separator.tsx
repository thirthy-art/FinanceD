import * as React from "react";
import { cn } from "@/src/lib/utils";

function Separator({ className, orientation = "horizontal", decorative = true, ...props }: React.ComponentProps<"div"> & { orientation?: "horizontal" | "vertical"; decorative?: boolean }) {
  return <div data-slot="separator" role={decorative ? "none" : "separator"} aria-orientation={decorative ? undefined : orientation} className={cn("shrink-0 bg-[var(--border)]", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)} {...props} />;
}

export { Separator };
