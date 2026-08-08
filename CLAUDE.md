# git-status

## What this repo is

A local web app that shows the git status of every repository under configured root folders
(default `~/git`) on one page. Node + TypeScript backend over `node:http` with **no runtime
dependencies**; plain-JS ES-module frontend with no build step. See [`README.md`](README.md)
for what it shows and its known limitations.

## Conventions

- **Test-first.** Write the failing test, make it pass, then simplify. `npm test` must be green
  and `npm run typecheck` clean before anything is committed.
- **No runtime dependencies.** Dev-only deps (vitest, tsx, typescript) are fine. If something
  seems to need a runtime dep, that is a design discussion, not a quiet `npm install`.
- **Pure logic goes in pure modules.** `src/parse.ts` and `public/format.js` take strings/objects
  and return data — no I/O, no DOM. That is what keeps the test suite fast and honest.
  `public/format.js` is plain JS precisely so the browser and vitest can share it unbuilt.
- **Never lie about repo state.** A card that says "clean" or "in sync" when it isn't is the
  worst bug this app can have. When git cannot determine something, say so — do not fall back
  to a reassuring zero. See the `gone` flag on `Upstream` for the canonical example.
- **Read-only except `git fetch`.** No pull, push, checkout, prune-by-deleting, or anything else
  that touches a working tree, index, or local branch. Adding a write action needs a deliberate
  decision, confirmation UI, and tests.
- **Everything from the filesystem is untrusted display data.** Repo and branch names reach the
  DOM via `textContent`, never `innerHTML`. The fetch endpoint only runs git in a directory the
  current scan actually discovered.
- Git subprocesses always run non-interactively (`GIT_TERMINAL_PROMPT=0`, `ssh -oBatchMode=yes`)
  with a timeout. One credential prompt would hang a whole refresh.

## Current status

Last updated: 2026-08-08
Working end to end against ~28 real repos; refresh takes well under a second. 143 tests pass.
Launched by double-clicking `Git Status.app`, which wraps `scripts/launch.sh` — that script runs
with a bare launchd PATH and no terminal, so it resolves Node explicitly and reports failures
through an AppleScript dialog plus `~/Library/Logs/git-status-gui.log`.

- Full history: `CHANGELOG.md`.
- If this section contradicts what you see in the repo, trust the repo and flag the mismatch.
- `.claude/settings.local.json` is gitignored by default — commit it only to deliberately share config across machines.
- No `LICENSE` yet — this repo is **private by default**.
