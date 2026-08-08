# git-status

A local dashboard showing the git status of every repository under one or more folders,
so you can see at a glance which ones have work you have forgotten about.

## Running it

**Double-click `Git Status.app`** (macOS). It starts the server if it is not already running and
opens the dashboard in Google Chrome — no terminal, no typing. First run installs the dev
dependencies, which takes a moment; after that it is instant. Drag it to the Dock to keep it
handy, but leave the bundle itself inside the repo folder — it locates the repo relative to
itself. Anything it has to say goes to `~/Library/Logs/git-status-gui.log`.

The server then stays running in the background until you log out or stop it:

```bash
pkill -f "tsx src/main.ts"
```

Or start it the ordinary way:

```bash
npm install && npm start
```

Then open <http://127.0.0.1:4173>.

## What it shows

Per repo, on one card:

- the checked-out branch (or a detached-HEAD / merging / rebasing warning)
- how far ahead or behind that branch is **of its own upstream** — unpushed and unpulled commits
- how far ahead or behind it is **of the remote default branch** — how stale the checkout is
- the working tree: staged, modified, untracked and conflicted file counts
- stashes, and any local branches whose upstream has been deleted
- every local and remote branch, in an expandable drawer
- when the repo was last fetched

Repos needing attention sort to the top. **Ask Claude** copies the card, plus an instruction to
investigate and propose next steps, ready to paste into a coding agent.

## Buttons

| Button | What it does |
| --- | --- |
| **Refresh** | Re-reads on-disk git state. No network, sub-second across dozens of repos. Ahead/behind figures are only as fresh as your last fetch — each card shows how long ago that was. |
| **Fetch all** | Runs `git fetch --all --prune` on every visible repo, then refreshes. |
| **Settings** | Edit the folders to scan, and tick/untick which repos to show. |

`git fetch` is the only command this app runs that writes anything, and it only ever updates
remote-tracking refs — never your working tree, index, or local branches. Everything else is a read.

## Configuration

Stored at `~/.config/git-status-gui/config.json` (override with `GIT_STATUS_GUI_CONFIG`):

```json
{ "roots": ["~/git"], "hidden": ["/Users/you/git/some-repo"] }
```

Unticking a repo adds it to `hidden`. Anything newly cloned shows up automatically.

`PORT` and `HOST` are also honoured; the default binds to `127.0.0.1` only.

## Scope and known limitations

- **Working-tree repos only.** Discovery looks for a `.git` entry, so **bare repos and mirrors
  are not listed**. They have no checked-out branch or working tree, which is most of what this
  dashboard is about.
- Discovery stops descending at the first `.git` it finds, so a checkout nested inside another
  repo's working tree is not reported separately.
- `node_modules`, `vendor`, `dist`, `build`, `target`, `__pycache__` and dot-directories are
  never walked into, and symlinks may not escape the configured root.
- The default branch is taken from the remote's own `HEAD`, falling back to `origin/main`,
  `origin/master`, then any `<remote>/main|master`. If none exists, that row reads "unknown".
- When a branch's upstream has been deleted, git cannot compute ahead/behind at all — the card
  says **upstream gone** rather than showing a misleading "in sync".

## Development

```bash
npm test          # vitest, ~140 tests
npm run typecheck # tsc --noEmit
npm run dev       # server with reload
npm run icon      # redraw Git Status.app's icon
```

`scripts/make-icon.mjs` is the icon: it defines the artwork as vector shapes, rasterises them
at every size the iconset needs, and packs `AppIcon.icns`. It draws them itself rather than
letting QuickLook rasterise an SVG, because QuickLook flattens transparency onto white — which
puts a white box behind the icon everywhere macOS draws it. `assets/icon.svg` is a preview
generated from the same constants; edit the script, not the SVG.

Built test-first. The layout separates pure logic from I/O so most of it is testable without a
subprocess: `src/parse.ts` (git output parsers) and `public/format.js` (display helpers, shared
by the browser and the tests) are pure; `src/git.ts`, `src/discover.ts` and `src/server.ts` do
the I/O and are covered by integration tests against real temporary git repositories.
