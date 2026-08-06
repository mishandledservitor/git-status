import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { readRepoStatus, fetchRepo } from './git.js';
import { git, makeTempDir, removeDir, makeRepo, makeBareRemote, commit, write } from './testkit.js';

let dir: string;

beforeAll(async () => {
  dir = await makeTempDir('gsg-git-');
});

afterAll(async () => {
  await removeDir(dir);
});

describe('readRepoStatus — a plain repo with a remote', () => {
  it('reports the checked-out branch and a clean tree', async () => {
    const remote = await makeBareRemote(dir, 'clean.git');
    const repo = await makeRepo(dir, 'clean', { remote });

    const s = await readRepoStatus(repo);

    expect(s.error).toBeNull();
    expect(s.branch).toBe('main');
    expect(s.detached).toBe(false);
    expect(s.dirty).toEqual({ staged: 0, modified: 0, untracked: 0, conflicted: 0 });
    expect(s.upstream).toEqual({ name: 'origin/main', ahead: 0, behind: 0, gone: false });
    expect(s.defaultBranch).toEqual({ ref: 'origin/main', ahead: 0, behind: 0 });
    expect(s.stashes).toBe(0);
    expect(s.state).toBe('clean');
  });

  it('counts commits ahead of the upstream', async () => {
    const remote = await makeBareRemote(dir, 'ahead.git');
    const repo = await makeRepo(dir, 'ahead', { remote });
    await commit(repo, 'local-1');
    await commit(repo, 'local-2');

    const s = await readRepoStatus(repo);
    expect(s.upstream).toEqual({ name: 'origin/main', ahead: 2, behind: 0, gone: false });
  });

  it('counts commits behind the upstream after the remote moves on', async () => {
    const remote = await makeBareRemote(dir, 'behind.git');
    const repo = await makeRepo(dir, 'behind', { remote });
    const other = await makeRepo(dir, 'behind-other', {});
    await git(other, 'remote', 'add', 'origin', remote);
    await git(other, 'fetch', 'origin');
    await git(other, 'reset', '--hard', 'origin/main');
    await commit(other, 'remote-1');
    await git(other, 'push', 'origin', 'main');

    await fetchRepo(repo);
    const s = await readRepoStatus(repo);
    expect(s.upstream?.behind).toBe(1);
    expect(s.upstream?.ahead).toBe(0);
  });

  it('compares a feature branch against the remote default branch', async () => {
    const remote = await makeBareRemote(dir, 'feature.git');
    const repo = await makeRepo(dir, 'feature', { remote });
    await git(repo, 'checkout', '-b', 'feat');
    await commit(repo, 'feat-1');
    await commit(repo, 'feat-2');

    const s = await readRepoStatus(repo);
    expect(s.branch).toBe('feat');
    expect(s.upstream).toBeNull(); // never pushed
    expect(s.defaultBranch).toEqual({ ref: 'origin/main', ahead: 2, behind: 0 });
  });

  it('lists local and remote branches', async () => {
    const remote = await makeBareRemote(dir, 'branches.git');
    const repo = await makeRepo(dir, 'branches', { remote });
    await git(repo, 'branch', 'wip');
    await git(repo, 'checkout', '-b', 'published');
    await git(repo, 'push', '-u', 'origin', 'published');
    await git(repo, 'checkout', 'main');

    const s = await readRepoStatus(repo);
    expect(s.localBranches.map((b) => b.name).sort()).toEqual(['main', 'published', 'wip']);
    expect(s.remoteBranches).toEqual(['origin/main', 'origin/published']);
    expect(s.localBranches.find((b) => b.name === 'wip')?.upstream).toBeNull();
    expect(s.localBranches.find((b) => b.name === 'published')?.upstream).toBe('origin/published');
  });

  it('never reports the checked-out branch as in sync when its upstream is gone', async () => {
    // The dashboard's worst possible lie: unpushed work on a branch whose
    // remote was deleted, rendered as a reassuring green "in sync".
    const remote = await makeBareRemote(dir, 'gone-head.git');
    const repo = await makeRepo(dir, 'gone-head', { remote });
    await git(repo, 'checkout', '-b', 'feat');
    await commit(repo, 'pushed');
    await git(repo, 'push', '-u', 'origin', 'feat');
    await commit(repo, 'never-pushed');
    await git(repo, 'push', 'origin', '--delete', 'feat');
    await fetchRepo(repo);

    const s = await readRepoStatus(repo);
    expect(s.branch).toBe('feat');
    expect(s.upstream?.name).toBe('origin/feat');
    expect(s.upstream?.gone).toBe(true);
    expect(s.goneBranches).toContain('feat');
  });

  it('flags local branches whose upstream is gone from the remote', async () => {
    const remote = await makeBareRemote(dir, 'gone.git');
    const repo = await makeRepo(dir, 'gone', { remote });
    await git(repo, 'checkout', '-b', 'merged-pr');
    await commit(repo, 'pr');
    await git(repo, 'push', '-u', 'origin', 'merged-pr');
    await git(repo, 'push', 'origin', '--delete', 'merged-pr');
    await git(repo, 'checkout', 'main');
    await fetchRepo(repo);

    const s = await readRepoStatus(repo);
    expect(s.goneBranches).toEqual(['merged-pr']);
    expect(s.localBranches.find((b) => b.name === 'merged-pr')?.gone).toBe(true);
  });
});

