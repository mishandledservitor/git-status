/**
 * Pure parsers for git plumbing output. No I/O here — everything in this file
 * is a string in, data out, which is what makes the git layer cheap to test.
 */

export interface Track {
  ahead: number;
  behind: number;
  gone: boolean;
}

export interface DirtyCounts {
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
}

export interface StatusInfo {
  branch: string | null;
  detached: boolean;
  oid: string | null;
  upstream: Upstream | null;
  dirty: DirtyCounts;
}

export interface Upstream {
  name: string;
  ahead: number;
  behind: number;
  /** The upstream ref is configured but no longer exists — counts are unknowable. */
  gone: boolean;
}

export interface BranchInfo {
  name: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  gone: boolean;
  oid: string;
}

export interface Refs {
  local: BranchInfo[];
  remote: string[];
  remoteHead: string | null;
}

/** Tab-separated because a tab can never appear in a git ref name. */
export const REF_FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(symref)',
  '%(objectname:short)',
].join('\t');

const TRACK_RE = /(ahead|behind) (\d+)/g;

/** `%(upstream:track)` renders as '', '[gone]', '[ahead 1]', '[ahead 1, behind 2]'. */
export function parseTrack(track: string): Track {
  const t: Track = { ahead: 0, behind: 0, gone: track === '[gone]' };
  for (const [, kind, count] of track.matchAll(TRACK_RE)) {
    t[kind as 'ahead' | 'behind'] = Number(count);
  }
  return t;
}

/** `git rev-list --left-right --count A...B` prints "<ahead>\t<behind>". */
export function parseAheadBehind(stdout: string): { ahead: number; behind: number } | null {
  const [ahead, behind] = stdout.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) return null;
  return { ahead: ahead!, behind: behind! };
}

/** `git status --porcelain=v2 --branch`. */
export function parseStatus(stdout: string): StatusInfo {
  const info: StatusInfo = {
    branch: null,
    detached: false,
    oid: null,
    upstream: null,
    dirty: { staged: 0, modified: 0, untracked: 0, conflicted: 0 },
  };
  let upstreamName: string | null = null;
  let ahead = 0;
  let behind = 0;
  let compared = false;

  for (const line of stdout.split('\n')) {
    switch (line[0]) {
      case '#': {
        const [, key, ...rest] = line.split(' ');
        const value = rest.join(' ');
        if (key === 'branch.oid') info.oid = value === '(initial)' ? null : value.slice(0, 7);
        else if (key === 'branch.head') {
          info.detached = value === '(detached)';
          info.branch = info.detached ? null : value;
        } else if (key === 'branch.upstream') upstreamName = value;
        else if (key === 'branch.ab') {
          const t = parseAheadBehind(value.replace(/[+-]/g, ' '));
          if (t) {
            ({ ahead, behind } = t);
            compared = true;
          }
        }
        break;
      }
      // '1' ordinary change, '2' rename/copy — both carry an XY status field.
      case '1':
      case '2': {
        const xy = line.slice(2, 4);
        if (xy[0] !== '.') info.dirty.staged++;
        if (xy[1] !== '.') info.dirty.modified++;
        break;
      }
      case 'u':
        info.dirty.conflicted++;
        break;
      case '?':
        info.dirty.untracked++;
        break;
      // '!' is an ignored file — deliberately not counted as dirt.
    }
  }

  // git omits `branch.ab` for two different reasons: the upstream ref is
  // missing, or HEAD is unborn so there is nothing to compare *from*. Only the
  // first is "gone" — reporting the initial 0/0 for it would render a deleted
  // upstream as a green "in sync", and reporting the second as gone would
  // accuse a fresh clone of having lost a branch that is plainly still there.
  if (upstreamName) {
    info.upstream = { name: upstreamName, ahead, behind, gone: !compared && info.oid !== null };
  }
  return info;
}

/** `git for-each-ref --format=REF_FORMAT refs/heads refs/remotes`. */
export function parseRefs(stdout: string): Refs {
  const local: BranchInfo[] = [];
  const remote: string[] = [];
  let remoteHead: string | null = null;

  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const [refname, short, upstream, track, symref, oid] = line.split('\t');
    if (refname === undefined || short === undefined) continue;

    if (refname.startsWith('refs/heads/')) {
      local.push({
        name: short,
        upstream: upstream || null,
        oid: oid ?? '',
        ...parseTrack(track ?? ''),
      });
    } else if (refname.startsWith('refs/remotes/')) {
      // `<remote>/HEAD` is a pointer at the default branch, not a branch itself.
      if (symref) remoteHead = symref.replace('refs/remotes/', '');
      else remote.push(short);
    }
  }

  remote.sort();
  return { local, remote, remoteHead };
}
