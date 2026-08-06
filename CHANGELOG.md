# Changelog

Notable changes to this repo. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Local web dashboard showing git status for every repo under configured root folders
  (default `~/git`): checked-out branch, divergence from both its upstream and the remote
  default branch, working-tree counts, stashes, in-progress merge/rebase, detached HEAD,
  branches whose upstream is gone, and full local/remote branch lists.
- **Refresh** (local-only, sub-second) and **Fetch all** (`git fetch --all --prune`) buttons.
- Settings panel for editing the scanned folders and ticking which repos to show; persisted to
  `~/.config/git-status-gui/config.json`.
- Per-card **Ask Claude** button copying the card plus an instruction for a coding agent.
- Repos sort by how much attention they need; free-text filter over name, branch and path.
