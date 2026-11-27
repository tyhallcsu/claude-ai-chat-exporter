# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions use the
script's `YYYY.MM.DD.N` scheme and are tagged as `vYYYY.MM.DD.N`.

## [2026.09.30.1] - 2026-09-30

### Added
- Usage tracker (#31).
  - Shows session and weekly usage limits (including model-specific weekly limits), with the percent used and time until reset.
  - Appears inline under the chat composer and in the options panel. It's on by default, and each placement can be turned off.
  - Refreshes on load, when the tab becomes visible, every 5 minutes and after each export; a manual refresh button is included.
  - A failed usage lookup hides the tracker and never affects exports.
- Regression tests for the usage tracker (38 tests total).

## [2026.09.29.3] - 2026-09-29

### Added
- Options panel credits the author (by sharmanhall, linking to the Greasy Fork profile) and links to Greasy Fork, GitHub and the issue tracker (#8).
- Greasy Fork listing text kept in the repo as `greasyfork.md` (#7).

### Changed
- Refreshed Export button, options panel and status toast.
  - Segmented format picker, toggle switches, and a close button.
  - Escape or an outside click closes the panel.
  - Busy state while exporting, and a light theme.
  - Focus outlines and ARIA roles; reduced-motion support.

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

[2026.09.30.1]: https://github.com/tyhallcsu/claude-ai-chat-exporter/compare/v2026.09.29.3...v2026.09.30.1
[2026.09.29.3]: https://github.com/tyhallcsu/claude-ai-chat-exporter/compare/v2026.09.29.2...v2026.09.29.3
[2026.09.29.2]: https://github.com/tyhallcsu/claude-ai-chat-exporter/compare/v2026.09.29.1...v2026.09.29.2
[2026.09.29.1]: https://github.com/tyhallcsu/claude-ai-chat-exporter/compare/v2026.04.22.1...v2026.09.29.1
[2026.04.22.1]: https://github.com/tyhallcsu/claude-ai-chat-exporter/releases/tag/v2026.04.22.1
