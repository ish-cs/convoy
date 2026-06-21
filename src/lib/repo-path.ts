// Canonical repo-relative path. Strips repoRoot, converts `\` → `/`, removes
// leading `./` and drive letters, collapses slashes. Output feeds normalizePath
// so the same logical file matches across OSes/checkouts. Idempotent on relative input.
export function toRepoRelative(absPath: string, repoRoot: string): string {
  let p = absPath.replace(/\\/g, '/');
  const root = (repoRoot ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (root && p.startsWith(root + '/')) p = p.slice(root.length + 1);
  return p.replace(/^[A-Za-z]:\//, '').replace(/^\.?\//, '').replace(/\/+/g, '/');
}
