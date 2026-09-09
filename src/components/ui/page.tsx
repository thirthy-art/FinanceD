import * as React from "react";
import { cn } from "@/src/lib/utils";

function PageHeader({ className, ...props }: React.ComponentProps<"header">) { return <header data-slot="page-header" className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)} {...props} />; }
function PageHeading({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="page-heading" className={cn("min-w-0", className)} {...props} />; }
function PageTitle({ className, ...props }: React.ComponentProps<"h1">) { return <h1 data-slot="page-title" className={cn("text-xl font-semibold tracking-[-0.02em] text-[var(--heading)] sm:text-2xl", className)} {...props} />; }
function PageDescription({ className, ...props }: React.ComponentProps<"p">) { return <p data-slot="page-description" className={cn("mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]", className)} {...props} />; }
function PageActions({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="page-actions" className={cn("flex shrink-0 flex-wrap items-center gap-2", className)} {...props} />; }
function PageSection({ className, ...props }: React.ComponentProps<"section">) { return <section data-slot="page-section" className={cn("mb-6", className)} {...props} />; }

export { PageHeader, PageHeading, PageTitle, PageDescription, PageActions, PageSection };
