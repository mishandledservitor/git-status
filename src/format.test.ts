import { describe, it, expect } from 'vitest';
import {
  relativeTime,
  divergence,
  dirtySummary,
  attentionScore,
  sortRepos,
  filterRepos,
  shortPath,
  claudePrompt,
  divergenceRows,
} from '../public/format.js';

describe('shortPath', () => {
  const roots = [{ configured: '~/git', resolved: '/Users/simon/git' }];

  it('rewrites a path under a root back to how the root was configured', () => {
    expect(shortPath('/Users/simon/git/mishandled/thing', roots)).toBe('~/git/mishandled/thing');
  });

  it('returns the path unchanged when no root matches', () => {
    expect(shortPath('/elsewhere/thing', roots)).toBe('/elsewhere/thing');
  });

  it('does not match a root that is only a string prefix of the path', () => {
    expect(shortPath('/Users/simon/gitlab/thing', roots)).toBe('/Users/simon/gitlab/thing');
  });

  it('handles the repo being the root itself', () => {
    expect(shortPath('/Users/simon/git', roots)).toBe('~/git');
  });

  it('prefers the longest matching root when roots are nested', () => {
    const nested = [
      { configured: '~/git', resolved: '/Users/simon/git' },
      { configured: '~/git/work', resolved: '/Users/simon/git/work' },
    ];
    expect(shortPath('/Users/simon/git/work/thing', nested)).toBe('~/git/work/thing');
  });

  it('tolerates an empty roots list', () => {
    expect(shortPath('/a/b', [])).toBe('/a/b');
  });
});

describe('relativeTime', () => {
  const now = Date.UTC(2024, 0, 10, 12, 0, 0);
  const ago = (ms: number) => relativeTime(now - ms, now);

  it('says "never" when there is no timestamp', () => {
    expect(relativeTime(null, now)).toBe('never');
  });

  it('collapses anything under a minute to "just now"', () => {
    expect(ago(5_000)).toBe('just now');
    expect(ago(59_000)).toBe('just now');
  });

  it('rounds down to minutes, hours and days', () => {
    expect(ago(60_000)).toBe('1m ago');
    expect(ago(90 * 60_000)).toBe('1h ago');
    expect(ago(25 * 3600_000)).toBe('1d ago');
    expect(ago(400 * 24 * 3600_000)).toBe('400d ago');
  });

  it('does not produce negative ages when the clock is skewed', () => {
    expect(relativeTime(now + 60_000, now)).toBe('just now');
  });
});

describe('divergence', () => {
  it('describes an in-sync branch', () => {
    expect(divergence({ ahead: 0, behind: 0 })).toEqual({ text: 'in sync', tone: 'ok' });
  });

  it('describes unpushed commits', () => {
    expect(divergence({ ahead: 3, behind: 0 })).toEqual({ text: '↑3', tone: 'ahead' });
  });

  it('describes unpulled commits', () => {
    expect(divergence({ ahead: 0, behind: 2 })).toEqual({ text: '↓2', tone: 'behind' });
  });

  it('describes a diverged branch', () => {
    expect(divergence({ ahead: 1, behind: 4 })).toEqual({ text: '↑1 ↓4', tone: 'diverged' });
  });

  it('describes a missing comparison', () => {
    expect(divergence(null)).toEqual({ text: '—', tone: 'none' });
  });

  it('never calls a gone upstream "in sync", even with zero counts', () => {
    expect(divergence({ ahead: 0, behind: 0, gone: true })).toEqual({
      text: 'upstream gone',
      tone: 'alert',
    });
  });
});

