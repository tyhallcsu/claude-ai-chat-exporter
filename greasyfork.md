# Claude AI Chat Exporter

Export Claude conversations, including **chats shared with you**, to **Markdown, JSON, or HTML** with one click.

by [sharmanhall](https://greasyfork.org/en/users/866731-sharmanhall) · Source and issues: [GitHub](https://github.com/tyhallcsu/claude-ai-chat-exporter)

## Features

- **Your chats and shared chats.** Works on `claude.ai/chat/<id>` and on `claude.ai/share/<id>` links that were shared with your account.
- **API-first extraction.** Reads the same conversation data the Claude web app uses, so the export includes the full active thread rather than just what's visible on screen.
- **Three formats:** Markdown (`.md`), JSON (`.json`) and standalone HTML (`.html`, with all message text safely escaped).
- **Rich content:** thinking blocks, tool calls and results, attachments, and timestamps. Each one can be switched on or off.
- **Branched threads.** Follows the branch you're currently viewing.
- **Copy instead of download.** Optionally puts the export on your clipboard.
- **Fallback.** On your own chats, falls back to Claude's copy buttons if the API is unavailable.

## Usage

1. Open a Claude chat or a shared chat link.
2. Click **Export** (bottom-right), press **Alt+Shift+E**, or use the userscript menu.
3. Click **⚙** to choose the format and options.

Shared chats export only when your signed-in account has access to them. Otherwise the script says so clearly.

## Privacy

Everything runs in your browser. The script only calls claude.ai's own API with your existing session and sends nothing anywhere else.

## Changelog

Full history: [CHANGELOG.md](https://github.com/tyhallcsu/claude-ai-chat-exporter/blob/main/CHANGELOG.md) · [Releases](https://github.com/tyhallcsu/claude-ai-chat-exporter/releases)

- **2026.09.29.3**: refreshed options panel with author credit and links.
- **2026.09.29.2**: safer HTML export, plus fixes for code blocks, clipboard reporting, the DOM fallback, attachment names and non-chat pages.
- **2026.09.29.1**: export shared chats (`claude.ai/share/<id>`).
- **2026.04.22.1**: rewrite with API-first extraction, JSON/HTML formats, thinking/tool/attachment support, and an options panel.
