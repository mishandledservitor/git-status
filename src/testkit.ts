import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Deterministic identity + no user config leaking into test repos. */
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z',
};

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, env: GIT_ENV });
  return stdout;
}

export async function makeTempDir(prefix = 'gsg-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function write(repo: string, rel: string, body: string): Promise<void> {
  const path = join(repo, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, body);
}

export async function commit(repo: string, message: string, rel = 'file.txt'): Promise<void> {
  await write(repo, rel, `${message}\n`);
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-m', message);
}

/** A bare repo standing in for a remote. */
export async function makeBareRemote(dir: string, name = 'remote.git'): Promise<string> {
  const path = join(dir, name);
  await mkdir(path, { recursive: true });
  await git(path, 'init', '--bare', '--initial-branch=main', '.');
  return path;
}

/** A working repo on `main` with one commit, optionally wired to a remote. */
export async function makeRepo(
  dir: string,
  name: string,
  opts: { remote?: string } = {},
): Promise<string> {
  const path = join(dir, name);
  await mkdir(path, { recursive: true });
  await git(path, 'init', '--initial-branch=main', '.');
  await commit(path, 'initial');
  if (opts.remote) {
    await git(path, 'remote', 'add', 'origin', opts.remote);
    await git(path, 'push', '-u', 'origin', 'main');
    await git(path, 'remote', 'set-head', 'origin', 'main');
  }
  return path;
}
