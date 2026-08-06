# <Project Name>

<!-- Replace <Project Name> and write one line under "What this repo is" once the purpose is real.
     Anything marked TBD stays TBD until there's something true to write — don't fill space. -->

## What this repo is

TBD — no defined purpose yet. Treat as a blank scaffold: don't assume a stack, build system,
or layout, and ask before creating directories that imply a direction (`src/`, `packages/`, `docs/`…).

## Conventions

TBD — hard rules land here as real friction reveals them (style, non-negotiables, things never to do).
Don't pre-invent a rule list; an unenforced rule is worse than none.

## Current status

Last updated: <date>
<one or two lines: what exists so far, what's next>

- Full history: `CHANGELOG.md`.
- If this section contradicts what you see in the repo, trust the repo and flag the mismatch.
- `.claude/settings.local.json` is gitignored by default — commit it only to deliberately share config across machines.
- Add a `VERSION` file only once there's a package manifest, submodule set, or release process to pin it to.
- No `LICENSE` yet — this repo is **private by default**. Add one only once the purpose (and whether it goes public) is established.

<!-- ─── Add the sections below only when each is REAL. Use these exact names (they recur across the
         other repos). An empty version of any of these is ceremony that rots — leave it out until true. ───

## Structure         annotated tree — `path` — role — one line, once there's a layout worth mapping
## Commands          build / run / test, once such a system exists
## Data model / API   schema or route list, once there is one
## Branch strategy    once there's a release process or more than one contributor
## CI/CD              list each workflow by name + trigger, once workflows exist
## Deep reference     Need | File routing table, once there are enough docs to route to
## Important notes    recurring gotchas — a lessons-learned LOG (add an entry once a mistake has
                      actually recurred, not a place to pre-guess failure modes)

     .claude/agents/ and .claude/skills/ are opt-in — add one only for real delegation or a reusable
     procedure worth packaging; never ship a placeholder. See .claude/README.md.
     Short-term / session notes aren't scaffolded — make a dated scratch file or notes/ ad hoc;
     .scratch/ is already gitignored, so adopting the habit costs nothing. -->