describe('divergenceRows', () => {
  it('shows one row when the checked-out branch is itself the default branch', () => {
    const rows = divergenceRows(
      repo({
        branch: 'main',
        upstream: { name: 'origin/main', ahead: 0, behind: 0 },
        defaultBranch: { ref: 'origin/main', ahead: 0, behind: 0 },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe('origin/main');
    expect(rows[0]!.text).toBe('in sync');
  });

  it('shows both rows when the branch and the default branch differ', () => {
    const rows = divergenceRows(
      repo({
        branch: 'feat',
        upstream: { name: 'origin/feat', ahead: 2, behind: 0 },
        defaultBranch: { ref: 'origin/main', ahead: 5, behind: 7 },
      }),
    );
    expect(rows.map((r) => r.label)).toEqual(['origin/feat', 'origin/main']);
    expect(rows.map((r) => r.text)).toEqual(['↑2', '↑5 ↓7']);
  });

  it('keeps both rows when the refs match but the counts do not', () => {
    // Different numbers for the same ref would be a bug worth seeing, not hiding.
    const rows = divergenceRows(
      repo({
        upstream: { name: 'origin/main', ahead: 1, behind: 0 },
        defaultBranch: { ref: 'origin/main', ahead: 0, behind: 3 },
      }),
    );
    expect(rows).toHaveLength(2);
  });

  it('shows an untracked branch against the default branch only', () => {
    const rows = divergenceRows(
      repo({ branch: 'wip', upstream: null, defaultBranch: { ref: 'origin/main', ahead: 1, behind: 0 } }),
    );
    expect(rows.map((r) => r.label)).toEqual(['upstream', 'origin/main']);
    expect(rows[0]!.text).toBe('not tracked');
  });

  it('says a fresh clone has no commits rather than alleging a gone upstream', () => {
    const rows = divergenceRows(
      repo({
        oid: null,
        upstream: { name: 'origin/main', ahead: 0, behind: 0, gone: false },
        defaultBranch: null,
        remoteBranches: ['origin/main'],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe('no commits yet');
    expect(rows.map((r) => r.text).join()).not.toContain('gone');
    expect(rows.map((r) => r.text).join()).not.toContain('in sync');
  });

  it('shows a repo with no remote without pretending it has a default branch', () => {
    const rows = divergenceRows(repo({ upstream: null, defaultBranch: null, hasRemote: false }));
    expect(rows.map((r) => r.text)).toEqual(['not tracked', 'no remote']);
  });
});

describe('dirtySummary', () => {
  it('says clean when nothing is pending', () => {
    expect(dirtySummary({ staged: 0, modified: 0, untracked: 0, conflicted: 0 })).toBe('clean');
  });

  it('lists only the non-zero categories, in a fixed order', () => {
    expect(dirtySummary({ staged: 1, modified: 2, untracked: 3, conflicted: 4 })).toBe(
      '4 conflicted, 1 staged, 2 modified, 3 untracked',
    );
    expect(dirtySummary({ staged: 0, modified: 2, untracked: 0, conflicted: 0 })).toBe('2 modified');
  });
});

const repo = (over = {}) => ({
  name: 'r',
  path: '/r',
  error: null,
  branch: 'main',
  detached: false,
  state: 'clean',
  oid: 'abc1234',
  dirty: { staged: 0, modified: 0, untracked: 0, conflicted: 0 },
  upstream: { name: 'origin/main', ahead: 0, behind: 0 },
  defaultBranch: { ref: 'origin/main', ahead: 0, behind: 0 },
  goneBranches: [],
  stashes: 0,
  localBranches: [],
  remoteBranches: [],
  hasRemote: true,
  lastFetch: null,
  ...over,
});

describe('attentionScore', () => {
  it('gives a clean, in-sync repo a score of zero', () => {
    expect(attentionScore(repo())).toBe(0);
  });

  it('ranks an errored repo above everything else', () => {
    expect(attentionScore(repo({ error: 'boom' }))).toBeGreaterThan(
      attentionScore(repo({ state: 'merging', dirty: { staged: 9, modified: 9, untracked: 9, conflicted: 9 } })),
    );
  });

  it('ranks conflicts above plain uncommitted work', () => {
    const conflicted = repo({ dirty: { staged: 0, modified: 0, untracked: 0, conflicted: 1 } });
    const modified = repo({ dirty: { staged: 0, modified: 5, untracked: 0, conflicted: 0 } });
    expect(attentionScore(conflicted)).toBeGreaterThan(attentionScore(modified));
  });

  it('ranks unpushed work above a merely stale branch', () => {
    const unpushed = repo({ upstream: { name: 'origin/main', ahead: 2, behind: 0 } });
    const stale = repo({ defaultBranch: { ref: 'origin/main', ahead: 0, behind: 9 } });
    expect(attentionScore(unpushed)).toBeGreaterThan(attentionScore(stale));
  });

  it('ranks a branch whose upstream vanished as needing attention', () => {
    const orphaned = repo({ upstream: { name: 'origin/feat', ahead: 0, behind: 0, gone: true } });
    expect(attentionScore(orphaned)).toBeGreaterThan(attentionScore(repo()));
  });

  it('does not care how many commits ahead, only that there are some', () => {
    expect(attentionScore(repo({ upstream: { name: 'o/m', ahead: 1, behind: 0 } }))).toBe(
      attentionScore(repo({ upstream: { name: 'o/m', ahead: 99, behind: 0 } })),
    );
  });
});

describe('sortRepos', () => {
  it('puts repos needing attention first and sorts the rest by name', () => {
    const repos = [
      repo({ name: 'zeta' }),
      repo({ name: 'alpha' }),
      repo({ name: 'busy', dirty: { staged: 0, modified: 1, untracked: 0, conflicted: 0 } }),
      repo({ name: 'broken', error: 'boom' }),
    ];
    expect(sortRepos(repos).map((r: any) => r.name)).toEqual(['broken', 'busy', 'alpha', 'zeta']);
  });

  it('does not mutate the input array', () => {
    const repos = [repo({ name: 'b' }), repo({ name: 'a' })];
    sortRepos(repos);
    expect(repos.map((r: any) => r.name)).toEqual(['b', 'a']);
  });

  it('sorts by name case-insensitively', () => {
    const repos = [repo({ name: 'Zeta' }), repo({ name: 'alpha' })];
    expect(sortRepos(repos).map((r: any) => r.name)).toEqual(['alpha', 'Zeta']);
  });
});

describe('claudePrompt', () => {
  const roots = [{ configured: '~/git', resolved: '/Users/simon/git' }];
  const full = repo({
    name: 'shortlisted',
    path: '/Users/simon/git/mishandled/shortlisted',
    branch: 'mm4',
    upstream: { name: 'origin/mm4', ahead: 2, behind: 0 },
    defaultBranch: { ref: 'origin/main', ahead: 2, behind: 1 },
    dirty: { staged: 0, modified: 0, untracked: 1, conflicted: 0 },
    stashes: 1,
    localBranches: [
      { name: 'mm4', upstream: 'origin/mm4', ahead: 2, behind: 0, gone: false, oid: 'aaa' },
      { name: 'old', upstream: 'origin/old', ahead: 0, behind: 0, gone: true, oid: 'bbb' },
    ],
    remoteBranches: ['origin/main', 'origin/mm4'],
    goneBranches: ['old'],
    lastFetch: 1,
  });

  it('leads with an instruction telling Claude what to do', () => {
    const text = claudePrompt(full, roots, 2);
    expect(text.split('\n')[0]).toMatch(/investigate/i);
    expect(text).toMatch(/propose/i);
  });

  it('includes the absolute path so Claude can cd into the repo', () => {
    expect(claudePrompt(full, roots, 2)).toContain('/Users/simon/git/mishandled/shortlisted');
  });

  it('reports the checked-out branch and both divergences', () => {
    const text = claudePrompt(full, roots, 2);
    expect(text).toContain('Checked out: mm4');
    expect(text).toContain('vs origin/mm4 (its upstream): ahead 2, behind 0');
    expect(text).toContain('vs origin/main (default branch): ahead 2, behind 1');
  });

  it('reports the working tree, stashes and branches whose upstream is gone', () => {
    const text = claudePrompt(full, roots, 2);
    expect(text).toContain('Working tree: 1 untracked');
    expect(text).toContain('Stashes: 1');
    expect(text).toContain('Upstream gone: old');
  });

  it('lists local and remote branches', () => {
    const text = claudePrompt(full, roots, 2);
    expect(text).toContain('mm4 → origin/mm4');
    expect(text).toContain('old → origin/old (upstream gone)');
    expect(text).toContain('origin/main, origin/mm4');
  });

  it('asks Claude to confirm before changing anything', () => {
    expect(claudePrompt(full, roots, 2)).toMatch(/before running any command that changes state/i);
  });

  it('describes a clean, in-sync repo without inventing problems', () => {
    const text = claudePrompt(repo({ name: 'calm' }), roots, 2);
    expect(text).toContain('Working tree: clean');
    expect(text).toContain('Upstream gone: none');
    expect(text).not.toContain('undefined');
  });

  it('describes a detached HEAD instead of naming a branch', () => {
    const text = claudePrompt(repo({ branch: null, detached: true, oid: 'abc1234' }), roots, 2);
    expect(text).toContain('Checked out: detached HEAD at abc1234');
  });

  it('describes a repo with no upstream and no remote', () => {
    const text = claudePrompt(
      repo({ upstream: null, defaultBranch: null, hasRemote: false, remoteBranches: [] }),
      roots,
      2,
    );
    expect(text).toContain('no upstream');
    expect(text).toContain('no remote configured');
    expect(text).not.toContain('undefined');
  });

  it('tells Claude the upstream is gone rather than reporting a clean comparison', () => {
    const text = claudePrompt(
      repo({ branch: 'feat', upstream: { name: 'origin/feat', ahead: 1, behind: 0, gone: true } }),
      roots,
      2,
    );
    expect(text).toContain('upstream branch no longer exists');
    expect(text).not.toContain('(its upstream): ahead 1, behind 0\n');
  });

  it('does not tell Claude the upstream vanished when the branch simply has no commits', () => {
    const text = claudePrompt(
      repo({ oid: null, upstream: { name: 'origin/main', ahead: 0, behind: 0, gone: false } }),
      roots,
      2,
    );
    expect(text).toContain('no commits yet');
    expect(text).not.toContain('no longer exists');
  });

  it('passes the scan error through for a repo that could not be read', () => {
    const text = claudePrompt(repo({ error: 'Not a git repository' }), roots, 2);
    expect(text).toContain('Not a git repository');
    expect(text).toMatch(/investigate/i);
  });

  it('states how stale the reading is so Claude re-checks', () => {
    const text = claudePrompt(full, roots, 2);
    expect(text).toMatch(/snapshot/i);
  });
});

describe('filterRepos', () => {
  const repos = [
    repo({ name: 'alpha', branch: 'main' }),
    repo({ name: 'beta', branch: 'feature/login' }),
    repo({ name: 'gamma', path: '/work/gamma', branch: 'main' }),
  ];

  it('returns everything for an empty query', () => {
    expect(filterRepos(repos, '')).toHaveLength(3);
    expect(filterRepos(repos, '   ')).toHaveLength(3);
  });

  it('matches on repo name, case-insensitively', () => {
    expect(filterRepos(repos, 'ALP').map((r: any) => r.name)).toEqual(['alpha']);
  });

  it('matches on the checked-out branch', () => {
    expect(filterRepos(repos, 'login').map((r: any) => r.name)).toEqual(['beta']);
  });

  it('matches on path', () => {
    expect(filterRepos(repos, '/work/').map((r: any) => r.name)).toEqual(['gamma']);
  });

  it('tolerates a detached repo with a null branch', () => {
    expect(filterRepos([repo({ name: 'd', branch: null })], 'd')).toHaveLength(1);
  });
});
