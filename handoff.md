# Handoff — claude-ai-chat-exporter

Machine-readable state: [`progress.json`](progress.json).

## Current state
- Shared-chat export (`claude.ai/share/<id>`) is merged: issue #2, PR #3, version `2026.09.29.1`.
- Share routes load `/api/organizations/{org}/chat_snapshots/{id}?rendering_mode=messages&render_all_tools=true`.
  Normal chats still load `chat_conversations/{id}`.
- Share routes never fall back to the copy-button path (share pages have none). 401/403/404 and non-JSON responses show clear errors.

## Verified snapshot shape (live, 2026-09-29)
- Top-level keys: `uuid`, `conversation_uuid`, `snapshot_name`, `chat_messages`, `created_by`, `creator`, `project_uuid`, `is_public`, `working_documents`.
- There's no `name` and no `current_leaf_message_uuid`. Every message has `parent_message_uuid`.
- `document.title` is just "Claude".

## Tests
- Node harness (run locally, not committed) uses the real snapshot structure with the message text replaced.
  - Share export: 5 messages in order, title taken from `snapshot_name`.
  - 403: clear no-access error.
  - `/chat/<id>`: still calls `chat_conversations`.
- Live snapshot API: HTTP 200, 5 parent-linked messages.
- Tampermonkey end-to-end: see `progress.json` (`tampermonkey_end_to_end`).

## Privacy remediation (public repo)
- #4 (done): the tip commit was rewritten with the maintainer's noreply identity, and #27 was replayed on top. The code is unchanged; `main` became `229ed0f`.
- #5: this file previously had local environment details. Now replaced with neutral wording.
- #6: PR #3's historical commits are still served by GitHub (commit pages, `.patch`). Only GitHub Support can remove them; the request is drafted privately.
- Issue/PR creator and merge-actor metadata on #2 and #3 can't be edited. Deleting and re-creating them would lose history for little benefit.

Workers were run using isolated local Claude Code configurations. Account/config details are intentionally excluded from the public repository.

## Open work
- #9–#16: bug fixes and `npm test` suite, shipping as 2026.09.29.2.
- #7: publish the current build to Greasy Fork (script 574914).
- #8: author credit and options-panel UI polish.

## Next action
See `progress.json` → `next_actions[0]`.
