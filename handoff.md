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

## Status
- [x] Issue opened (#2)
- [x] Branch + handoff created
- [ ] W1: implement fix in `claude-ai-chat-exporter.user.js`
- [ ] Verify snapshot response shape in Tyler's Chrome (in-app browser account gets 403)
- [ ] W2: adversarial review
- [ ] PR, squash-merge, verify raw file on main

## Next step
Dispatch W1.
