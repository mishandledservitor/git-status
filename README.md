# git-status

git-status is a local web dashboard that shows the git status of every repository under one or more folders on a single page. Each repository gets a card with its checked-out branch, unpushed and unpulled commits, uncommitted changes, stashes and stale branches, so you can see at a glance which ones hold work you have forgotten about. It runs on your own computer, binds to `127.0.0.1` only, and never changes a working tree.

## What you need

| What | Why |
|---|---|
| macOS 11 or later, or Linux | The dashboard runs anywhere Node.js and git run. The double-clickable `Git Status.app` launcher is macOS only. |
| Node.js 20 or later, with npm | The server is written in TypeScript and runs through `tsx`. |
| Git 2.15 or later | The dashboard reads every repository with the `git` command line. |
| Google Chrome (optional) | The macOS launcher opens the dashboard in Chrome, and falls back to your default browser if Chrome is not installed. |

No API key or account is needed.

## Quick start

1. Clone the repository:

   ```sh
   git clone https://github.com/mishandledservitor/git-status.git
   cd git-status
   ```

2. On macOS, double-click `Git Status.app` in the repository folder. The first launch runs `npm install`, which takes a moment. It then starts the server in the background and opens the dashboard. Keep the app inside the repository folder, because it finds the repository relative to itself; to launch it from the Dock or Applications, use an alias.
3. On Linux, or if you prefer a terminal, run `npm install` and then `npm start`, and open <http://127.0.0.1:4173>.
4. The dashboard scans `~/git` by default. If your repositories live somewhere else, click **Settings**, enter one folder per line under **Folders to scan**, and click **Save & rescan**.

The server keeps running in the background until you log out or stop it with `pkill -f "tsx src/main.ts"`.

To update, stop the server, run `git pull` and `npm install` in the repository folder, and launch it again.

## Using it

Each card covers one repository:

- It names the checked-out branch, or warns when HEAD is detached or a merge or rebase is in progress.
- It shows how far the branch is ahead of or behind **its own upstream**, which counts unpushed and unpulled commits.
- It shows how far the branch is ahead of or behind **the remote default branch**, which tells you how stale the checkout is.
- It counts staged, modified, untracked and conflicted files.
- It lists stashes and local branches whose upstream has been deleted.
- It keeps every local and remote branch in an expandable drawer.
- It says when the repository was last fetched.

Repositories that need attention sort to the top. **Ask Claude** copies the card to the clipboard with an instruction to investigate and propose next steps, ready to paste into a coding agent.

| Button | What it does |
|---|---|
| **Refresh** | This button re-reads the git state on disk without touching the network, and takes well under a second across dozens of repositories. Ahead and behind figures are only as fresh as your last fetch, and each card shows how long ago that was. |
| **Fetch all** | It runs `git fetch --all --prune` on every visible repository, then refreshes. |
| **Settings** | Here you choose the folders to scan and which repositories to show. Repositories are listed by subfolder, ticking a folder ticks everything in it, and the search box narrows the list. |

### Filtering

Cards are grouped by the subfolder under the scanned root, such as `work` or `personal`, and the **Group by folder** toggle switches to one flat grid. The chip row shows every folder with its repository count and how many need attention, plus one chip for each state that currently applies. Clicking a chip adds or removes its token in the filter box. Tokens are separated by spaces, and all of them must match.

| Token | Matches |
|---|---|
| `word` | The repository name, checked-out branch or path. |
| `-word` | Anything that matches the word is left out. |
| `folder:x` | The subfolder under the root, for example `folder:work`. |
| `branch:x` | The checked-out branch, for example `branch:prod`. |
| `is:state` | One of `attention`, `dirty`, `clean`, `ahead`, `behind`, `diverged`, `detached`, `stash`, `noremote` or `error`. |

For example, `folder:work is:dirty -archive` shows every repository under `work` with uncommitted changes whose name, branch or path does not contain "archive". An unknown `is:` state matches nothing.

### Configuration

Settings are stored in `~/.config/git-status-gui/config.json`, or under `$XDG_CONFIG_HOME` when that is set. The `GIT_STATUS_GUI_CONFIG` environment variable points to a different file.

```json
{ "roots": ["~/git"], "hidden": ["/home/you/git/some-repo"] }
```

Unticking a repository in **Settings** adds it to `hidden`. Newly cloned repositories appear automatically. The `PORT` (default `4173`) and `HOST` (default `127.0.0.1`) environment variables change where the server listens.

## Your data

Everything stays on your computer. The server reads your repositories with git and serves the dashboard to your own browser; it sends nothing anywhere else. The only command that writes anything is `git fetch`, which updates remote-tracking refs and never touches your working tree, index or local branches. Fetches use the git credentials you already have, and git never stops to ask for a password: a repository that needs one is named in the status line as a failed fetch. **Ask Claude** only copies text to your clipboard. The macOS launcher writes a log to `~/Library/Logs/git-status-gui.log`.

## Known limitations

- Bare repositories and mirrors are not listed, because discovery looks for a working tree with a `.git` entry.
- Discovery stops at the first `.git` it finds, so a checkout nested inside another repository's working tree is not reported separately.
- Discovery never walks into `node_modules`, `vendor`, `Library`, `dist`, `build`, `target`, `__pycache__` or hidden folders, and symlinks may not lead outside a configured root.
- The default branch comes from the remote's own `HEAD`, falling back to `origin/main`, `origin/master` and then any `<remote>/main` or `<remote>/master`. If none exists, that row reads "unknown".
- When a branch's upstream has been deleted, git cannot count ahead and behind, so the card says **upstream gone** instead of a figure.
- Discovery goes at most 12 folders deep below each root.

## Development

```sh
npm test           # Vitest: 160 tests
npm run typecheck  # tsc --noEmit
npm run dev        # server that restarts when a file changes
npm run icon       # redraw the launcher icon (macOS only)
```

`src/parse.ts` (git output parsers) and `public/format.js` (display helpers shared by the browser and the tests) are pure functions with no input or output. `src/git.ts`, `src/discover.ts` and `src/server.ts` do the input and output, and their tests run against real temporary git repositories. The frontend is plain JavaScript modules with no build step, and the server has no runtime dependencies.

`scripts/make-icon.mjs` defines the launcher icon as vector shapes, rasterises them at every size macOS needs and packs `Git Status.app/Contents/Resources/AppIcon.icns`. `assets/icon.svg` is a preview generated from the same constants, so edit the script rather than the SVG.

To contribute, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licence

MIT. See [`LICENSE`](LICENSE).
