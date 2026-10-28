# Changelog

What changes in git-status from one release to the next, for people who use it. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Hide clean repos** in Settings leaves out every repository with nothing to act on, so the page shows only what needs you. The choice is saved with your other settings, and the status line says how many clean repos are hidden.
- **Open in Devin** on each card opens that repository's folder in Devin.

## [1.0.0] - 2026-10-14

This is the first public release. git-status is a local web dashboard that shows the git status of every repository under the folders you choose, on one page served from your own computer.

### Added

- Each repository gets a card with its checked-out branch, how far it is ahead of or behind both its upstream and the remote default branch, its staged, modified, untracked and conflicted file counts, its stashes, any merge or rebase in progress, a detached HEAD, branches whose upstream is gone, and every local and remote branch in a drawer.
- Repositories that need attention sort to the top.
- **Refresh** re-reads the local git state in well under a second, and **Fetch all** runs `git fetch --all --prune` on every visible repository.
- **Settings** edits the folders to scan and which repositories to show. The list is grouped by folder, with a checkbox that ticks a whole folder, a search box, and a count of shown and hidden repositories. Settings are saved to `~/.config/git-status-gui/config.json`.
- Cards are grouped by the subfolder under the scanned root, and a **Group by folder** toggle switches to one flat grid.
- A chip row offers one chip per folder and one per state that currently applies. Each chip adds or removes its token in the filter box.
- The filter box accepts free text plus `folder:x`, `branch:x`, `is:state` and `-word`, and every token must match. A `?` button next to the box explains the syntax.
- **Ask Claude** on each card copies the card with an instruction for a coding agent.
- `Git Status.app` is a double-clickable macOS launcher that installs the dependencies on first use, starts the server if it isn't already running, and opens the dashboard in Google Chrome or your default browser.
- `GET /api/health` lets the launcher tell this server apart from anything else on the port.
