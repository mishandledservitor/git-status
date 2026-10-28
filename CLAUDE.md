# git-status

## What this repo is

A local web app that shows the git status of every repository under configured root folders (default `~/git`) on one page. It is a Node and TypeScript backend over `node:http` with **no runtime dependencies**, and a plain JavaScript ES-module frontend with no build step. A double-clickable `Git Status.app` launcher starts it on macOS. [`README.md`](README.md) says what it shows and lists its known limitations; [`docs/decisions.md`](docs/decisions.md) records how the repo is run.

## Conventions

- **No runtime dependencies.** Development dependencies (vitest, tsx, typescript) are fine. If something seems to need a runtime dependency, that is a design discussion, not a quiet `npm install`.
- **Pure logic goes in pure modules.** `src/parse.ts` and `public/format.js` take strings or objects and return data, with no I/O and no DOM. That is what keeps the test suite fast and honest. `public/format.js` is plain JavaScript so the browser and vitest can share it unbuilt.
- **Never lie about repo state.** A card that says "clean" or "in sync" when it isn't is the worst bug this app can have. When git cannot determine something, say so instead of falling back to a reassuring zero. The `gone` flag on `Upstream` is the canonical example.
- **Read-only except `git fetch`.** No pull, push, checkout, deleting prune, or anything else that touches a working tree, index or local branch. Adding a write action needs a deliberate decision, a confirmation in the interface, and tests.
- **Everything from the filesystem is untrusted display data.** Repo and branch names reach the DOM through `textContent`, never `innerHTML`. The fetch endpoint only runs git in a directory the current scan actually discovered.
- **Git never waits for a human.** Git subprocesses always run non-interactively (`GIT_TERMINAL_PROMPT=0`, `ssh -oBatchMode=yes`) with a timeout, because one credential prompt would hang a whole refresh.
- **Examples use neutral names.** Tests, help text and docs use folder and repo names such as `work`, `personal` and `my-app`, and paths under `/home/you`. Never use a real private repo name, a real person's name or a real home path.

## Standing rules

Binding on any agent working in this repo. These are process rules, not project conventions. **This file is the only source of truth for them.** Delete one only deliberately, never because it looks like unused scaffolding.

1. **No agent memory.** Never rely on assistant-side memory, per-project memory files, or recall from a previous session. Everything durable lives in the repo: this file, `CHANGELOG.md`, `docs/decisions.md` and `specs/`. If something is worth remembering, write it here in the same turn you learn it. If a memory and the repo disagree, the repo wins.
2. **True TDD: red, green, refactor.** No production code without a failing test first. For every unit of work, write a test that fails for the right reason (red), write the minimum code to make it pass (green), then clean up with the tests still green (refactor). `npm test` must be green and `npm run typecheck` clean before anything is committed. This applies whatever door the work came in by, including a chat message or a request typed straight into a session. The only exception is a small, reversible change that does not alter behaviour, such as a typo, a comment or a note. If a user can see the behaviour change, it is tested first.
3. **No Spec Kit here.** A feature large enough to need a record of what was built and why gets a short Markdown file under `specs/`, as `specs/folder-filters.md` shows. Do not initialise Spec Kit without the owner's decision.
4. **All development happens on a worktree.** Never write code, tests or docs on a checkout of the main branch. Create a worktree with its own branch and work there. Only repo management belongs outside a worktree: opening and merging PRs, reviewing, tagging, releases, branch cleanup, and reading. If you notice you are about to edit a file on main, stop and make a worktree first.
5. **Commit every round.** Each round (one user request plus its completion) ends with a git commit of whatever that round changed, without waiting to be asked. Stage specific paths, never `-A`; review what is staged first; make new commits only (no `--amend` unless asked); never force-push. A pure Q&A round that changes no files has nothing to commit.
6. **Refresh `Current status` before each commit.** Update the "Current status" section below, including its `Last updated:` date, to match reality as part of the same commit, so the summary can never drift from the repo.
7. **Keep the changelog for users.** A change a user can see adds a line under `## [Unreleased]` in `CHANGELOG.md`, written for the people who use the dashboard, with no PR numbers, commit hashes or agent-process notes.
8. **Context and delegation.** Keep long sessions clean: hand work that would produce large exploratory output (broad searches, file dumps, log reads) to a subagent and keep only its conclusion in the main conversation. Give a self-contained piece of work its own worktree and branch.
9. **Don't narrate no-ops.** A check that came back empty doesn't need a line of output. Report what you did and what the user has to decide.
10. **Never hard-wrap text meant for a human to read.** No fixed-column line breaks in UI copy, chat messages, docs prose or commit-message bodies: one paragraph is one line, and the device does the wrapping. This does not touch code: source lines, `<pre>` blocks, ASCII tables and fixed-width terminal output stay as they are.
11. **Never touch a `.env` file without asking the user.** Not to untrack it, delete it, move it or rewrite it. Report what you found, say what reads the file, and ask. Reading one to classify a key is allowed, changing one is not, and no value ever appears in a report, a commit message or a prompt. Before removing any file to satisfy a guard, ask what reads it.

