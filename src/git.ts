import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';

import { REF_FORMAT, parseAheadBehind, parseRefs, parseStatus } from './parse.js';
import type { BranchInfo, DirtyCounts, Upstream } from './parse.js';

export type RepoState =
  | 'clean'
  | 'detached'
  | 'merging'
  | 'rebasing'
  | 'cherry-picking'
  | 'reverting'
  | 'bisecting';

export interface RepoStatus {
  path: string;
  name: string;
  error: string | null;
  branch: string | null;
  detached: boolean;
  oid: string | null;
  state: RepoState;
  dirty: DirtyCounts;
  /** Divergence from this branch's own upstream — i.e. unpushed / unpulled. */
  upstream: Upstream | null;
  /** Divergence from the remote default branch — i.e. how stale this checkout is. */
  defaultBranch: { ref: string; ahead: number; behind: number } | null;
  localBranches: BranchInfo[];
  remoteBranches: string[];
  /** Local branches whose upstream was deleted on the remote. */
  goneBranches: string[];
  stashes: number;
  hasRemote: boolean;
  lastFetch: number | null;
}

const EMPTY_DIRTY: DirtyCounts = { staged: 0, modified: 0, untracked: 0, conflicted: 0 };
const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Git must never stop and wait for a human: this dashboard runs unattended over
 * dozens of repos, and one credential prompt would hang the whole refresh.
 */
const NON_INTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
  SSH_ASKPASS_REQUIRE: 'never',
  GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new',
  GCM_INTERACTIVE: 'never',
};

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(cwd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_BUFFER,
        env: { ...process.env, ...NON_INTERACTIVE_ENV },
      },
      (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: stdout ?? '', stderr: (stderr || error?.message) ?? '' });
      },
    );
  });
}

/** Locate `.git` without spending a subprocess on `rev-parse --git-dir`. */
async function resolveGitDir(repoPath: string): Promise<{ gitDir: string; commonDir: string }> {
  const dotGit = join(repoPath, '.git');
  const info = await stat(dotGit); // throws if absent — caller turns that into an error row

  let gitDir = dotGit;
  if (!info.isDirectory()) {
    // Worktree or submodule: `.git` is a file holding `gitdir: <path>`.
    const pointer = (await readFile(dotGit, 'utf8')).trim().replace(/^gitdir:\s*/, '');
    gitDir = isAbsolute(pointer) ? pointer : resolve(repoPath, pointer);
  }

  // Linked worktrees keep shared state (stashes, FETCH_HEAD) in the common dir.
  let commonDir = gitDir;
  try {
    const pointer = (await readFile(join(gitDir, 'commondir'), 'utf8')).trim();
    commonDir = isAbsolute(pointer) ? pointer : resolve(gitDir, pointer);
  } catch {
    /* no commondir: this is a normal repo */
  }

  return { gitDir, commonDir };
}

function stateFrom(entries: string[], detached: boolean): RepoState {
  if (entries.includes('rebase-merge') || entries.includes('rebase-apply')) return 'rebasing';
  if (entries.includes('MERGE_HEAD')) return 'merging';
  if (entries.includes('CHERRY_PICK_HEAD')) return 'cherry-picking';
  if (entries.includes('REVERT_HEAD')) return 'reverting';
  if (entries.includes('BISECT_LOG')) return 'bisecting';
  return detached ? 'detached' : 'clean';
}

