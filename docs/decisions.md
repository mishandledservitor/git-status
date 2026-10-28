# Decisions

Decisions about how this repository is run, with the reason for each where it is not obvious.

| # | Decision | Who and when |
|---|---|---|
| 1 | The repository is published as a fresh public repository with a single commit, so the earlier private history is not public. | The owner, 2026-10-14 |
| 2 | `CLAUDE.md` is self-contained. It no longer syncs its rules from the owner's private template repo, and it names no tool or skill that is not in this repository. | The owner, 2026-10-14 |
| 3 | Development is test-first (red, green, refactor). Spec Kit is not used here; a larger feature may get a plain Markdown record under `specs/`. | The owner, 2026-10-14 |
| 4 | The first public release is version 1.0.0, and versions follow Semantic Versioning from here. | The owner, 2026-10-14 |
| 5 | Examples in tests, help text and documentation use neutral folder and repository names such as `work`, `personal` and `my-app`. | The owner, 2026-10-14 |
| 6 | The project is released under the MIT licence. | The owner, 2026-10-14 |
| 7 | Each card has an **Open in Devin** button. It only launches the editor on a discovered repo folder and touches no repository state, so it is not a write action under the read-only rule and needs no confirmation. | The owner, 2026-10-28 |
