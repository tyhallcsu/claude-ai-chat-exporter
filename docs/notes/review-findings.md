# Worker review notes (preserved from local run logs)

Workers ran as Claude Code CLI processes. Their briefs and raw logs stay local and gitignored; below are their final reports.

## W2: review of the shared-chat diff (PR #3)

No P1 findings. The normal `/chat/<id>` path is unchanged: route detection, `fetchChatData` returning null into the DOM fallback, and the title logic all behave as before. The new flat-list branch doesn't catch normal chats because `tree=true` messages carry `parent_message_uuid`. Before this diff, a response without parent links exported only the last message, so the branch is an improvement. No leftover debug code.

**P2**
1. `claude-ai-chat-exporter.user.js:196`: `normalizeSnapshot` only looks for messages at `raw.chat_messages`, `snap.chat_messages` and `raw.messages`. It checks `raw.conversation` for the name and model but not for messages, and never checks `snap.messages`. If the real response nests messages under `{conversation:{chat_messages:[…]}}` or `{snapshot:{messages:[…]}}`, every share export fails with "Shared chat returned no messages." Also, if `chat_messages` comes back as a non-array (e.g. an object keyed by uuid), you get the same misleading error; a non-empty string would get past the empty check and break the export further on.
   Fix: `chat_messages: [raw?.chat_messages, snap.chat_messages, raw?.conversation?.chat_messages, snap.messages, raw?.messages].find(Array.isArray) ?? []`.

**P3**
2. `claude-ai-chat-exporter.user.js:177`: only 403 and 404 get the "No access… sign in" message. If the session has expired but the stale `lastActiveOrg` cookie is still there, the request likely returns 401 and shows the generic "Shared chat request failed (HTTP 401)". That doesn't match the README changelog's "clear error when your account has no access."
   Fix: add 401 to the access check: `[401, 403, 404].includes(res.status)`.
3. `claude-ai-chat-exporter.user.js:182`: `await res.json()` isn't guarded. A 200 response with an HTML body (a Cloudflare challenge or login interstitial) fails as "Export failed: Unexpected token '<'…".
   Fix: wrap it in try/catch and throw "Shared chat response was not JSON (possibly a login or bot check)."
4. `claude-ai-chat-exporter.user.js:118`: a bare `/share` or `/share/` URL gives a null route, so it falls to the DOM fallback and the old error "API unavailable and no copy buttons found on page." This is an edge case only.
   Fix: return `{kind:'share', id:null}` when the `share` segment is present, and have `fetchShareData` throw "No share id in URL."
5. `README.md:29`: "DOM fallback — if the API call fails… falls back to the classic copy-button" is now false for share routes, which throw on purpose.
   Fix: add "(chat pages only; shared chats have no copy buttons)".
6. `claude-ai-chat-exporter.user.js:437`: the share title fallback only strips a trailing " - Claude" or " | Claude". If the share page's document title is a generic label (e.g. "Shared chat - Claude"), that label becomes the filename. This can't be checked until the real page title is known.
   Fix: also reject titles matching `/^shared (chat|conversation)$/i`.

## W3: adversarial review of main (source of issues #9–#16)

