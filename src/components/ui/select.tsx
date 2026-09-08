import * as React from "react";
import { cn } from "@/src/lib/utils";

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="select" className={cn("h-9 w-full min-w-0 rounded-md border border-[var(--input)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--foreground)] shadow-xs outline-none transition-colors focus-visible:border-[var(--primary)] focus-visible:ring-3 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-[var(--muted)] disabled:opacity-60", className)} {...props} />;
}

export { Select };
