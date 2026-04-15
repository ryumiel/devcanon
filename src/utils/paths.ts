import os from "node:os";
import path from "node:path";

export function expandHome(p: string): string {
  // Accept "~\" on every platform: POSIX users never write it, Windows users sometimes do.
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

export function resolveFromBase(p: string, base: string): string {
  const expanded = expandHome(p);
  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded);
  }
  return path.resolve(base, expanded);
}

export function normalizePath(p: string): string {
  return path.normalize(p);
}
