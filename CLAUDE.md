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

<!-- SYNCED FROM vl-templates/repo-template/CLAUDE.md — DO NOT EDIT BY HAND (run tools/sync_rules.py) -->
## Standing rules

Binding on any agent working in this repo, from day one — these are process rules, not project
conventions, so unlike the section above they ship filled in. **This file is the only source of
truth for them.** They survive into every repo made from this template; delete one only
deliberately, never because it looks like unused scaffolding. This section is synced from
`vl-templates/repo-template/CLAUDE.md` by `tools/sync_rules.py` — edit the template, not a copy of
it, and re-run the sync so the edit reaches every repo that has one. Everything outside the two
HTML comment markers bounding this section is local to this repo and is never touched by a sync.

1. **No agent memory.** Never rely on assistant-side memory, per-project memory files, or recall
   from a previous session. Everything durable lives in the repo: this file, `CHANGELOG.md`, and
   (once Spec Kit is initialized) `.specify/memory/constitution.md` and `specs/`. If something is
   worth remembering, write it here in the same turn you learn it. If a memory and the repo
   disagree, the repo wins.
2. **Spec Kit governs all development.** Every feature flows through
   `/speckit-specify` → (`/speckit-clarify` as needed) → `/speckit-plan` → `/speckit-tasks` →
   (`/speckit-analyze` / `/speckit-checklist` as needed) → `/speckit-implement`. No production code
   is written outside a spec'd, planned, tasked feature. If Spec Kit isn't initialized yet, that is
   the first development step — it is not optional:

   ```bash
   specify init --here --integration claude
   ```

   Then ratify a constitution with `/speckit-constitution` before the first feature. The
   constitution outranks this file on anything about the code itself; these standing rules govern
   process and agent behaviour.
3. **All development happens on a worktree.** Never write code, tests, specs, or plans on a
   checkout of the main branch. Create a worktree with its own branch and work there. Only *repo
   management* belongs outside a worktree: opening and merging PRs, reviewing, tagging, releases,
   branch cleanup, and reading. If you notice you are about to edit a file on main, stop and make a
   worktree first.
4. **Commit every round.** Each round — one user request plus its completion — ends with a git
   commit of whatever that round changed, without waiting to be asked. This includes work that
   isn't a natural "please commit" moment, such as Spec Kit artifacts (`spec.md`, `plan.md`,
   `tasks.md`). Stage specific paths, never `-A`; review what's staged first; new commits only (no
   `--amend` unless asked); no force-push. A pure Q&A round that changes no files has nothing to
   commit.
5. **Refresh `Current status` before each commit.** Update the "Current status" section below —
   including its `Last updated:` date — to match reality as part of the same commit, so the summary
   can never drift from the repo. Check it every round rather than assuming it still holds.
6. **Context & delegation.** Use the `context-preservation` skill to keep long sessions clean, and
   dispatch a **worktree** subagent per phase whenever a phase is self-contained enough to run
   independently (its own branch, its own test run). Typical split: one worktree per Spec Kit phase,
   or per independent task group in `tasks.md`. Judgement call — skip it when the phase is a few
   lines, or when phases touch the same files and would conflict on merge.
7. **Don't narrate no-ops.** A check that came back empty doesn't need a line of output. Report
   what you did and what the user has to decide, not the scaffolding you looked at on the way.
   The recurring offender is Spec Kit's extension-hook check: with no `.specify/extensions.yml`
   — the default — every `/speckit-*` command's hook check is a guaranteed no-op, and the skills
   already say to skip it silently. Do that; don't announce "no hooks configured". If that file
   is ever added, the hooks become real and this rule stops covering them.
8. **CodeGraph is mandatory.** Every repo made from this template runs
   [CodeGraph](https://github.com/colbymchenry/codegraph) — an MCP server that indexes the
   codebase into a knowledge graph so agents get call paths and impact analysis in one tool call
   instead of grepping the tree by hand. Part of first-time repo setup, alongside Spec Kit init:
   install the CLI if missing (`curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh`
   or `npm i -g @colbymchenry/codegraph`), run `codegraph install` once to wire this agent's MCP
   config, then `codegraph init` in the repo root to build the index. It watches files and
   auto-syncs in the background; use `codegraph sync` if it ever needs a manual nudge. Once a
   `.codegraph/` index exists, use the `codegraph_explore` tool for architecture, call-flow, or
   impact-analysis questions instead of manual exploration.
9. **True TDD — red, green, refactor.** No production code without a failing test first. For
   every unit of work: write a test that fails for the right reason (red), write the minimum
   code to make it pass (green), then clean up with the tests still green (refactor). This is
   not a separate phase bolted onto Spec Kit — it happens inside `/speckit-implement`: each
   task's test is written and shown failing before that task's implementation is written.
9b. **Rules 9 and Spec Kit apply whatever door the work came in by.** Board instruction 2026-08-22: *"always spec kit and test driven development even when and even when I'm emailing you and even when I'm driving the session directly from the Claude code desktop interface"*. Work dispatched from a queue item arrives with a spec; work that arrives as an email, a chat message, or the board typing at a session in person does not, and that was never a decision — it is just what happened when work skipped the queue. A rule that binds the slow path and not the fast one binds nothing, because urgent work takes the fast path by definition. A human watching a session is not a substitute for a test: they catch what they happen to look at. Act on what is genuinely urgent, then spec and test the build rather than implementing straight out of an inbox. The exception is the small reversible non-shipping change — a typo, a comment, a note; if a user can see the behaviour change, it is spec'd and tested. See `vl-management/decisions/2026-08-22-spec-kit-and-tdd-are-not-conditional.md`.
10. **Never hard-wrap text meant for a human to read.** No fixed-column line breaks in email bodies, UI copy, generated reports, chat messages, docs prose, or commit-message bodies — one paragraph is one line, and the device does the wrapping. A 72-column break is invisible on the machine that wrote it and looks broken on every phone. Board ruling, 2026-08-17, on receiving a hard-wrapped company email. This does not touch code: source lines, `<pre>` blocks, ASCII tables, and fixed-width terminal output are wrapped for the machine, not the reader, and stay as they are.
11. **Never touch a `.env` file without asking the board.** Not to untrack it, delete it, move it, or rewrite it — bring it to the board and let the board decide, the same standing rule vl-management CLAUDE.md rule 14 states company-wide. The replacement, in the same breath: report what you found, say what reads the file, and post the ask; reading one to classify a key is allowed, changing one is not, and no value ever appears in a report, a commit message, or a prompt. Several repos track a `.env` on purpose — a Vite build inlines publishable keys into the browser bundle at build time, so the tracked file is the only configuration such a build has, and removing it ships a blank page. This is not hypothetical: a security-shaped `.env` change blacked out a live company site for five hours seventeen minutes on 2026-08-26. Before removing a file to satisfy a guard, ask what reads it; if the answer is the build, the removal is an outage.
12. **This file is synced, not just copied.** `tools/sync_rules.py` in `vl-templates` propagates the managed block above (between the two HTML comment markers) into downstream repos' `CLAUDE.md` on demand — creating the file where one doesn't exist, or updating only the managed block where local content exists alongside it. A sync never touches a byte outside the markers. Marker: template-sync-mechanism-2026-09-01. Being synced is not automatic: a repo carries the current rules only once someone has actually run the tool against it since the last template edit, and most of the portfolio has not yet — that rollout is separate, later work, tracked on the queue rather than assumed to have happened.
<!-- END SYNCED BLOCK -->
