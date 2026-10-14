import { readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';

export interface RepoRef {
  path: string;
  name: string;
}

/** Directories that are never worth walking into, and are full of vendored repos. */
const SKIP = new Set(['node_modules', 'vendor', 'Library', '__pycache__', 'target', 'dist', 'build']);

const MAX_DEPTH = 12;

export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return isAbsolute(path) ? path : resolve(path);
}

/**
 * Walk each root looking for repositories. A directory containing `.git`
 * (directory, or file for worktrees/submodules) is a repo, and we stop
 * descending there — a checkout inside a checkout is that repo's business.
 */
export async function discoverRepos(roots: string[]): Promise<RepoRef[]> {
  const found = new Map<string, RepoRef>();
  // Symlinks are resolved so a link back into the tree can't cause a loop, and
  // a link out of the tree can't smuggle in repos the user didn't ask for.
  const visited = new Set<string>();

  const walk = async (dir: string, base: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;

    let entries;
    try {
      const real = await realpath(dir);
      // Compare on a path boundary: root `/x/git` must not swallow `/x/gitlab`.
      if ((real !== base && !real.startsWith(base + sep)) || visited.has(real)) return;
      visited.add(real);
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable or missing root — skip it, don't fail the scan
    }

    if (entries.some((e) => e.name === '.git')) {
      found.set(dir, { path: dir, name: basename(dir) });
      return;
    }

    await Promise.all(
      entries
        .filter((e) => e.isDirectory() || e.isSymbolicLink())
        .filter((e) => !e.name.startsWith('.') && !SKIP.has(e.name))
        .map((e) => walk(join(dir, e.name), base, depth + 1)),
    );
  };

  await Promise.all(
    roots.map(async (root) => {
      const dir = expandHome(root);
      let base: string;
      try {
        base = await realpath(dir);
      } catch {
        return;
      }
      await walk(dir, base, 0);
    }),
  );

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}