## Commands

Node 20 or later (CI uses Node 24).

```sh
npm install         # dev dependencies only
npm start           # server on http://127.0.0.1:4173 (PORT and HOST override)
npm run dev         # server that restarts on change
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run icon        # redraw the launcher icon (macOS only, uses iconutil)
pkill -f "tsx src/main.ts"   # stop a server the launcher started
```

## Structure

- `src/main.ts`: reads `PORT`, `HOST` and `GIT_STATUS_GUI_CONFIG` and starts the server.
- `src/server.ts`: static files and the JSON API (`/api/config`, `/api/repos`, `/api/fetch`, `/api/health`).
- `src/discover.ts`: walks the configured roots to find working-tree repos.
- `src/git.ts`: runs git non-interactively and builds each repo's status; `src/parse.ts` parses git output (pure).
- `src/config.ts`: loads and saves `~/.config/git-status-gui/config.json` (respects `XDG_CONFIG_HOME`).
- `src/testkit.ts`: helpers that build temporary git repos for the integration tests; tests sit next to the code as `*.test.ts`.
- `public/`: the frontend (`index.html`, `app.js`, `style.css`) and `format.js`, the pure display helpers shared with the tests.
- `Git Status.app/`: the macOS launcher, which execs `scripts/launch.sh`. The script runs with a bare launchd PATH and no terminal, so it finds Node explicitly and reports failures in a dialog and in `~/Library/Logs/git-status-gui.log`.
- `scripts/make-icon.mjs`: draws the launcher icon and writes `assets/icon.svg` as a preview.
- `specs/`: plain Markdown records of larger features. `docs/decisions.md`: decisions about how the repo is run.

## CI/CD

- `.github/workflows/ci.yml` (`CI`) runs on every PR and push to main: `npm ci`, `npm run typecheck`, `npm test` on ubuntu-latest with Node 24. It uses no secrets.

## Current status

Last updated: 2026-10-28
- Release 1.0.0, the first public release. What it does for a user is in `CHANGELOG.md`.
- It works end to end against a folder of about fifty repos, and a refresh takes well under a second. 177 tests pass and the typecheck is clean.
- Each card has an **Open in Devin** button (`POST /api/open`, macOS `open -a Devin`, only for repos the scan found).
- Settings has a **Folders to ignore** box (`ignoredFolders` in the config, applied in `discoverRepos` so nothing under them is walked or fetched).
- Settings has a **Hide clean repos** checkbox (`hideClean` in the config, `withoutClean` in `public/format.js`, same test as `is:clean`).
- Cards group by subfolder, and the filter box has a small token syntax (`folder:`, `branch:`, `is:`, `-word`) driven by clickable chips.
- If this section contradicts what you see in the repo, trust the repo and flag the mismatch.
- `.claude/settings.local.json` and `.claude/skills/` are gitignored, so personal settings and skills stay local.
- Licence: MIT (`LICENSE`).
