import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, DEFAULT_CONFIG } from './config.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gsg-config-'));
  file = join(dir, 'nested', 'config.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns the defaults when no config file exists yet', async () => {
    expect(await loadConfig(file)).toEqual(DEFAULT_CONFIG);
  });

  it('defaults to scanning ~/git', async () => {
    expect(DEFAULT_CONFIG.roots).toEqual(['~/git']);
    expect(DEFAULT_CONFIG.hidden).toEqual([]);
  });

  it('reads back what was saved', async () => {
    await saveConfig(file, { roots: ['~/work'], hidden: ['/a/b'] });
    expect(await loadConfig(file)).toEqual({ roots: ['~/work'], hidden: ['/a/b'] });
  });

  it('falls back to defaults on corrupt JSON rather than crashing', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'bad.json'), '{ not json');
    expect(await loadConfig(join(dir, 'bad.json'))).toEqual(DEFAULT_CONFIG);
  });

  it('repairs a config with missing or wrongly-typed fields', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'partial.json'), JSON.stringify({ roots: 'not-an-array' }));
    expect(await loadConfig(join(dir, 'partial.json'))).toEqual(DEFAULT_CONFIG);
  });

  it('drops non-string entries from roots and hidden', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'mixed.json'),
      JSON.stringify({ roots: ['~/git', 42, null], hidden: ['/a', {}] }),
    );
    expect(await loadConfig(join(dir, 'mixed.json'))).toEqual({ roots: ['~/git'], hidden: ['/a'] });
  });

  it('falls back to the default root when roots would end up empty', async () => {
    await saveConfig(file, { roots: [], hidden: [] });
    expect((await loadConfig(file)).roots).toEqual(DEFAULT_CONFIG.roots);
  });
});

describe('saveConfig', () => {
  it('creates the containing directory if it is missing', async () => {
    await saveConfig(file, { roots: ['~/git'], hidden: [] });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ roots: ['~/git'], hidden: [] });
  });

  it('writes formatted JSON a human can edit by hand', async () => {
    await saveConfig(file, { roots: ['~/git'], hidden: [] });
    expect(await readFile(file, 'utf8')).toContain('\n  "roots"');
  });

  it('overwrites rather than appending on repeated saves', async () => {
    await saveConfig(file, { roots: ['~/a'], hidden: [] });
    await saveConfig(file, { roots: ['~/b'], hidden: [] });
    expect((await loadConfig(file)).roots).toEqual(['~/b']);
  });
});
