import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/src/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]",
        success: "border-[var(--success-border)] bg-[var(--success-muted)] text-[var(--success)]",
        warning: "border-[var(--warning-border)] bg-[var(--warning-muted)] text-[var(--warning)]",
        destructive: "border-[var(--destructive-border)] bg-[var(--destructive-muted)] text-[var(--destructive)]",
        info: "border-[var(--info-border)] bg-[var(--info-muted)] text-[var(--primary-strong)]",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
