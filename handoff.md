# Handoff — claude-ai-chat-exporter (checkpoint 2026-09-29)

Machine-readable state: [`progress.json`](progress.json). History: [`CHANGELOG.md`](CHANGELOG.md), [Releases](https://github.com/tyhallcsu/claude-ai-chat-exporter/releases).
Worker findings, the Node harness and its fixture: [`docs/notes/`](docs/notes/).

## Resume point
**Development is paused on purpose; there's no half-finished code.** Everything is merged to `main`. The next work item is #31 (usage tracker), which hasn't been started.

- Repo path: `~/Documents/GitHub/claude-ai-chat-exporter` (a normal clone, not a worktree). Remote `tyhallcsu/claude-ai-chat-exporter` (public).
- Branch: `main`. This checkpoint was made on `chore/checkpoint-2026-09-29` and squash-merged (PR #35).
- Last confirmed `origin/main` before this checkpoint: `f56398c80c91f51adab3bc8f9f4d46e101f7424e`. The checkpoint squash commit comes after it (`git log -1 origin/main`).
- Background commands: none are running. Workers W1–W5 all finished (exit 0).

## Completed
| Item | Issue(s) | PR | Version |
|---|---|---|---|
| Shared-chat export (`/share/<id>` → `chat_snapshots` API) | #2 | #3 | 2026.09.29.1 |
| Handoff cleaned; `progress.json` added | #5 | #28 | — |
| HTML escaping (script injection), code blocks with blank lines, clipboard failure reporting, DOM-fallback alignment, attachment names, non-chat routes, text-only messages, backtick-safe fences; `npm test` | #9–#16 | #28 | 2026.09.29.2 |
| Options panel: "by sharmanhall" credit, links, UI refresh | #8 | #29 | 2026.09.29.3 |
| `CHANGELOG.md`, tags and releases v2026.04.22.1, v2026.09.29.1, .2, .3 (each with its `.user.js`) | #17 | #28 | — |
| Greasy Fork serves 2026.09.29.3 with the new description (code auto-syncs from raw `main`) | #7 | — | — |
| Tip commit on `main` re-authored with the maintainer's public identity (force-with-lease, approved) | #4 | — | — |
| Handoff/progress docs, #31 decisions | — | #30, #34 | — |
| Screenshots (parallel session; privacy-checked: pixelated URL and title, clean metadata) | — | #33 | — |
| Docs/roadmap README (parallel Codex session) | #18–#21 closed as duplicates | #27 | — |

## Tests and reviews
- `npm test`: 24/24 pass (node:test, no dependencies).
- `node docs/notes/node-harness.js`, run from the repo root: shared export (5 msgs), 403 error, and the `/chat` route all pass.
- Live in-page run on claude.ai, v2026.09.29.3, loaded with a GM API shim:
  - **Shared chat:** Markdown, HTML and JSON all have 5 messages in order; the HTML has no `<script>`.
  - **Owned chat after SPA navigation:** calls `chat_conversations`; 8 messages.
  - **UI:** credit and links render; Escape closes the panel.
- Reviews: W2 (PR #3) and W3 (all of `main`); findings in `docs/notes/review-findings.md`. Every W3 finding was fixed in #28.

## Partially completed / pending
- **#6: GitHub Support purge.** The old commits from PR #3 (`d4968aa`, `fe9b201`, `67f8265`, `dfdc73a`) and the pre-rewrite squash `5472c17` still return HTTP 200. The request draft is private, in the maintainer's local gitignored `.opx/github-support-request.md`; nothing sensitive is in the repo.
- **Tampermonkey-installed end-to-end test:** not run, because the Chrome extension wasn't connected. The in-page run above covers the same code.
- **The live no-access error on a share link:** covered by unit tests only.
- **Duplicate comment on #31:** a copy was posted from a non-maintainer account. The maintainer decides whether to delete it; the maintainer's own copy stays.

## To do
- **#31 usage tracker. Decided, not started.**
  - **Placement:** inline under the composer and in the Export panel, each optional.
  - **Default:** on, inline.
  - **Approach:** clean-room code against `GET /api/organizations/{org}/usage`. The reference script is GPL-3.0 and this repo is MIT, so none of its code can be copied.
- #22–#26: feature proposals (the roadmap in the README). #26 is partly covered by `npm test`.

## Conventions (public repo)
- Every commit, PR and issue uses the `tyhallcsu` identity. Commits use the author `tyhallcsu <16804423+tyhallcsu@users.noreply.github.com>`; gh runs per command with `GH_TOKEN="$(gh auth token --user tyhallcsu)"`.
- PII-scan every staged diff, issue body and PR body before publishing. No emails, account names or local config paths.
- Open an issue first, then fix. Use a branch, then a PR, then a squash-merge. Bump `@version` and `VERSION`, add a CHANGELOG entry, and create a release for each shipped version.
- Workers were run using isolated local Claude Code configurations. Account/config details are intentionally excluded from the public repository.

## Resume commands
```bash
cd ~/Documents/GitHub/claude-ai-chat-exporter
git fetch --prune && git checkout main && git pull --ff-only
git log --oneline -5 && npm test
GH_TOKEN="$(gh auth token --user tyhallcsu)" gh issue view 31 --repo tyhallcsu/claude-ai-chat-exporter
```
Then: `git checkout -b feat/usage-tracker` and implement #31 as described above.
