/**
 * Pure display helpers, shared by the browser (imported as a module) and the
 * test suite. No DOM access here — that lives in app.js.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(timestamp, now = Date.now()) {
  if (timestamp == null) return 'never';
  const age = Math.max(0, now - timestamp); // a skewed clock must not read "-3m ago"
  if (age < MINUTE) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  return `${Math.floor(age / DAY)}d ago`;
}

export function divergence(counts) {
  if (!counts) return { text: '—', tone: 'none' };
  const { ahead, behind } = counts;
  // A deleted upstream reports 0/0 because there is nothing left to compare
  // against. Rendering that as "in sync" would hide unpushed work.
  if (counts.gone) return { text: 'upstream gone', tone: 'alert' };
  if (ahead && behind) return { text: `↑${ahead} ↓${behind}`, tone: 'diverged' };
  if (ahead) return { text: `↑${ahead}`, tone: 'ahead' };
  if (behind) return { text: `↓${behind}`, tone: 'behind' };
  return { text: 'in sync', tone: 'ok' };
}

/**
 * The two comparisons a card shows. On the default branch they are the same
 * ref with the same numbers, so they collapse into one row rather than reading
 * as a confusing duplicate.
 */
export function divergenceRows(repo) {
  // Nothing has been committed, so every comparison is vacuous. Say that once
  // rather than reporting a string of misleading zeroes.
  if (repo.oid === null && !repo.error) {
    return [{ label: repo.upstream?.name ?? 'upstream', text: 'no commits yet', tone: 'none' }];
  }

  const upstream = repo.upstream
    ? { label: repo.upstream.name, ...divergence(repo.upstream) }
    : { label: 'upstream', text: 'not tracked', tone: 'none' };

  const trunk = repo.defaultBranch
    ? { label: repo.defaultBranch.ref, ...divergence(repo.defaultBranch) }
    : {
        label: 'default branch',
        text: repo.hasRemote ? 'unknown' : 'no remote',
        tone: 'none',
      };

  const identical =
    repo.upstream &&
    repo.defaultBranch &&
    repo.upstream.name === repo.defaultBranch.ref &&
    upstream.text === trunk.text;

  return identical ? [upstream] : [upstream, trunk];
}

const DIRTY_ORDER = ['conflicted', 'staged', 'modified', 'untracked'];

export function dirtySummary(dirty) {
  const parts = DIRTY_ORDER.filter((k) => dirty[k] > 0).map((k) => `${dirty[k]} ${k}`);
  return parts.length ? parts.join(', ') : 'clean';
}

const IN_PROGRESS = new Set(['merging', 'rebasing', 'cherry-picking', 'reverting', 'bisecting']);

/**
 * How loudly a repo is asking to be dealt with. Ordering intent, loudest first:
 * broken > conflicted > mid-operation > detached > unpushed work > uncommitted
 * work > unpulled commits > leftover branches > stale trunk > stashes.
 */
export function attentionScore(repo) {
  const d = repo.dirty;
  return (
    (repo.error ? 1000 : 0) +
    (d.conflicted > 0 ? 400 : 0) +
    (IN_PROGRESS.has(repo.state) ? 200 : 0) +
    (repo.detached ? 80 : 0) +
    (repo.upstream?.gone ? 60 : 0) +
    (repo.upstream?.ahead > 0 ? 40 : 0) +
    (d.staged + d.modified + d.untracked > 0 ? 20 : 0) +
    (repo.upstream?.behind > 0 ? 10 : 0) +
    (repo.goneBranches.length > 0 ? 5 : 0) +
    (repo.defaultBranch?.behind > 0 ? 4 : 0) +
    (repo.stashes > 0 ? 1 : 0)
  );
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export function sortRepos(repos) {
  return [...repos].sort((a, b) => attentionScore(b) - attentionScore(a) || byName(a, b));
}

/** `/Users/simon/git/a/b` under root `~/git` reads better as `~/git/a/b`. */
export function shortPath(path, roots) {
  const match = roots
    .filter((r) => path === r.resolved || path.startsWith(r.resolved + '/'))
    .sort((a, b) => b.resolved.length - a.resolved.length)[0];
  return match ? match.configured + path.slice(match.resolved.length) : path;
}

const ab = (counts) => (counts ? `ahead ${counts.ahead}, behind ${counts.behind}` : null);

/**
 * A self-contained brief for a coding agent: everything this card shows, plus
 * what to do with it. Deliberately states that the numbers are a snapshot —
 * an agent that re-checks is more useful than one that trusts a stale reading.
 */
export function claudePrompt(repo, roots, now = Date.now()) {
  const line = (label, value) => `${label}: ${value}`;
  const head = repo.detached
    ? `detached HEAD at ${repo.oid ?? 'unknown commit'}`
    : (repo.branch ?? 'no branch');

  const locals = repo.localBranches.length
    ? repo.localBranches
        .map((b) => {
          if (!b.upstream) return `  - ${b.name} (local only)`;
          const suffix = b.gone ? ' (upstream gone)' : ` (${ab(b)})`;
          return `  - ${b.name} → ${b.upstream}${suffix}`;
        })
        .join('\n')
    : '  - none';

  const facts = [
    line('Repo', `${shortPath(repo.path, roots)}  (absolute: ${repo.path})`),
    repo.error ? line('Scan error', repo.error) : null,
    line('Checked out', head),
    line('Repo state', repo.state),
    `vs ${repo.upstream?.name ?? 'upstream'} (its upstream): ${
      repo.oid === null
        ? 'no commits yet on this branch, so there is nothing to compare'
        : !repo.upstream
          ? 'no upstream — this branch was never pushed'
          : repo.upstream.gone
            ? 'upstream branch no longer exists, so git cannot compare — any commits on this branch may exist nowhere else'
            : ab(repo.upstream)
    }`,
    `vs ${repo.defaultBranch?.ref ?? 'default branch'} (default branch): ${
      repo.defaultBranch
        ? ab(repo.defaultBranch)
        : repo.hasRemote
          ? 'could not be determined'
          : 'no remote configured'
    }`,
    line('Working tree', dirtySummary(repo.dirty)),
    line('Stashes', String(repo.stashes)),
    line('Upstream gone', repo.goneBranches.length ? repo.goneBranches.join(', ') : 'none'),
    line('Last fetched', relativeTime(repo.lastFetch, now)),
    `Local branches:\n${locals}`,
    line(
      'Remote branches',
      repo.remoteBranches.length
        ? repo.remoteBranches.join(', ')
        : repo.hasRemote
          ? 'none fetched'
          : 'no remote configured',
    ),
  ].filter(Boolean);

  return [
    'Investigate this git repository and propose concrete next steps.',
    '',
    'This is a snapshot from a status dashboard, so re-check it in the repo before acting on it.',
    '',
    ...facts,
    '',
    'Please:',
    '1. cd into the repo and confirm the current state for yourself.',
    '2. Explain plainly what state it is in and how it got there.',
    '3. Propose a short, ordered list of actions with the exact git commands to run.',
    '4. Call out anything that risks losing work, and ask me before running any command that changes state.',
  ].join('\n');
}

export function filterRepos(repos, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return repos;
  return repos.filter((r) =>
    [r.name, r.path, r.branch].some((f) => f?.toLowerCase().includes(needle)),
  );
}
