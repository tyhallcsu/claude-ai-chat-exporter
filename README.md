<div align="center">

<img src="assets/repository-banner.jpg" alt="Claude AI Chat Exporter — layered message cards flowing into Markdown, JSON, and HTML files" width="1200">

# Claude AI Chat Exporter

**Keep a readable copy of the conversation. Choose the format that fits your next step.**

[![JavaScript](https://img.shields.io/badge/JavaScript-Userscript-f7df1e?style=flat-square&logo=javascript&logoColor=black)](claude-ai-chat-exporter.user.js) [![Formats](https://img.shields.io/badge/Export-MD_·_JSON_·_HTML-c56b45?style=flat-square)](#output-format) [![License: MIT](https://img.shields.io/badge/License-MIT-48443e?style=flat-square)](LICENSE)

[Install](#install) · [Usage](#usage) · [Preview](#export-preview) · [Options](#options) · [Limitations](#limitations-and-privacy)

</div>

A Tampermonkey / Violentmonkey / Greasemonkey userscript that exports Claude AI conversations from [claude.ai](https://claude.ai) to **Markdown**, **JSON**, or **HTML**.

Author: [sharmanhall](https://greasyfork.org/en/users/866731-sharmanhall). Mirrors and source live in this GitHub repo; the script is published on Greasy Fork at [claude-ai-chat-exporter](https://greasyfork.org/en/scripts/574914-claude-ai-chat-exporter).

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

## Export preview

![Actual HTML export from two synthetic messages about a balcony herb garden](assets/demo-export.png)

**Demonstration:** this is the unchanged script's HTML output, rendered from two synthetic messages. It is not a screenshot of a real Claude conversation. [Open the generated HTML source](assets/demo-export.html).

## Output format

### Markdown
````markdown
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
````

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
| Include attachments | ✅ | Attachment names and available extracted text; no original-file download |
| Include timestamps | ✅ | Show `created_at` in message headings |
| Copy to clipboard | ❌ | Skip the download and copy the output instead |

Options persist across sessions via `GM_setValue`.

The thinking, tool, and attachment toggles affect Markdown and HTML rendering. **JSON retains the active thread's raw content and attachment fields even when those toggles are off.** Its structured timestamps are retained too.

## Limitations and privacy

- The API request uses your existing signed-in browser session on the current Claude origin. This script contains no external upload endpoint; output is downloaded locally or copied to the clipboard. Treat exported files as private conversation data.
- Claude's internal API, organization cookie, and page selectors may change. An API-first implementation is not a guarantee of compatibility with every current account or interface.
- The DOM fallback captures copyable messages present on the page. Unloaded messages and rich API metadata may be missing. If a copy action times out, review the exported text and sender order before relying on the result.
- Attachments are represented by names and available extracted content. Image content becomes an `[image]` placeholder; original images and uploaded files are not bundled.
- HTML is a standalone styled document with a minimal renderer, not a full Markdown engine or a reproduction of Claude's interface.
- If export fails, confirm you are on a conversation page, signed in, and the userscript is enabled for the page. If clipboard output is unavailable, turn off **Copy to clipboard** and try downloading. The current clipboard path may report success even when a browser write fails; verify the actual paste.

This is an independent userscript, not an official Anthropic export tool. No private account access is needed to inspect the source or view the synthetic preview.

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
