import * as React from "react";
import { cn } from "@/src/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) { return <div data-slot="table-container" className="w-full overflow-x-auto"><table data-slot="table" className={cn("w-full border-collapse text-sm", className)} {...props} /></div>; }
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) { return <thead data-slot="table-header" className={cn("border-b border-[var(--border)] bg-[var(--table-header)]", className)} {...props} />; }
function TableBody({ className, ...props }: React.ComponentProps<"tbody">) { return <tbody data-slot="table-body" className={cn("divide-y divide-[var(--border-subtle)]", className)} {...props} />; }
function TableRow({ className, ...props }: React.ComponentProps<"tr">) { return <tr data-slot="table-row" className={cn("transition-colors hover:bg-[var(--table-hover)]", className)} {...props} />; }
function TableHead({ className, ...props }: React.ComponentProps<"th">) { return <th data-slot="table-head" className={cn("h-10 px-3 text-start align-middle text-xs font-semibold tracking-wide text-[var(--muted-foreground)]", className)} {...props} />; }
function TableCell({ className, ...props }: React.ComponentProps<"td">) { return <td data-slot="table-cell" className={cn("px-3 py-2.5 align-middle", className)} {...props} />; }
function TableCaption({ className, ...props }: React.ComponentProps<"caption">) { return <caption data-slot="table-caption" className={cn("mt-3 text-sm text-[var(--muted-foreground)]", className)} {...props} />; }

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption };
