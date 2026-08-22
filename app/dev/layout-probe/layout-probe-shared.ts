/**
 * Shared upload constraints for the developer layout probe.
 * Pure module: used by the route handler, the client component, and tests.
 */
export const MAX_LAYOUT_PROBE_BYTES = 25 * 1024 * 1024;
export const MAX_LAYOUT_PROBE_LABEL = "25 MiB";

export interface LayoutProbeFileDescriptor {
  name: string;
  size: number;
  type: string;
}

/** Returns a user-facing error message, or null when the file is acceptable. */
export function validateLayoutProbeFile(file: LayoutProbeFileDescriptor): string | null {
  if (file.size <= 0) return "The selected PDF is empty.";
  if (file.size > MAX_LAYOUT_PROBE_BYTES) {
    return `The PDF must be at most ${MAX_LAYOUT_PROBE_LABEL}.`;
  }
  const looksLikePdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!looksLikePdf) return "Only PDF files are accepted.";
  return null;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}
