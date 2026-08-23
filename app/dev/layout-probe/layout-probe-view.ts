/**
 * Pure view-model helpers for the developer layout probe UI.
 * Evidence coordinates stay decimal strings; they are only embedded into CSS
 * (as calc() expressions over the original strings) at the rendering boundary.
 */
import type {
  DocumentEvidence,
  DocumentEvidenceElement,
  EvidenceBox,
  EvidencePageDimensions,
} from "@/src/lib/experimental/document-evidence";
import type { ClassifiedEvidenceTableCandidate } from "@/src/lib/experimental/layout-block-classification";
import type { LogicalLineItemTable } from "@/src/lib/experimental/layout-cross-page-continuity";

export interface LayoutProbeResult {
  evidence: DocumentEvidence;
  tables: ClassifiedEvidenceTableCandidate[];
  logicalTables?: LogicalLineItemTable[];
}

export function isLayoutProbeResult(value: unknown): value is LayoutProbeResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    evidence?: unknown;
    tables?: unknown;
    logicalTables?: unknown;
  };
  return (
    typeof candidate.evidence === "object" &&
    candidate.evidence !== null &&
    Array.isArray(candidate.tables) &&
    (candidate.logicalTables === undefined || Array.isArray(candidate.logicalTables))
  );
}

export function logicalTableForCandidate(
  result: LayoutProbeResult,
  candidateId: string,
): LogicalLineItemTable | null {
  return (
    result.logicalTables?.find((table) => table.candidateIds.includes(candidateId)) ?? null
  );
}

export function buildEvidenceIndex(
  evidence: DocumentEvidence,
): Map<string, DocumentEvidenceElement> {
  const index = new Map<string, DocumentEvidenceElement>();
  for (const page of evidence.pages) {
    for (const element of page.elements) index.set(element.id, element);
  }
  return index;
}

export function resolveElementText(
  index: Map<string, DocumentEvidenceElement>,
  elementIds: string[],
): string {
  return elementIds.map((id) => index.get(id)?.text ?? "(missing)").join(" ");
}

const SAFE_DECIMAL = /^-?\d+(?:\.\d+)?$/;

/** Only plain decimal strings from the extractor may be embedded into CSS. */
export function safeCssDecimal(value: string): string {
  return SAFE_DECIMAL.test(value) ? value : "0";
}

export function evidenceBoxPosition(box: EvidenceBox): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `calc(${safeCssDecimal(box.x)} * 100%)`,
    top: `calc(${safeCssDecimal(box.y)} * 100%)`,
    width: `calc(${safeCssDecimal(box.width)} * 100%)`,
    height: `calc(${safeCssDecimal(box.height)} * 100%)`,
  };
}

export function pageAspectRatio(dimensions: EvidencePageDimensions): string {
  return `${safeCssDecimal(dimensions.width)} / ${safeCssDecimal(dimensions.height)}`;
}
