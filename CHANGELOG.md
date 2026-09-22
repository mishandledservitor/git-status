# Changelog

Notable changes to this repo. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Cards grouped by the subfolder under the scanned root, with a per-folder heading (repo count, attention count, a hover "only" button) and a "Group by folder" toggle remembered per browser.
- A chip row above the cards: one chip per folder (count and attention badge) and one per state that currently applies (needs attention, dirty, ahead, behind, diverged). A chip adds or removes its token in the filter box; a "Clear filter" chip appears when the box is non-empty.
- Filter syntax: `folder:x`, `branch:x`, `is:state` and `-word` alongside free text, all tokens ANDed; a `?` next to the box explains it. The status line says "showing N of M" while a filter is active.
- Settings picker grouped by folder with a tri-state folder checkbox, a search box over repo and folder names, and a shown/hidden count.
- Local web dashboard showing git status for every repo under configured root folders (default `~/git`): checked-out branch, divergence from both its upstream and the remote default branch, working-tree counts, stashes, in-progress merge/rebase, detached HEAD, branches whose upstream is gone, and full local/remote branch lists.
- **Refresh** (local-only, sub-second) and **Fetch all** (`git fetch --all --prune`) buttons.
- Settings panel for editing the scanned folders and ticking which repos to show; persisted to `~/.config/git-status-gui/config.json`.
- Per-card **Ask Claude** button copying the card plus an instruction for a coding agent.
- Repos sort by how much attention they need; free-text filter over name, branch and path.
- **`Git Status.app`** — a double-clickable macOS launcher (wrapping `scripts/launch.sh`) that starts the server if it is not already up and opens the dashboard in Google Chrome. No terminal window; finds Node without a shell profile; runs `npm install` on first use.
- `GET /api/health` returning `{ app: "git-status-gui", ok: true }`, so the launcher can tell our server apart from anything else that happens to hold the port.
- An app icon — three repo cards on a commit rail, dotted in the dashboard's own status colours. `npm run icon` rasterises it and packs the `.icns`; `assets/icon.svg` is a preview generated from the same constants.
