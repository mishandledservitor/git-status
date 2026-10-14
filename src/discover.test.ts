import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverRepos } from './discover.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'gsg-discover-'));

  const repo = async (rel: string) => {
    await mkdir(join(root, rel, '.git'), { recursive: true });
  };

  await repo('alpha');
  await repo('nested/beta');
  await repo('nested/deep/deeper/gamma');
  // a repo checked out *inside* another repo's tree — must not be reported
  await repo('alpha/vendored-repo');
  // junk dirs that must never be walked into
  await mkdir(join(root, 'node_modules/some-pkg/.git'), { recursive: true });
  await mkdir(join(root, '.venv/lib/pkg/.git'), { recursive: true });
  await mkdir(join(root, 'plain-folder/notes'), { recursive: true });
  // a worktree / submodule, where .git is a file rather than a directory
  await mkdir(join(root, 'linked'), { recursive: true });
  await writeFile(join(root, 'linked/.git'), 'gitdir: /somewhere/else\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('discoverRepos', () => {
  it('finds every repo under the root, at any depth', async () => {
    const found = await discoverRepos([root]);
    const names = found.map((r) => r.name).sort();
    expect(names).toEqual(['alpha', 'beta', 'gamma', 'linked']);
  });

  it('stops descending once a repo is found, so nested checkouts are not double-counted', async () => {
    const found = await discoverRepos([root]);
    expect(found.some((r) => r.path.includes('vendored-repo'))).toBe(false);
  });

  it('never walks into node_modules or dot-directories', async () => {
    const found = await discoverRepos([root]);
    expect(found.some((r) => r.path.includes('node_modules'))).toBe(false);
    expect(found.some((r) => r.path.includes('.venv'))).toBe(false);
  });

  it('treats a .git file (worktree/submodule) as a repo', async () => {
    const found = await discoverRepos([root]);
    expect(found.map((r) => r.name)).toContain('linked');
  });

  it('returns absolute paths sorted by name for a stable UI order', async () => {
    const found = await discoverRepos([root]);
    expect(found.every((r) => r.path.startsWith('/'))).toBe(true);
    expect(found.map((r) => r.name)).toEqual([...found.map((r) => r.name)].sort());
  });

  it('returns an empty list for a root that does not exist', async () => {
    await expect(discoverRepos([join(root, 'no-such-dir')])).resolves.toEqual([]);
  });

  it('expands a leading ~ to the home directory', async () => {
    const found = await discoverRepos(['~/definitely-not-a-real-dir-9f3a']);
    expect(found).toEqual([]);
  });

  it('deduplicates repos reachable from two overlapping roots', async () => {
    const found = await discoverRepos([root, join(root, 'nested')]);
    const paths = found.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('treats the root itself as a repo when the root is one', async () => {
    const found = await discoverRepos([join(root, 'alpha')]);
    expect(found.map((r) => r.name)).toEqual(['alpha']);
  });

  it('does not follow a symlink to a sibling whose name merely starts with the root name', async () => {
    // `/x/root` must not be treated as containing `/x/rootEVIL` by prefix match.
    const parent = await mkdtemp(join(tmpdir(), 'gsg-prefix-'));
    await mkdir(join(parent, 'root'), { recursive: true });
    await mkdir(join(parent, 'rootEVIL/sneaky/.git'), { recursive: true });
    await symlink(join(parent, 'rootEVIL'), join(parent, 'root/link'));
    try {
      const found = await discoverRepos([join(parent, 'root')]);
      expect(found.map((r) => r.name)).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('does not follow symlinks out of the tree', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'gsg-outside-'));
    await mkdir(join(outside, 'sneaky/.git'), { recursive: true });
    await symlink(outside, join(root, 'link-to-outside'));
    try {
      const found = await discoverRepos([root]);
      expect(found.some((r) => r.name === 'sneaky')).toBe(false);
    } finally {
      await rm(join(root, 'link-to-outside'), { force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
