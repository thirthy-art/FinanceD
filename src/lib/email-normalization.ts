import { z } from "zod";

const normalizedEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));

export function normalizeEmail(email: string): string {
  return normalizedEmailSchema.parse(email);
}
