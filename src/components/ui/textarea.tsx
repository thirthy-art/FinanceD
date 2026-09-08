import * as React from "react";
import { cn } from "@/src/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn("min-h-20 w-full resize-y rounded-md border border-[var(--input)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] shadow-xs outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--primary)] focus-visible:ring-3 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-[var(--muted)] disabled:opacity-60", className)} {...props} />;
}

export { Textarea };