/** Stashes live in a reflog; counting its lines beats spawning `git stash list`. */
async function countStashes(commonDir: string): Promise<number> {
  try {
    const log = await readFile(join(commonDir, 'logs', 'refs', 'stash'), 'utf8');
    return log.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function lastFetchTime(commonDir: string): Promise<number | null> {
  try {
    return (await stat(join(commonDir, 'FETCH_HEAD'))).mtimeMs;
  } catch {
    return null;
  }
}

async function hasConfiguredRemote(commonDir: string): Promise<boolean> {
  try {
    return /^\s*\[remote /m.test(await readFile(join(commonDir, 'config'), 'utf8'));
  } catch {
    return false;
  }
}

/** Prefer the remote's own HEAD; otherwise guess at the usual trunk names. */
function pickDefaultRef(remoteHead: string | null, remoteBranches: string[]): string | null {
  if (remoteHead && remoteBranches.includes(remoteHead)) return remoteHead;
  return (
    ['origin/main', 'origin/master'].find((r) => remoteBranches.includes(r)) ??
    // A non-origin remote is fine, but only an exact <remote>/main — never
    // something like origin/feature/main, which is just a branch.
    remoteBranches.find((r) => /^[^/]+\/(main|master)$/.test(r)) ??
    null
  );
}

function errorStatus(repoPath: string, message: string): RepoStatus {
  return {
    path: repoPath,
    name: basename(repoPath),
    error: message,
    branch: null,
    detached: false,
    oid: null,
    state: 'clean',
    dirty: { ...EMPTY_DIRTY },
    upstream: null,
    defaultBranch: null,
    localBranches: [],
    remoteBranches: [],
    goneBranches: [],
    stashes: 0,
    hasRemote: false,
    lastFetch: null,
  };
}

/** One-line error text; git is happy to write a paragraph. */
const firstLine = (text: string): string =>
  text.trim().split('\n')[0]?.trim() || 'git command failed';

export async function readRepoStatus(
  repoPath: string,
  opts: { timeoutMs?: number } = {},
): Promise<RepoStatus> {
  const timeoutMs = opts.timeoutMs ?? 20_000;

  let dirs;
  try {
    dirs = await resolveGitDir(repoPath);
  } catch {
    return errorStatus(repoPath, 'Not a git repository');
  }
  const { gitDir, commonDir } = dirs;

  const [statusRun, refsRun, gitDirEntries, stashes, lastFetch, hasRemoteConfig] = await Promise.all([
    // --no-optional-locks keeps a read-only refresh from taking the index lock.
    run(repoPath, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch'], timeoutMs),
    run(repoPath, ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes'], timeoutMs),
    readdir(gitDir).catch(() => [] as string[]),
    countStashes(commonDir),
    lastFetchTime(commonDir),
    hasConfiguredRemote(commonDir),
  ]);

  if (!statusRun.ok) return errorStatus(repoPath, firstLine(statusRun.stderr));

  const status = parseStatus(statusRun.stdout);
  const refs = refsRun.ok ? parseRefs(refsRun.stdout) : { local: [], remote: [], remoteHead: null };

  // Two independent signals for a vanished upstream; trust either one.
  const upstream = status.upstream && {
    ...status.upstream,
    gone: status.upstream.gone || (refs.local.find((b) => b.name === status.branch)?.gone ?? false),
  };

  const defaultRef = pickDefaultRef(refs.remoteHead, refs.remote);
  let defaultBranch: RepoStatus['defaultBranch'] = null;
  if (defaultRef && status.oid) {
    const revList = await run(
      repoPath,
      ['rev-list', '--left-right', '--count', `HEAD...${defaultRef}`],
      timeoutMs,
    );
    const counts = revList.ok ? parseAheadBehind(revList.stdout) : null;
    if (counts) defaultBranch = { ref: defaultRef, ...counts };
  }

  return {
    path: repoPath,
    name: basename(repoPath),
    error: null,
    branch: status.branch,
    detached: status.detached,
    oid: status.oid,
    state: stateFrom(gitDirEntries, status.detached),
    dirty: status.dirty,
    upstream,
    defaultBranch,
    localBranches: refs.local,
    remoteBranches: refs.remote,
    goneBranches: refs.local.filter((b) => b.gone).map((b) => b.name),
    stashes,
    hasRemote: hasRemoteConfig || refs.remote.length > 0,
    lastFetch,
  };
}

export interface FetchResult {
  path: string;
  ok: boolean;
  error: string | null;
}

/**
 * `fetch --all --prune` is the only write this app performs, and it only ever
 * touches remote-tracking refs — never the working tree or any local branch.
 */
export async function fetchRepo(
  repoPath: string,
  opts: { timeoutMs?: number } = {},
): Promise<FetchResult> {
  const result = await run(
    repoPath,
    ['fetch', '--all', '--prune', '--quiet', '--no-recurse-submodules'],
    opts.timeoutMs ?? 60_000,
  );
  return { path: repoPath, ok: result.ok, error: result.ok ? null : firstLine(result.stderr) };
}

/** Run an async job over a list with a ceiling on concurrency. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  job: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await job(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
