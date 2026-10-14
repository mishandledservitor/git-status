# Contributing to git-status

Bug reports, fixes and new features are all welcome.

## Before you start

- **For a security problem,** such as a way for the dashboard to run something other than `git fetch` or to reach outside the configured folders, do not open a public issue. Report it privately from the repository's **Security** tab with **Report a vulnerability**.
- **For a bug,** open an issue that says what you did, what you expected and what happened instead. Include your operating system, your Node.js and git versions, and the relevant part of the card or the server log. Leave out private repository names and paths.
- **For a new feature or a change in behaviour,** open an issue first and describe the problem it solves. Agreeing on the idea before you write code saves you from building something that won't be merged.
- **For a typo or a small fix,** go straight to a pull request.

## Setting up

You need Node.js 20 or later (CI uses Node.js 24) and git.

```sh
git clone https://github.com/<your-account>/git-status.git
cd git-status
npm install
npm run dev
```

`npm run dev` starts the server on <http://127.0.0.1:4173> and restarts it when a file changes. Set `GIT_STATUS_GUI_CONFIG` to a scratch file if you want to try settings without touching your own.

## How changes are made here

**Tests come first.** Write a test that fails because the behaviour is missing, then write the code that makes it pass, then tidy up with the tests still passing. A pull request that changes behaviour without a test for it will be asked for one.

**Pure logic stays pure.** `src/parse.ts` and `public/format.js` take strings and objects and return data, with no file system, network or DOM access, which keeps most tests fast. `public/format.js` is plain JavaScript so the browser and Vitest can both load it without a build. Code that runs git or serves HTTP lives in `src/git.ts`, `src/discover.ts` and `src/server.ts`, and its tests use real temporary git repositories.

**The dashboard never claims a repository is fine when it cannot tell.** When git cannot determine something, the card says so instead of showing zero.

**It is read-only apart from `git fetch`.** A change that adds any other command that writes to a repository needs an issue first, a confirmation in the interface and tests.

**The server has no runtime dependencies.** Development tools are fine. If something seems to need a runtime dependency, raise it in an issue first.

**Repository and branch names are untrusted.** They reach the page through `textContent`, never `innerHTML`, and git always runs without prompts and with a timeout.

## Before you open a pull request

Run the same checks as CI:

```sh
npm run typecheck
npm test
```

Then open the pull request against `main`:

- Keep it to one change, and say in the description what it does and why. Link the issue it closes.
- If it changes what a user sees, add a line under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md), written for the people who use the dashboard.
- CI must pass. On your first pull request, CI starts once a maintainer approves the run.
- Expect review comments; a maintainer merges the pull request once it is ready.

## Using coding agents

[`CLAUDE.md`](CLAUDE.md) holds the working rules for AI coding agents. Contributions written with an agent are welcome on the same terms as any other: the tests and the checks above all apply, and you are responsible for what you submit.

## Licence

git-status is released under the MIT licence. By opening a pull request, you agree that your contribution is released under the same licence.
