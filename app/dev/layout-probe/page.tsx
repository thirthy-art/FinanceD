import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import LayoutProbeTool from "./LayoutProbeTool";
import { layoutProbeAccess } from "./layout-probe-gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Layout Probe (dev)",
  description: "Developer-only deterministic PDF layout evidence inspector",
};

export default async function LayoutProbePage() {
  const cookieHeader = (await headers()).get("cookie");
  if (layoutProbeAccess(cookieHeader) !== "available") notFound();
  return <LayoutProbeTool />;
}
