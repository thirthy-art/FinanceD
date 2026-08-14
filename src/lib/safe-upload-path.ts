import path from "path";

export function resolveSafeUploadPath(storagePath: string, uploadDirectory: string): string | null {
  const uploadRoot = path.resolve(uploadDirectory);
  const target = path.resolve(storagePath);
  const relative = path.relative(uploadRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}
