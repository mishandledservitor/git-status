import {
  attentionScore,
  claudePrompt,
  dirtySummary,
  divergence,
  divergenceRows,
  filterRepos,
  groupRepos,
  relativeTime,
  repoFolder,
  shortPath,
  sortRepos,
  toggleToken,
} from './format.js';

const $ = (id) => document.getElementById(id);

const state = {
  repos: [],
  hidden: [],
  roots: [],
  scannedAt: null,
  query: '',
  busy: false,
  grouped: readPref('grouped', true),
  pickerQuery: '',
};

/* Per-viewer conveniences only; the app must work without storage at all. */
function readPref(key, fallback) {
  try {
    const raw = localStorage.getItem(`git-status:${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(`git-status:${key}`, JSON.stringify(value));
  } catch {
    // Storage refused (private window, quota): the toggle still works for this page load.
  }
}

/* ---------------------------------------------------------------- rendering */

/** Build an element. Text always goes through textContent — repo and branch
 *  names come off the filesystem and are never trusted as markup. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

/** Copy this card as a brief for a coding agent. */
function copyButton(repo) {
  const button = el('button', {
    class: 'copy',
    title: "Copy this card plus an instruction to investigate, ready to paste into Claude",
    text: 'Ask Claude',
  });

  button.addEventListener('click', async () => {
    const text = claudePrompt(repo, state.roots);
    try {
      await navigator.clipboard.writeText(text);
      flash(button, 'Copied ✓');
    } catch {
      // Clipboard access can be refused (no permission, insecure context):
      // fall back to selecting the text so the user can copy it by hand.
      selectFallback(text);
      flash(button, 'Copy it');
    }
  });

  return button;
}

function flash(button, message) {
  const original = button.textContent;
  button.textContent = message;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1400);
}

function selectFallback(text) {
  const area = el('textarea', { class: 'copy-fallback' });
  area.value = text;
  document.body.append(area);
  area.select();
  area.addEventListener('blur', () => area.remove());
}

function badges(repo) {
  const items = [];
  const add = (label, tone) => items.push(el('span', { class: `badge tone-${tone}`, text: label }));

  if (repo.state !== 'clean' && repo.state !== 'detached') add(repo.state, 'alert');
  if (repo.detached) add('detached HEAD', 'alert');
  if (repo.dirty.conflicted > 0) add(`${repo.dirty.conflicted} conflicted`, 'alert');
  if (repo.stashes > 0) add(`${repo.stashes} stash${repo.stashes > 1 ? 'es' : ''}`, 'behind');
  if (repo.goneBranches.length > 0) {
    add(`${repo.goneBranches.length} gone: ${repo.goneBranches.join(', ')}`, 'behind');
  }
  if (!repo.hasRemote) add('no remote', 'none');

  return items.length ? el('div', { class: 'badges' }, items) : null;
}

function row(label, { text, tone }, title) {
  return [
    el('dt', { text: label }),
    el('dd', { class: `tone-${tone}`, text, title: title ?? text }),
  ];
}

function branchList(repo) {
  const local = repo.localBranches.map((b) => {
    const track = divergence(b); // already renders a gone upstream as an alert
    return el('li', { class: b.name === repo.branch ? 'current' : '' }, [
      el('span', { text: b.name }),
      el('span', {
        class: `meta tone-${track.tone}`,
        text: b.upstream ? track.text : 'local only',
      }),
    ]);
  });

  const remote = repo.remoteBranches.map((name) => el('li', {}, [el('span', { text: name })]));

  const summary = `${local.length} local · ${remote.length} remote branch${
    remote.length === 1 ? '' : 'es'
  }`;

  return el('details', {}, [
    el('summary', { text: summary }),
    el('ul', {}, [
      ...local,
      remote.length ? el('li', { class: 'meta', text: '— remote —' }) : null,
      ...remote,
    ]),
  ]);
}

function card(repo) {
  if (repo.error) {
    return el('article', { class: 'card error' }, [
      el('div', { class: 'card-head' }, [
        el('span', { class: 'repo-name', text: repo.name }),
        el('span', {
          class: 'repo-path',
          text: shortPath(repo.path, state.roots),
          title: repo.path,
        }),
      ]),
      el('div', { class: 'tone-alert', text: repo.error }),
      el('div', { class: 'card-foot' }, [el('span', {}), copyButton(repo)]),
    ]);
  }

  const head = repo.detached
    ? `HEAD detached at ${repo.oid ?? '?'}`
    : (repo.branch ?? '(no branch)');

  return el('article', { class: `card${attentionScore(repo) > 0 ? ' attention' : ''}` }, [
    el('div', { class: 'card-head' }, [
      el('span', { class: 'repo-name', text: repo.name, title: repo.path }),
      el('span', {
        class: 'repo-path',
        text: shortPath(repo.path, state.roots),
        title: repo.path,
      }),
    ]),
    el('div', { class: 'branch', text: `⎇ ${head}` }),
    el('dl', { class: 'rows' }, [
      ...divergenceRows(repo).flatMap((r) => row(r.label, r)),
      ...row('working tree', {
        text: dirtySummary(repo.dirty),
        tone: dirtySummary(repo.dirty) === 'clean' ? 'ok' : 'behind',
      }),
      ...row('fetched', { text: relativeTime(repo.lastFetch), tone: 'none' }),
    ]),
    badges(repo),
    el('div', { class: 'card-foot' }, [branchList(repo), copyButton(repo)]),
  ]);
}

const activeTokens = () => new Set(state.query.toLowerCase().split(/\s+/).filter(Boolean));

function chip(label, token, { count, attention, tone } = {}) {
  const on = activeTokens().has(token.toLowerCase());
  const button = el('button', {
    class: `chip${on ? ' on' : ''}${tone ? ` chip-${tone}` : ''}`,
    'aria-pressed': String(on),
    title: on ? `Remove ${token} from the filter` : `Add ${token} to the filter`,
  }, [
    el('span', { text: label }),
    count !== undefined ? el('span', { class: 'chip-count', text: String(count) }) : null,
    attention ? el('span', { class: 'chip-attention', text: String(attention), title: `${attention} need attention` }) : null,
  ]);
  button.addEventListener('click', () => setQuery(toggleToken(state.query, token)));
  return button;
}

function setQuery(query) {
  state.query = query;
  $('search').value = query;
  render();
}

function renderChips() {
  const groups = groupRepos(state.repos, state.roots);
  const stateCounts = (name) => filterRepos(state.repos, `is:${name}`, state.roots).length;
  const folderChips = groups.length > 1
    ? groups.map((g) => chip(g.folder, `folder:${g.folder}`, { count: g.repos.length, attention: g.attention }))
    : [];
  const stateChips = [
    ['needs attention', 'attention', 'behind'],
    ['dirty', 'dirty', 'behind'],
    ['ahead', 'ahead', 'ahead'],
    ['behind', 'behind', 'behind'],
    ['diverged', 'diverged', 'diverged'],
  ]
    .map(([label, name, tone]) => [label, name, tone, stateCounts(name)])
    .filter(([, , , n]) => n > 0)
    .map(([label, name, tone, n]) => chip(label, `is:${name}`, { count: n, tone }));

  const groupToggle = el('label', { class: 'toggle', title: 'Show one section per folder' }, [
    el('input', { type: 'checkbox', id: 'group-toggle', checked: state.grouped }),
    el('span', { text: 'Group by folder' }),
  ]);
  groupToggle.querySelector('input').addEventListener('change', (e) => {
    state.grouped = e.target.checked;
    writePref('grouped', state.grouped);
    render();
  });

  const clear = state.query.trim()
    ? el('button', { class: 'chip chip-clear', text: 'Clear filter', title: 'Empty the filter box' })
    : null;
  clear?.addEventListener('click', () => setQuery(''));

  $('chips').replaceChildren(
    ...[
      ...folderChips,
      folderChips.length && stateChips.length ? el('span', { class: 'chip-sep' }) : null,
      ...stateChips,
      el('span', { class: 'chip-spacer' }),
      clear,
      groupToggle,
    ].filter(Boolean),
  );
}

function section(group) {
  const summary = `${group.repos.length} repo${group.repos.length === 1 ? '' : 's'}${
    group.attention ? ` · ${group.attention} need${group.attention === 1 ? 's' : ''} attention` : ' · all quiet'
  }`;
  const head = el('div', { class: 'section-head' }, [
    el('h2', { class: 'section-title', text: group.folder }),
    el('span', { class: `section-meta${group.attention ? ' tone-behind' : ' tone-ok'}`, text: summary }),
    el('button', { class: 'ghost section-only', text: 'only', title: `Filter to folder:${group.folder}` }),
  ]);
  head.querySelector('.section-only').addEventListener('click', () => setQuery(toggleToken(state.query, `folder:${group.folder}`)));
  return el('section', { class: 'section' }, [head, el('div', { class: 'grid' }, group.repos.map(card))]);
}

function render() {
  const visible = filterRepos(state.repos, state.query, state.roots);
  const app = $('app');
  if (!visible.length) {
    app.replaceChildren(
      el('p', {
        class: 'empty',
        text: state.repos.length
          ? 'No repos match that filter.'
          : 'No repos found. Check the folders to scan under Settings.',
      }),
    );
  } else if (state.grouped) {
    app.replaceChildren(...groupRepos(visible, state.roots).map(section));
  } else {
    app.replaceChildren(el('div', { class: 'grid' }, sortRepos(visible).map(card)));
  }
  renderChips();

  const needing = state.repos.filter((r) => attentionScore(r) > 0).length;
  const showing = visible.length === state.repos.length ? '' : `showing ${visible.length} of `;
  $('status-line').textContent = state.scannedAt
    ? `${showing}${state.repos.length} repos · ${needing} need attention · ${state.hidden.length} hidden · scanned ${relativeTime(state.scannedAt)}`
    : '';
}

/** The picker keeps its own checkbox state between renders so a filter never loses ticks. */
const pickerTicks = new Map();

function renderPicker() {
  const all = [
    ...state.repos.map((r) => ({ path: r.path, name: r.name, shown: true })),
    ...state.hidden.map((r) => ({ path: r.path, name: r.name, shown: false })),
  ];
  for (const r of all) if (!pickerTicks.has(r.path)) pickerTicks.set(r.path, r.shown);
  for (const path of [...pickerTicks.keys()]) if (!all.some((r) => r.path === path)) pickerTicks.delete(path);

  const needle = state.pickerQuery.trim().toLowerCase();
  const byFolder = new Map();
  for (const r of all) {
    const folder = repoFolder(r.path, state.roots);
    if (needle && !r.name.toLowerCase().includes(needle) && !folder.toLowerCase().includes(needle)) continue;
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(r);
  }

  const rootNames = new Set(state.roots.map((r) => r.configured));
  const folders = [...byFolder.entries()].sort(
    ([a], [b]) => (rootNames.has(a) - rootNames.has(b)) || a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );

  const blocks = folders.map(([folder, repos]) => {
    repos.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const ticked = repos.filter((r) => pickerTicks.get(r.path)).length;
    const master = el('input', { type: 'checkbox', 'data-folder': folder, checked: ticked === repos.length && repos.length > 0 });
    master.indeterminate = ticked > 0 && ticked < repos.length;
    master.addEventListener('change', () => {
      for (const r of repos) pickerTicks.set(r.path, master.checked);
      commitPicker();
    });
    return el('div', { class: 'picker-group' }, [
      el('label', { class: 'picker-folder' }, [
        master,
        el('span', { class: 'picker-folder-name', text: folder }),
        el('span', { class: 'path', text: `${ticked} of ${repos.length} shown` }),
      ]),
      ...repos.map((r) => {
        const box = el('input', { type: 'checkbox', 'data-path': r.path, checked: pickerTicks.get(r.path) });
        box.addEventListener('change', () => {
          pickerTicks.set(r.path, box.checked);
          commitPicker();
        });
        return el('label', { class: 'picker-repo' }, [
          box,
          el('span', { text: r.name }),
          el('span', { class: 'path', text: shortPath(r.path, state.roots), title: r.path }),
        ]);
      }),
    ]);
  });

  $('repo-picker').replaceChildren(
    ...(blocks.length ? blocks : [el('p', { class: 'hint', text: 'Nothing matches.' })]),
  );
  const shown = [...pickerTicks.values()].filter(Boolean).length;
  $('picker-count').textContent = `${shown} shown · ${pickerTicks.size - shown} hidden`;
  $('roots').value = state.roots.map((r) => r.configured).join('\n');
}

async function commitPicker() {
  await withBusy('Saving selection…', () =>
    putJson('/api/config', {
      roots: state.roots.map((r) => r.configured),
      hidden: [...pickerTicks.entries()].filter(([, on]) => !on).map(([path]) => path),
    }),
  );
  await refresh();
}

/* ------------------------------------------------------------------- server */

async function api(path, init) {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

const putJson = (path, data) =>
  api(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });

/** Serialise long-running actions so a double-click can't overlap two scans. */
async function withBusy(message, work) {
  if (state.busy) return;
  state.busy = true;
  for (const b of document.querySelectorAll('.bar button')) b.disabled = true;
  $('status-line').textContent = message;
  try {
    await work();
  } catch (error) {
    $('status-line').textContent = `Error: ${error.message}`;
    return;
  } finally {
    state.busy = false;
    for (const b of document.querySelectorAll('.bar button')) b.disabled = false;
  }
  render();
}

async function refresh() {
  await withBusy('Reading local git state…', async () => {
    const data = await api('/api/repos');
    Object.assign(state, data);
    renderPicker();
  });
}

async function fetchAll() {
  await withBusy('Fetching from remotes…', async () => {
    const { results } = await api('/api/fetch', { method: 'POST', body: '{}' });
    const failed = results.filter((r) => !r.ok);
    const data = await api('/api/repos');
    Object.assign(state, data);
    render();
    if (failed.length) {
      $('status-line').textContent = `Fetched ${results.length - failed.length}/${results.length}. Failed: ${failed
        .map((f) => f.path.split('/').pop())
        .join(', ')}`;
      throw new Error($('status-line').textContent);
    }
  });
}

/* ------------------------------------------------------------------- wiring */

$('refresh').addEventListener('click', refresh);
$('fetch-all').addEventListener('click', fetchAll);

$('search').addEventListener('input', (e) => {
  state.query = e.target.value;
  render();
});

$('settings-toggle').addEventListener('click', (e) => {
  const panel = $('settings');
  panel.hidden = !panel.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
});

$('save-roots').addEventListener('click', async () => {
  const roots = $('roots')
    .value.split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  await withBusy('Saving…', () => putJson('/api/config', { roots, hidden: currentHidden() }));
  await refresh();
});

const currentHidden = () =>
  [...pickerTicks.entries()].filter(([, on]) => !on).map(([path]) => path);

const setAll = (checked) => {
  for (const path of pickerTicks.keys()) pickerTicks.set(path, checked);
  commitPicker();
};

$('picker-filter').addEventListener('input', (e) => {
  state.pickerQuery = e.target.value;
  renderPicker();
});

$('search-help-toggle').addEventListener('click', (e) => {
  const panel = $('search-help');
  panel.hidden = !panel.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
});

$('select-all').addEventListener('click', () => setAll(true));
$('select-none').addEventListener('click', () => setAll(false));

refresh();
