# Handoff — claude-ai-chat-exporter

Machine-readable state: [`progress.json`](progress.json). History: [`CHANGELOG.md`](CHANGELOG.md) and [Releases](https://github.com/tyhallcsu/claude-ai-chat-exporter/releases).

## Current state (2026-09-29)
- **Screenshots** (#33): `assets/screenshots/`. The URL and chat title are pixelated, and the image metadata is clean.
- **Latest version:** `2026.09.29.3`, tagged and released as `v2026.09.29.3`. Greasy Fork serves the same version and syncs from raw `main`.
- **Shared-chat export** (#2, #3):
  - `/share/<id>` loads `/api/organizations/{org}/chat_snapshots/{id}`. `/chat/<id>` still loads `chat_conversations/{id}`.
  - 401/403/404 and non-JSON responses show clear errors. Share routes never use the copy-button fallback.
- **Bug fixes** (#9–#16, PR #28, v2026.09.29.2): HTML escaping, code blocks with blank lines, clipboard failure reporting, DOM-fallback alignment, attachment names, non-chat routes, text-only messages, and backtick-safe fences.
- **UI** (#8, PR #29, v2026.09.29.3):
  - Options panel credits "by sharmanhall" (Greasy Fork profile) and links to Greasy Fork, GitHub and issues.
  - Segmented format picker, toggles, and Escape or an outside click to close.
- **Releases** (#17): `CHANGELOG.md`; tags and releases v2026.04.22.1, v2026.09.29.1, .2 and .3, each with its `.user.js`.

## Snapshot API shape (live, 2026-09-29)
- Top-level keys: `uuid`, `conversation_uuid`, `snapshot_name`, `chat_messages`, `created_by`, `creator`, `project_uuid`, `is_public`, `working_documents`.
- There's no `name` and no `current_leaf_message_uuid`. Every message has `parent_message_uuid`.

## Validation
- `npm test`: 24/24 pass (node:test, no dependencies).
- Live in-page run, real claude.ai session, v2026.09.29.3. The script was loaded into the page with a GM API shim, not through Tampermonkey.
  - **Shared chat:** Markdown has the correct title and 5 alternating messages with no empty bodies. HTML has 5 sections and no `<script>`. JSON has 5 messages.
  - **Owned chat after SPA navigation:** calls `chat_conversations`; 8 alternating messages; a single Export button.
- Not yet run: installing through Tampermonkey itself and exporting there, and the no-access error on a live share (it's covered by unit tests).

## Privacy remediation (public repo)
- **#4 (done):** `main` was rewritten so every commit uses the maintainer's public noreply identity. The code didn't change.
- **#5 (done):** this file contains no environment or account details.
- **#6 (open):** PR #3's historical commits and the pre-rewrite squash commit are still served by GitHub. Only GitHub Support can purge them; the maintainer has a private request draft.
- **Accepted:** the creator and merge-actor metadata on #2 and #3 can't be edited. Deleting and re-creating them would lose history for little benefit.

Workers were run using isolated local Claude Code configurations. Account/config details are intentionally excluded from the public repository.

## Open
- #31: usage-limit tracker. **Decided, not started.**
  - **Placement:** both inline under the composer and inside the Export panel. Each placement can be turned off.
  - **Default:** on, inline under the composer.
  - **Approach:** clean-room code against `GET /api/organizations/{org}/usage`. The reference script is GPL-3.0 and this repo is MIT, so none of its code can be copied. Credit the original in the README.
- #6: GitHub Support purge (maintainer action).
- #22–#26: feature proposals (the roadmap in the README).

## Next action
1. The maintainer sends the GitHub Support request for #6.
2. When development resumes: implement #31 per the decisions above, with synthetic `/usage` fixtures in `npm test`. Ship it as the next version with a changelog entry and a release.