describe('readRepoStatus — dirty and unusual states', () => {
  it('counts staged, modified and untracked files', async () => {
    const repo = await makeRepo(dir, 'dirty', {});
    await write(repo, 'staged.txt', 'a');
    await git(repo, 'add', 'staged.txt');
    await write(repo, 'file.txt', 'changed');
    await write(repo, 'untracked.txt', 'x');

    const s = await readRepoStatus(repo);
    expect(s.dirty.staged).toBe(1);
    expect(s.dirty.modified).toBe(1);
    expect(s.dirty.untracked).toBe(1);
  });

  it('counts stashes', async () => {
    const repo = await makeRepo(dir, 'stashed', {});
    await write(repo, 'file.txt', 'one');
    await git(repo, 'stash');
    await write(repo, 'file.txt', 'two');
    await git(repo, 'stash');

    const s = await readRepoStatus(repo);
    expect(s.stashes).toBe(2);
  });

  it('reports a detached HEAD', async () => {
    const repo = await makeRepo(dir, 'detached', {});
    await commit(repo, 'second');
    await git(repo, 'checkout', '--detach', 'HEAD~1');

    const s = await readRepoStatus(repo);
    expect(s.detached).toBe(true);
    expect(s.branch).toBeNull();
    expect(s.state).toBe('detached');
  });

  it('reports an in-progress merge with conflicts', async () => {
    const repo = await makeRepo(dir, 'conflict', {});
    await git(repo, 'checkout', '-b', 'other');
    await commit(repo, 'other-change');
    await git(repo, 'checkout', 'main');
    await commit(repo, 'main-change');
    await git(repo, 'merge', 'other').catch(() => {}); // expected to conflict

    const s = await readRepoStatus(repo);
    expect(s.state).toBe('merging');
    expect(s.dirty.conflicted).toBeGreaterThan(0);
  });

  it('reports an in-progress rebase', async () => {
    const repo = await makeRepo(dir, 'rebasing', {});
    await git(repo, 'checkout', '-b', 'other');
    await commit(repo, 'other-change');
    await git(repo, 'checkout', 'main');
    await commit(repo, 'main-change');
    await git(repo, 'rebase', 'other').catch(() => {});

    const s = await readRepoStatus(repo);
    expect(s.state).toBe('rebasing');
  });

  it('handles a repo with no remote at all', async () => {
    const repo = await makeRepo(dir, 'no-remote', {});

    const s = await readRepoStatus(repo);
    expect(s.error).toBeNull();
    expect(s.upstream).toBeNull();
    expect(s.remoteBranches).toEqual([]);
    expect(s.defaultBranch).toBeNull();
    expect(s.hasRemote).toBe(false);
  });

  it('does not claim the upstream vanished in a fresh clone of an empty repo', async () => {
    // Cloning an empty repo configures an upstream on an unborn branch, so git
    // omits branch.ab — for want of a starting point, not a missing target.
    const remote = await makeBareRemote(dir, 'empty-clone.git');
    const clone = join(dir, 'empty-clone');
    await git(dir, 'clone', remote, clone);

    const before = await readRepoStatus(clone);
    expect(before.oid).toBeNull();
    expect(before.upstream?.gone ?? false).toBe(false);

    // …and still not gone once the remote actually has a commit.
    const author = await makeRepo(dir, 'empty-clone-author', { remote });
    await git(author, 'push', 'origin', 'main');
    await fetchRepo(clone);

    const after = await readRepoStatus(clone);
    expect(after.remoteBranches).toContain('origin/main');
    expect(after.upstream?.gone ?? false).toBe(false);
  });

  it('handles a fresh repo with no commits', async () => {
    const repo = join(dir, 'empty');
    await mkdir(repo, { recursive: true });
    await git(repo, 'init', '--initial-branch=main', '.');

    const s = await readRepoStatus(repo);
    expect(s.error).toBeNull();
    expect(s.branch).toBe('main');
    expect(s.localBranches).toEqual([]);
  });

  it('falls back to origin/master when origin/HEAD is not set', async () => {
    const remote = await makeBareRemote(dir, 'master.git');
    const repo = join(dir, 'master-repo');
    await mkdir(repo, { recursive: true });
    await git(repo, 'init', '--initial-branch=master', '.');
    await commit(repo, 'initial');
    await git(repo, 'remote', 'add', 'origin', remote);
    await git(repo, 'push', '-u', 'origin', 'master');
    await git(repo, 'checkout', '-b', 'topic');
    await commit(repo, 'topic-1');

    const s = await readRepoStatus(repo);
    expect(s.defaultBranch).toEqual({ ref: 'origin/master', ahead: 1, behind: 0 });
  });

  it('does not mistake origin/feature/main for the default branch', async () => {
    // With origin/HEAD unset and no origin/main|master, only an exact
    // <remote>/main or <remote>/master should be treated as the trunk.
    const remote = await makeBareRemote(dir, 'nested-main.git');
    const repo = join(dir, 'nested-main-repo');
    await mkdir(repo, { recursive: true });
    await git(repo, 'init', '--initial-branch=trunk', '.');
    await commit(repo, 'initial');
    await git(repo, 'remote', 'add', 'origin', remote);
    await git(repo, 'push', '-u', 'origin', 'trunk');
    await git(repo, 'push', 'origin', 'trunk:feature/main');

    const s = await readRepoStatus(repo);
    expect(s.remoteBranches).toContain('origin/feature/main');
    expect(s.defaultBranch).toBeNull();
  });

  it('returns an error field instead of throwing for a non-repo directory', async () => {
    const notARepo = join(dir, 'not-a-repo');
    await mkdir(notARepo, { recursive: true });

    const s = await readRepoStatus(notARepo);
    expect(s.error).toBeTruthy();
    expect(s.path).toBe(notARepo);
    expect(s.name).toBe('not-a-repo');
  });

  it('reads the last fetch time when the repo has been fetched', async () => {
    const remote = await makeBareRemote(dir, 'fetched.git');
    const repo = await makeRepo(dir, 'fetched', { remote });
    await fetchRepo(repo);

    const s = await readRepoStatus(repo);
    expect(s.lastFetch).toBeTypeOf('number');
    expect(s.lastFetch!).toBeLessThanOrEqual(Date.now());
  });
});

