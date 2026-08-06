import { describe, it, expect } from 'vitest';
import {
  parseTrack,
  parseStatus,
  parseRefs,
  parseAheadBehind,
  REF_FORMAT,
} from './parse.js';

describe('parseTrack', () => {
  it('treats empty input as no upstream divergence', () => {
    expect(parseTrack('')).toEqual({ ahead: 0, behind: 0, gone: false });
  });

  it('reads "[gone]" as a deleted upstream', () => {
    expect(parseTrack('[gone]')).toEqual({ ahead: 0, behind: 0, gone: true });
  });

  it('reads ahead-only, behind-only and both', () => {
    expect(parseTrack('[ahead 3]')).toEqual({ ahead: 3, behind: 0, gone: false });
    expect(parseTrack('[behind 2]')).toEqual({ ahead: 0, behind: 2, gone: false });
    expect(parseTrack('[ahead 1, behind 5]')).toEqual({ ahead: 1, behind: 5, gone: false });
  });

  it('reads multi-digit counts', () => {
    expect(parseTrack('[ahead 120, behind 7]')).toEqual({ ahead: 120, behind: 7, gone: false });
  });

  it('ignores unknown wording rather than throwing', () => {
    expect(parseTrack('[up to date]')).toEqual({ ahead: 0, behind: 0, gone: false });
  });
});

describe('parseAheadBehind', () => {
  it('reads the tab-separated pair from rev-list --left-right --count', () => {
    expect(parseAheadBehind('3\t7\n')).toEqual({ ahead: 3, behind: 7 });
  });

  it('returns null for empty or malformed output', () => {
    expect(parseAheadBehind('')).toBeNull();
    expect(parseAheadBehind('nonsense')).toBeNull();
  });
});

describe('parseStatus', () => {
  const clean = [
    '# branch.oid 1111111111111111111111111111111111111111',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +0 -0',
  ].join('\n');

  it('reads head, oid, upstream and ahead/behind', () => {
    const s = parseStatus(clean);
    expect(s.branch).toBe('main');
    expect(s.detached).toBe(false);
    expect(s.oid).toBe('1111111');
    expect(s.upstream).toEqual({ name: 'origin/main', ahead: 0, behind: 0, gone: false });
    expect(s.dirty).toEqual({ staged: 0, modified: 0, untracked: 0, conflicted: 0 });
  });

  it('reports a detached HEAD with a null branch', () => {
    const s = parseStatus(
      ['# branch.oid abcdef1234567890abcdef1234567890abcdef12', '# branch.head (detached)'].join('\n'),
    );
    expect(s.detached).toBe(true);
    expect(s.branch).toBeNull();
    expect(s.upstream).toBeNull();
  });

  it('reports a branch with no upstream', () => {
    const s = parseStatus(
      ['# branch.oid 1111111111111111111111111111111111111111', '# branch.head wip'].join('\n'),
    );
    expect(s.branch).toBe('wip');
    expect(s.upstream).toBeNull();
  });

  it('reports an unborn branch (fresh repo, no commits)', () => {
    const s = parseStatus(['# branch.oid (initial)', '# branch.head main'].join('\n'));
    expect(s.branch).toBe('main');
    expect(s.oid).toBeNull();
  });

  it('reads ahead/behind counts off branch.ab', () => {
    const s = parseStatus(
      [
        '# branch.oid 1111111111111111111111111111111111111111',
        '# branch.head feature',
        '# branch.upstream origin/feature',
        '# branch.ab +2 -13',
      ].join('\n'),
    );
    expect(s.upstream).toEqual({ name: 'origin/feature', ahead: 2, behind: 13, gone: false });
  });

  it('flags an upstream that git could not compare against as gone, not as in sync', () => {
    // git omits `# branch.ab` entirely when the upstream ref no longer exists.
    // Reporting 0/0 here would render a deleted upstream as a green "in sync".
    const s = parseStatus(
      [
        '# branch.oid 1111111111111111111111111111111111111111',
        '# branch.head feat',
        '# branch.upstream origin/feat',
      ].join('\n'),
    );
    expect(s.upstream).toEqual({ name: 'origin/feat', ahead: 0, behind: 0, gone: true });
  });

  it('does not call an upstream gone just because the branch has no commits yet', () => {
    // A fresh clone of an empty repo has a configured upstream and an unborn
    // HEAD, so git omits branch.ab for want of a starting point, not a target.
    const s = parseStatus(
      ['# branch.oid (initial)', '# branch.head main', '# branch.upstream origin/main'].join('\n'),
    );
    expect(s.oid).toBeNull();
    expect(s.upstream).toEqual({ name: 'origin/main', ahead: 0, behind: 0, gone: false });
  });

  it('does not flag a present upstream as gone', () => {
    const s = parseStatus(
      [
        '# branch.oid 1111111111111111111111111111111111111111',
        '# branch.head feat',
        '# branch.upstream origin/feat',
        '# branch.ab +0 -0',
      ].join('\n'),
    );
    expect(s.upstream?.gone).toBe(false);
  });

  it('counts staged, modified, untracked and conflicted paths', () => {
    const s = parseStatus(
      [
        '# branch.oid 1111111111111111111111111111111111111111',
        '# branch.head main',
        '1 M. N... 100644 100644 100644 aaa bbb staged-only.txt',
        '1 .M N... 100644 100644 100644 aaa bbb modified-only.txt',
        '1 MM N... 100644 100644 100644 aaa bbb both.txt',
        '2 R. N... 100644 100644 100644 aaa bbb R100 new.txt\told.txt',
        'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt',
        '? untracked-a.txt',
        '? untracked-b.txt',
        '! ignored.txt',
      ].join('\n'),
    );
    // staged: M., MM, R.  |  modified: .M, MM
    expect(s.dirty).toEqual({ staged: 3, modified: 2, untracked: 2, conflicted: 1 });
  });

  it('does not count ignored files as dirt', () => {
    const s = parseStatus(['# branch.head main', '! a.txt', '! b.txt'].join('\n'));
    expect(s.dirty.untracked).toBe(0);
  });

  it('survives a trailing newline and blank lines', () => {
    const s = parseStatus(clean + '\n\n');
    expect(s.branch).toBe('main');
  });
});

