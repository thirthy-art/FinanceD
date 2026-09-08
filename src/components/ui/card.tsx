import * as React from "react";
import { cn } from "@/src/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card" className={cn("rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-card)]", className)} {...props} />; }
function CardHeader({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-header" className={cn("grid gap-1.5 p-5", className)} {...props} />; }
function CardTitle({ className, ...props }: React.ComponentProps<"h2">) { return <h2 data-slot="card-title" className={cn("text-base font-semibold tracking-[-0.01em]", className)} {...props} />; }
function CardDescription({ className, ...props }: React.ComponentProps<"p">) { return <p data-slot="card-description" className={cn("text-sm text-[var(--muted-foreground)]", className)} {...props} />; }
function CardContent({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-content" className={cn("p-5 pt-0", className)} {...props} />; }
function CardFooter({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-footer" className={cn("flex items-center p-5 pt-0", className)} {...props} />; }

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
