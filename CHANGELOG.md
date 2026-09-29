# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions use the
script's `YYYY.MM.DD.N` scheme and are tagged as `vYYYY.MM.DD.N`.

## [2026.09.29.2] - 2026-09-29

### Fixed
- HTML export escapes all message text; raw HTML can no longer pass through into the exported page (#9).
- HTML export keeps fenced code blocks intact when they contain blank lines (#10).
- Clipboard mode reports an error when the copy fails instead of claiming success (#11).
- DOM fallback maps copied text to the right message when a copy times out (#12).
- Attachment names are no longer HTML-escaped in Markdown output (#13).
- Project and other non-chat pages show "Open a chat or shared chat to export" instead of a misleading API error (#14).
- Messages that carry only a top-level `text` field are exported instead of showing as empty (#15).
- Code fences grow to fit content that itself contains triple backticks (#16).

### Added
- Options panel shows author credit (by sharmanhall) with links to Greasy Fork and GitHub, and has refreshed styling (#8).
- `CHANGELOG.md`, version tags and GitHub Releases (#17).
- Node regression tests (`npm test`).

## [2026.09.29.1] - 2026-09-29

### Added
- Export shared chats (`claude.ai/share/<id>`) via the snapshot API, with a clear error when your account has no access (#2).

## [2026.04.22.1] - 2026-04-22

### Changed
- Rewrite: API-first extraction with DOM fallback.

### Added
- JSON and HTML export formats.
- `thinking`, `tool_use`, `tool_result` and attachment support.
- Branched threads followed via `current_leaf_message_uuid`.
- Settings panel and `Alt+Shift+E` shortcut.

### Fixed
- Clipboard patch is always restored on failure.

[2026.09.29.2]: https://github.com/tyhallcsu/claude-ai-chat-exporter/compare/v2026.09.29.1...v2026.09.29.2
[2026.09.29.1]: https://github.com/tyhallcsu/claude-ai-chat-exporter/compare/v2026.04.22.1...v2026.09.29.1
[2026.04.22.1]: https://github.com/tyhallcsu/claude-ai-chat-exporter/releases/tag/v2026.04.22.1
