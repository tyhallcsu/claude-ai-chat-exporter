# Claude AI Chat Exporter

A Tampermonkey / Violentmonkey / Greasemonkey userscript that exports Claude AI conversations from [claude.ai](https://claude.ai) to **Markdown**, **JSON**, or **HTML**.

Fork of [sharmanhall/claude-ai-chat-exporter](https://greasyfork.org/en/scripts/574914-claude-ai-chat-exporter) with a rewritten extraction pipeline, rich content support, and a settings panel.

## Install

- **Greasy Fork:** <https://greasyfork.org/en/scripts/574914-claude-ai-chat-exporter>
- **GitHub raw (direct):** [claude-ai-chat-exporter.user.js](https://github.com/tyhallcsu/claude-ai-chat-exporter/raw/main/claude-ai-chat-exporter.user.js)

Open either link in a browser with [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey / Greasemonkey) installed and confirm the install prompt.

## Features

- **API-first extraction** — reads the conversation directly from Claude's internal API instead of clicking each copy button. Much faster and more reliable.
- **DOM fallback** — if the API call fails (auth change, new endpoint), falls back to the classic copy-button + clipboard interception flow.
- **Branched threads** — walks from the current leaf through `parent_message_uuid` so you get only the active thread, not every branch from edited messages.
- **Rich content types** — renders `text`, `thinking`, `tool_use`, `tool_result`, and attachments.
- **Three formats** — Markdown (default), JSON (full structured dump), HTML (standalone styled page).
- **Settings panel** — toggle thinking blocks, tool calls, attachments, timestamps, and clipboard-vs-download.
- **Keyboard shortcut** — `Alt+Shift+E` triggers an export with the current format.
- **Menu commands** — per-format export entries in the userscript manager menu.
- **Safe clipboard patching** — the DOM fallback always restores `navigator.clipboard.writeText` in `finally`, so nothing leaks if export fails mid-flight.

## Usage

1. Open any conversation at `https://claude.ai/chat/<id>`.
2. Click the **Export** button in the bottom-right corner, or press `Alt+Shift+E`.
3. Click the **⚙** gear to open the options panel and change format / toggles.

## Output format

### Markdown
```markdown
# My Conversation Title

- **Exported:** 2026-04-22T...
- **Exporter:** Claude AI Chat Exporter v2026.04.22.1
- **Source:** https://claude.ai/chat/...

---

## Human — Apr 22, 2026, 9:15 PM

Hello Claude...

---

## Claude — Apr 22, 2026, 9:15 PM

> **[thinking]**
>
> > The user is asking...

Here's my response.

**→ tool_use: `web_search`**

```json
{ "query": "..." }
```
```

### JSON
Full structured dump including message UUIDs, timestamps, and raw `content` parts — useful for downstream processing.

### HTML
Standalone single-file HTML page with light/dark styling.

## Options

| Option | Default | Description |
| --- | --- | --- |
| Format | Markdown | Output format |
| Include thinking blocks | ✅ | Extended thinking content |
| Include tool use / results | ✅ | `tool_use` and `tool_result` blocks |
| Include attachments | ✅ | Uploaded files / images |
| Include timestamps | ✅ | Show `created_at` in message headings |
| Copy to clipboard | ❌ | Skip the download and copy the output instead |

Options persist across sessions via `GM_setValue`.

## Changelog

### 2026.04.22.1
- Rewrite: API-first extraction with DOM fallback.
- Add JSON and HTML export formats.
- Support `thinking`, `tool_use`, `tool_result`, attachments.
- Follow branched threads via `current_leaf_message_uuid`.
- Add settings panel and `Alt+Shift+E` shortcut.
- Guarantee clipboard patch is restored on failure.

## License

MIT — see [LICENSE](LICENSE).

Originally based on v2026.04.21.2 by [sharmanhall](https://greasyfork.org/en/users/866731-sharmanhall).
