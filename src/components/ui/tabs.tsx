import * as React from "react";
import { cn } from "@/src/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="tabs" className={cn("min-w-0", className)} {...props} />; }
function TabsList({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="tabs-list" role="tablist" className={cn("flex min-w-0 gap-1 overflow-x-auto border-b border-[var(--border)]", className)} {...props} />; }
function TabsTrigger({ className, active, ...props }: React.ComponentProps<"button"> & { active?: boolean }) { return <button data-slot="tabs-trigger" type="button" role="tab" aria-selected={active} data-state={active ? "active" : "inactive"} className={cn("relative min-h-10 shrink-0 px-3 text-sm font-medium text-[var(--muted-foreground)] outline-none transition-colors hover:text-[var(--foreground)] focus-visible:ring-3 focus-visible:ring-[var(--focus-ring)] data-[state=active]:text-[var(--primary-strong)] data-[state=active]:after:absolute data-[state=active]:after:inset-x-2 data-[state=active]:after:bottom-[-1px] data-[state=active]:after:h-0.5 data-[state=active]:after:bg-[var(--primary)]", className)} {...props} />; }
function TabsContent({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="tabs-content" role="tabpanel" className={cn("pt-5 outline-none", className)} {...props} />; }

export { Tabs, TabsList, TabsTrigger, TabsContent };