describe('fetchRepo', () => {
  it('updates remote-tracking refs and prunes deleted branches', async () => {
    const remote = await makeBareRemote(dir, 'fetchme.git');
    const repo = await makeRepo(dir, 'fetchme', { remote });
    await git(repo, 'push', 'origin', 'main:will-vanish');
    await fetchRepo(repo);
    expect((await readRepoStatus(repo)).remoteBranches).toContain('origin/will-vanish');

    await git(repo, 'push', 'origin', '--delete', 'will-vanish');
    const result = await fetchRepo(repo);

    expect(result.ok).toBe(true);
    expect((await readRepoStatus(repo)).remoteBranches).not.toContain('origin/will-vanish');
  });

  it('reports a failure instead of throwing when the remote is unreachable', async () => {
    const repo = await makeRepo(dir, 'bad-remote', {});
    await git(repo, 'remote', 'add', 'origin', join(dir, 'does-not-exist.git'));

    const result = await fetchRepo(repo);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('succeeds trivially for a repo with no remote', async () => {
    const repo = await makeRepo(dir, 'fetch-no-remote', {});
    const result = await fetchRepo(repo);
    expect(result.ok).toBe(true);
  });

  it('fails fast instead of hanging when a remote demands credentials', async () => {
    // A reachable remote that issues a Basic-auth challenge is the real hang
    // risk: without GIT_TERMINAL_PROMPT=0 git would block on a username prompt.
    const challenger = createServer((_req, res) => {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="private"' });
      res.end('unauthorized');
    });
    await new Promise<void>((r) => challenger.listen(0, '127.0.0.1', r));
    const { port } = challenger.address() as AddressInfo;

    try {
      const repo = await makeRepo(dir, 'prompting', {});
      await git(repo, 'remote', 'add', 'origin', `http://127.0.0.1:${port}/private.git`);

      const started = Date.now();
      const result = await fetchRepo(repo, { timeoutMs: 20_000 });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
      // A prompt would sit there until the timeout killed it.
      expect(Date.now() - started).toBeLessThan(15_000);
    } finally {
      await new Promise<void>((r) => challenger.close(() => r()));
    }
  });
});

describe('readRepoStatus — resilience', () => {
  it('does not hang on a repo whose .git is a dangling worktree pointer', async () => {
    const repo = join(dir, 'dangling');
    await mkdir(repo, { recursive: true });
    await writeFile(join(repo, '.git'), 'gitdir: /nowhere/at/all\n');

    const s = await readRepoStatus(repo);
    expect(s.error).toBeTruthy();
  });

  it('is safe to call concurrently on the same repo', async () => {
    const repo = await makeRepo(dir, 'concurrent', {});
    const results = await Promise.all([1, 2, 3, 4].map(() => readRepoStatus(repo)));
    expect(results.every((r) => r.branch === 'main')).toBe(true);
  });

  it('handles a repo path containing spaces and unicode', async () => {
    const repo = await makeRepo(dir, 'my repo — ünicode', {});
    const s = await readRepoStatus(repo);
    expect(s.error).toBeNull();
    expect(s.name).toBe('my repo — ünicode');
  });
});

afterAll(async () => {
  await rm(join(dir, 'scratch'), { recursive: true, force: true });
});
