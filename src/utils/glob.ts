import { matchesGlob as pathMatchesGlob } from "node:path";

export function matchesGlob(path: string, pattern: string): boolean {
  return pathMatchesGlob(path, pattern);
}
