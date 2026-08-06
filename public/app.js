import {
  attentionScore,
  claudePrompt,
  dirtySummary,
  divergence,
  divergenceRows,
  filterRepos,
  relativeTime,
  shortPath,
  sortRepos,
} from './format.js';

const $ = (id) => document.getElementById(id);

const state = {
  repos: [],
  hidden: [],
  roots: [],
  scannedAt: null,
  query: '',
  busy: false,
};

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

function render() {
  const visible = sortRepos(filterRepos(state.repos, state.query));
  const app = $('app');
  app.replaceChildren(
    ...(visible.length
      ? visible.map(card)
      : [
          el('p', {
            class: 'empty',
            text: state.repos.length
              ? 'No repos match that filter.'
              : 'No repos found. Check the folders to scan under Settings.',
          }),
        ]),
  );

  const needing = state.repos.filter((r) => attentionScore(r) > 0).length;
  $('status-line').textContent = state.scannedAt
    ? `${state.repos.length} repos · ${needing} need attention · ${state.hidden.length} hidden · scanned ${relativeTime(state.scannedAt)}`
    : '';
}

function renderPicker() {
  const all = [
    ...state.repos.map((r) => ({ path: r.path, name: r.name, shown: true })),
    ...state.hidden.map((r) => ({ path: r.path, name: r.name, shown: false })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  $('repo-picker').replaceChildren(
    ...all.map((r) =>
      el('label', {}, [
        el('input', { type: 'checkbox', 'data-path': r.path, checked: r.shown }),
        el('span', { text: r.name }),
        el('span', { class: 'path', text: shortPath(r.path, state.roots), title: r.path }),
      ]),
    ),
  );

  $('roots').value = state.roots.map((r) => r.configured).join('\n');
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
  [...$('repo-picker').querySelectorAll('input:not(:checked)')].map((i) => i.dataset.path);

$('repo-picker').addEventListener('change', async () => {
  await withBusy('Saving selection…', () =>
    putJson('/api/config', {
      roots: state.roots.map((r) => r.configured),
      hidden: currentHidden(),
    }),
  );
  await refresh();
});

const setAll = (checked) => {
  for (const box of $('repo-picker').querySelectorAll('input')) box.checked = checked;
  $('repo-picker').dispatchEvent(new Event('change'));
};

$('select-all').addEventListener('click', () => setAll(true));
$('select-none').addEventListener('click', () => setAll(false));

refresh();