I found 9 defects: two P1s and three P2s. I confirmed the first four and the `TEXTONLY` case (#8) by running a Node repro against the `main` script. The repro file is in my scratchpad as `t.js`; it loads the script with `eval` and replaces the `init` call so the functions are exported. The rest come from reading the code.

**P1-a — Script injection in HTML export via text that starts with `<pre`** — `claude-ai-chat-exporter.user.js:356`
- Input: a text block `<pre><img src=x onerror=alert(1)>`.
- Output: `<div class="body"><pre><img src=x onerror=alert(1)></div>`, which runs when the exported file is opened. Any block starting with `<pre` is passed through without escaping. Content from a shared chat is controlled by whoever wrote it.
- Fix: never trust `startsWith('<pre')`. Swap each fenced block for a placeholder token (e.g. `\u0000N\u0000`), escape everything else, then put the code blocks back.
- Repro: `buildHtml([{sender:'human',content:[{type:'text',text:'<pre><img src=x onerror=alert(1)>'}]}],{title:'t'})` contains `onerror=alert(1)` unescaped.

**P1-b — Script injection via text right after a code fence** — same line, 353–356
- Input: ``` "```\nx\n```\n<img src=x onerror=alert(2)>" ```
- Output: `…</code></pre>\n<img src=x onerror=alert(2)>`, unescaped. The code-fence replacement makes the chunk start with `<pre`, so the text after it in the same paragraph is emitted raw.
- Fix and repro: same as P1-a.

**P2 — Code blocks with blank lines break the HTML export** — 352–356
- Cause: the page is split on `\n{2,}` after the code-fence HTML has already been generated.
- Input: ``` "```py\na\n\nb\n```" ```
- Output: `<pre …><code>a` is never closed, followed by `<p>b<br>&lt;/code&gt;&lt;/pre&gt;</p>`. Everything after it stays inside an open `<pre>`, and the code is double-escaped. Tool results, attachments and code from users very often contain blank lines.
- Fix: the same placeholder approach as P1.
- Repro: assert that the output contains `</code></pre>` and not `&lt;/code&gt;`.

**P2 — Clipboard mode reports success even when the copy failed** — 465–470 and 616–619
- Cause: `copyToClipboard` can return `false` or a promise that resolves to `false`. `startExport` awaits it and ignores the value, so it always shows "Copied … to clipboard".
- Trigger: `navigator.clipboard.writeText` rejects with NotAllowedError, e.g. when the page isn't focused after using the userscript menu command. It also happens when `GM_setClipboard` is missing.
- Fix: `if (!(await copyToClipboard(content))) throw new Error('Clipboard write failed');`
- Repro: stub `GM_setClipboard` to throw and `navigator.clipboard.writeText` to reject; the status still says "Copied".

**P2 — DOM fallback shifts message text onto the wrong message when one copy is missed** — 415–429
- Cause: captured text is stored in arrival order and mapped back by position (`captures[i]`), not by message.
- Input: 3 groups; the copy for #2 times out after 1.8s.
- Output: message 2 gets #3's text, the last message is dropped, and senders no longer match their text. A late capture from the previous click also gets credited to the next message.
- Fix: record by index (`captures[i] = text` inside a per-item handler) and ignore anything that arrives after that item's deadline.
- Repro: fake groups whose `click()` calls `navigator.clipboard.writeText`, with one that never calls it.

**P3 — Attachment names are double-escaped** — 294 and 296
- Cause: `escapeHtml(name)` runs in the Markdown step, and the HTML step escapes again.
- Input: `file_name: 'a&b.txt'`
- Output: the HTML page shows `a&amp;b.txt` (source `a&amp;amp;b.txt`, confirmed), and the `.md` file contains `a&amp;b.txt`.
- Fix: drop `escapeHtml` in `renderMessageToMarkdown`.

**P3 — Project pages are mistaken for chats and give a misleading error** — 121–122
- Input: `/project/0198a1b2-…`
- Output: `{kind:'chat', id:<projectId>}` (confirmed). The API call returns 404, the script falls back to the DOM, and it fails with "API unavailable and no copy buttons found". `/new` and `/recents` produce the same misleading "API unavailable" error.
- Fix: only take the last-segment fallback when `parts[0]` isn't `project`, `new`, `recents` or similar; otherwise throw "Not on a chat page".

**P3 — Messages without a `content` array export as empty** — 265
- Input: a message with top-level `text` and no `content` array (older or snapshot shape, which `normalizeSnapshot` passes through as-is).
- Output: `""`, rendered as `*[empty]*` (confirmed). The message text is lost.
- Fix: `const parts = Array.isArray(msg.content) ? msg.content : (msg.text ? [{type:'text', text: msg.text}] : []);`

**P3 — Content containing ``` breaks the Markdown code blocks** — 279, 282 and 294
- Input: a tool result or attachment whose content includes ```` ``` ````.
- Output: the code block ends early; everything after it renders as Markdown and pairs up with the wrong fences (in both Markdown and HTML).
- Fix: fence with one more backtick than the longest backtick run in the content.

Also checked, with nothing found:
- **XSS elsewhere:** titles, the code language tag and the source link's `href` are escaped (the `href` is always `location.href`).
- **Duplicate UI:** the button is guarded by its id and `init` runs once, so SPA navigation doesn't add a second one.
- **Route reading:** the route is read at export time, so navigating without a reload is fine. Query strings aren't in `pathname`, and trailing path segments after `/chat/<id>` resolve correctly.
- **Non-JSON responses:** a chat response that isn't JSON (e.g. a bot-check page) is caught and falls back to the DOM.

