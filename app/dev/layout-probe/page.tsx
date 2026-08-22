import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LayoutProbeTool from "./LayoutProbeTool";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Layout Probe (dev)",
  description: "Developer-only deterministic PDF layout evidence inspector",
};

export default function LayoutProbePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LayoutProbeTool />;
}
