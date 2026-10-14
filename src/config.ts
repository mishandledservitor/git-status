import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Config {
  /** Folders to scan. `~` is expanded at scan time. */
  roots: string[];
  /** Absolute paths of repos the user has unticked. Anything new shows by default. */
  hidden: string[];
}

export const DEFAULT_CONFIG: Config = Object.freeze({ roots: ['~/git'], hidden: [] }) as Config;

export function defaultConfigPath(): string {
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    'git-status-gui',
    'config.json',
  );
}

const strings = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null;

export function normalizeConfig(raw: unknown): Config {
  const o = (raw ?? {}) as Record<string, unknown>;
  const roots = strings(o.roots);
  return {
    roots: roots?.length ? roots : [...DEFAULT_CONFIG.roots],
    hidden: strings(o.hidden) ?? [],
  };
}

export async function loadConfig(path: string): Promise<Config> {
  try {
    return normalizeConfig(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    // Missing or corrupt: the defaults are always a usable answer.
    return normalizeConfig(null);
  }
}

export async function saveConfig(path: string, config: Config): Promise<Config> {
  const clean = normalizeConfig(config);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(clean, null, 2) + '\n');
  return clean;
}
