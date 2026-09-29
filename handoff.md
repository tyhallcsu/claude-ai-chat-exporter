# Handoff — shared-chat export fix

- Issue: https://github.com/tyhallcsu/claude-ai-chat-exporter/issues/2
- Branch: `fix/shared-chat-export`
- Plan: `~/.claude/plans/fix-it-so-shared-luminous-pizza.md`

## Root cause
`/share/<uuid>` URLs hit `/api/organizations/{org}/chat_conversations/{id}` (owner-only) → null.
Share pages actually load `/api/organizations/{org}/chat_snapshots/{id}?rendering_mode=messages&render_all_tools=true`.
Share pages have no `action-bar-copy` buttons, so the DOM fallback also fails.

## Worker setup
Workers run as Claude CLI subprocesses, not in-app Agent subagents:
`CLAUDE_CONFIG_DIR=~/.claude-essremodel claude -p ... --model opus`
Failover order: ~/.claude-tyler2 → ~/.claude-worker → ~/.claude-tylerhalltech. Never dknopp@roofbrosrestoration.com.
Worker output: `.opx/` (gitignored).

## Verified snapshot shape (live, 2026-09-29)
Top keys: uuid, conversation_uuid, snapshot_name, chat_messages, created_by, creator, project_uuid, is_public, working_documents.
No `name`, no `current_leaf_message_uuid`; every message has `parent_message_uuid`. `document.title` is just "Claude".

## Status
- [x] Issue opened (#2)
- [x] W1 (CLI, tyler@essremodel.com) implemented share route + chat_snapshots fetch
- [x] W2 (CLI) adversarial review: no P1; applied P2 + 401 / non-JSON / README fixes
- [x] Node harness (sanitized real snapshot structure): share export = 5 msgs in order, title from snapshot_name; 403 = clear error; /chat unchanged
- [ ] PR squash-merged, raw file on main shows 2026.09.29.1

## Next step
Merge the PR, then reinstall the userscript from main in Tampermonkey and export the share link.
