import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/src/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-transparent px-3.5 text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[var(--primary)] text-white shadow-xs hover:bg-[var(--primary-hover)]",
        secondary: "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] shadow-xs hover:bg-[var(--muted)]",
        ghost: "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
        destructive: "bg-[var(--destructive)] text-white hover:bg-[var(--destructive-strong)]",
      },
      size: {
        default: "h-9",
        sm: "h-8 min-h-8 px-3 text-xs",
        lg: "h-10 px-5",
        icon: "size-9 min-h-9 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({ className, variant, size, type = "button", ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button data-slot="button" type={type} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