describe('parseRefs', () => {
  const line = (...f: string[]) => f.join('\t');

  it('splits local branches, remote branches and the remote HEAD symref', () => {
    const out = [
      line('refs/heads/main', 'main', 'origin/main', '', '', 'aaaaaaa'),
      line('refs/heads/feature', 'feature', 'origin/feature', '[ahead 2]', '', 'bbbbbbb'),
      line('refs/heads/orphan', 'orphan', '', '', '', 'ccccccc'),
      line('refs/heads/stale', 'stale', 'origin/stale', '[gone]', '', 'ddddddd'),
      line('refs/remotes/origin/HEAD', 'origin/HEAD', '', '', 'refs/remotes/origin/main', 'aaaaaaa'),
      line('refs/remotes/origin/main', 'origin/main', '', '', '', 'aaaaaaa'),
      line('refs/remotes/origin/feature', 'origin/feature', '', '', '', 'bbbbbbb'),
    ].join('\n');

    const refs = parseRefs(out);

    expect(refs.local.map((b) => b.name)).toEqual(['main', 'feature', 'orphan', 'stale']);
    expect(refs.local[1]).toEqual({
      name: 'feature',
      upstream: 'origin/feature',
      ahead: 2,
      behind: 0,
      gone: false,
      oid: 'bbbbbbb',
    });
    expect(refs.local[2]?.upstream).toBeNull();
    expect(refs.local[3]?.gone).toBe(true);

    // origin/HEAD is a pointer, not a branch a human cares about
    expect(refs.remote).toEqual(['origin/feature', 'origin/main']);
    expect(refs.remoteHead).toBe('origin/main');
  });

  it('returns a null remoteHead when origin/HEAD is not set', () => {
    const refs = parseRefs(line('refs/remotes/origin/main', 'origin/main', '', '', '', 'aaaaaaa'));
    expect(refs.remoteHead).toBeNull();
    expect(refs.remote).toEqual(['origin/main']);
  });

  it('handles an empty repo with no refs at all', () => {
    expect(parseRefs('')).toEqual({ local: [], remote: [], remoteHead: null });
  });

  it('sorts remote branches so the list is stable between refreshes', () => {
    const refs = parseRefs(
      [
        line('refs/remotes/origin/zeta', 'origin/zeta', '', '', '', 'a'),
        line('refs/remotes/origin/alpha', 'origin/alpha', '', '', '', 'b'),
      ].join('\n'),
    );
    expect(refs.remote).toEqual(['origin/alpha', 'origin/zeta']);
  });

  it('exposes a ref format whose fields line up with the parser', () => {
    expect(REF_FORMAT.split('\t')).toHaveLength(6);
  });
});
