# Spec — select and filter repos by subfolder and keyword; tidier UI

**Status:** SHIPPED on branch `folder-filters`, 2026-09-22. Simon, in chat, with a screenshot of the Settings panel: *"Update the git status too to make it more easy to select and filter repos based on subfolders and keywords, and make the ui better."* Spec Kit is not initialised in this repo (standing rule 2), so this is a plain markdown record of what was built and why, written the same day.

## What happens today

One flat grid of 48 cards sorted by attention; a free-text box matching name, branch or path as one substring; a Settings picker that is one alphabetical list of checkboxes with no way to act on a whole folder.

## What ships

1. **Grouping.** `repoFolder(path, roots)` names the first path segment under the matching root. Cards render one section per folder (heading with counts, hover "only" button), toggled by "Group by folder", remembered per browser in localStorage as a convenience only.
2. **Chips.** One chip per folder with repo count and attention badge; one chip per applicable state. A chip toggles its token in the filter box via `toggleToken`, so the box stays the single source of truth.
3. **Query syntax.** `parseQuery` splits whitespace tokens into free text, `-word`, `folder:`, `branch:` and `is:`; `filterRepos(repos, query, roots)` ANDs them. Unknown `is:` states match nothing. The old single-substring behaviour is preserved for plain words.
4. **Picker.** Grouped by folder with a tri-state folder checkbox, a search box, and a shown/hidden count. Ticks live in a map so filtering the list never loses a change.
5. **Look.** Chip row, section headings, card hover shadow, search box with a `?` help panel, wider settings layout. Dark mode kept.

## Tests

`src/format.test.ts`: `repoFolder`, `parseQuery`, `filterRepos` with every token kind (including AND and the no-roots call), `toggleToken`, `groupRepos` ordering and attention counts. Written red first; 160 pass.

## Not in scope

Any write action against a repo (still read-only except fetch). Per-folder fetch. Persisting the group toggle server-side.
