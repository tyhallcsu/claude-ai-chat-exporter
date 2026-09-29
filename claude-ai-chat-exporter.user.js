// ==UserScript==
// @name         Claude AI Chat Exporter
// @namespace    https://github.com/tyhallcsu/claude-ai-chat-exporter
// @version      2026.09.29.3
// @description  Export Claude AI conversations to Markdown, JSON, or HTML. API-first with DOM fallback; supports thinking blocks, tool use, attachments, and branched threads.
// @author       sharmanhall
// @homepageURL  https://github.com/tyhallcsu/claude-ai-chat-exporter
// @supportURL   https://github.com/tyhallcsu/claude-ai-chat-exporter/issues
// @match        https://claude.ai/*
// @match        https://app.claude.ai/*
// @icon         https://claude.ai/favicon.ico
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '2026.09.29.3';

  const DEFAULTS = {
    format: 'markdown',      // 'markdown' | 'json' | 'html'
    includeThinking: true,
    includeToolUse: true,
    includeAttachments: true,
    includeTimestamps: true,
    copyInsteadOfDownload: false,
  };

  const SELECTORS = {
    copyButton: 'button[data-testid="action-bar-copy"]',
    conversationTitle:
      '[data-testid="chat-title-button"] .truncate, button[data-testid="chat-title-button"] div.truncate',
    messageActionsGroup: '[role="group"][aria-label="Message actions"]',
    feedbackButton: 'button[aria-label="Give positive feedback"]',
  };

  const STATE = { isExporting: false };

  const prefs = loadPrefs();

  // ---------- storage ----------

  function loadPrefs() {
    const out = { ...DEFAULTS };
    try {
      for (const key of Object.keys(DEFAULTS)) {
        const v = GM_getValue(key, undefined);
        if (v !== undefined) out[key] = v;
      }
    } catch {}
    return out;
  }

  function savePref(key, value) {
    prefs[key] = value;
    try { GM_setValue(key, value); } catch {}
  }

  // ---------- utilities ----------

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function sanitizeFilename(name) {
    return (name || 'claude_conversation')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'claude_conversation';
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTimestamp(iso) {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    } catch { return null; }
  }

  function datestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function notify(text, title = 'Claude Exporter') {
    try {
      if (typeof GM_notification === 'function') {
        GM_notification({ title, text, timeout: 3500 });
      }
    } catch {}
    console.log(`[Claude Exporter] ${text}`);
  }

  // ---------- API fetch ----------

  // Returns { kind: 'chat' | 'share', id } or null.
  function getRouteFromUrl() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const shareIdx = parts.indexOf('share');
    if (shareIdx >= 0 && parts[shareIdx + 1]) return { kind: 'share', id: parts[shareIdx + 1] };
    const idx = parts.indexOf('chat');
    if (idx >= 0 && parts[idx + 1]) return { kind: 'chat', id: parts[idx + 1] };
    // Bare /<uuid> only; /project/<uuid> etc. are not chats.
    return parts.length === 1 && /^[0-9a-f-]{16,}$/i.test(parts[0])
      ? { kind: 'chat', id: parts[0] } : null;
  }

  function getOrgIdFromCookie() {
    return document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1] ?? null;
  }

  async function fetchConversationData() {
    const route = getRouteFromUrl();
    if (!route) return null;
    return route.kind === 'share' ? fetchShareData(route.id) : fetchChatData(route.id);
  }

  async function apiFetch(url) {
    return fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async function fetchChatData(conversationId) {
    const orgId = getOrgIdFromCookie();
    if (!orgId) return null;

    const url = `/api/organizations/${orgId}/chat_conversations/${conversationId}` +
      `?tree=true&rendering_mode=messages&render_all_tools=true`;

    try {
      const res = await apiFetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('[Claude Exporter] API fetch failed:', e);
      return null;
    }
  }

  // Shared chats (claude.ai/share/<id>) are served as snapshots. Errors are
  // thrown rather than returned as null: share pages have no copy buttons, so
  // the DOM fallback cannot help.
  async function fetchShareData(shareId) {
    const orgId = getOrgIdFromCookie();
    if (!orgId) {
      throw new Error('No Claude organization found (lastActiveOrg cookie missing). Sign in to claude.ai and reload this shared chat.');
    }

    const url = `/api/organizations/${orgId}/chat_snapshots/${shareId}` +
      `?rendering_mode=messages&render_all_tools=true`;

    let res;
    try {
      res = await apiFetch(url);
    } catch (e) {
      throw new Error(`Could not reach the Claude API for this shared chat (${e.message}).`);
    }
    if ([401, 403, 404].includes(res.status)) {
      throw new Error(`No access to this shared chat (HTTP ${res.status}). Open it while signed in to an account it was shared with.`);
    }
    if (!res.ok) throw new Error(`Shared chat request failed (HTTP ${res.status}).`);

    let raw;
    try {
      raw = await res.json();
    } catch {
      throw new Error('Shared chat response was not JSON (possibly a login or bot check). Reload and try again.');
    }
    const data = normalizeSnapshot(raw, shareId);
    if (!data.chat_messages.length) throw new Error('Shared chat returned no messages.');
    return data;
  }

  // Snapshot response shape is not documented; map it onto the conversation
  // shape used by buildActiveThread / resolveTitle / buildJson.
  function normalizeSnapshot(raw, shareId) {
    const snap = raw?.snapshot ?? {};
    return {
      ...raw,
      uuid: raw?.uuid ?? snap.uuid ?? shareId,
      name: raw?.name ?? raw?.snapshot_name ?? raw?.conversation?.name ?? snap.name ?? null,
      model: raw?.model ?? snap.model ?? raw?.conversation?.model ?? null,
      chat_messages: [raw?.chat_messages, snap.chat_messages, raw?.conversation?.chat_messages,
        snap.messages, raw?.messages].find(Array.isArray) ?? [],
      current_leaf_message_uuid: raw?.current_leaf_message_uuid
        ?? snap.current_leaf_message_uuid ?? null,
    };
  }

  // ---------- thread walk ----------

  // Claude conversations are trees (editing a message creates a new branch).
  // Walk from the current leaf back through parent_message_uuid to get the
  // active thread only, then reverse for chronological order.
  function buildActiveThread(data) {
    const messages = data?.chat_messages ?? [];
    if (!messages.length) return [];

    // Flat lists (no parent links) have no branches to resolve; keep order.
    if (!messages.some((m) => m.parent_message_uuid)) {
      return [...messages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    }

    const byUuid = new Map(messages.map((m) => [m.uuid, m]));
    const leafId = data.current_leaf_message_uuid
      ?? findLeafByLatest(messages);

    const ordered = [];
    const seen = new Set();
    let cursor = byUuid.get(leafId) ?? messages[messages.length - 1];

    while (cursor && !seen.has(cursor.uuid)) {
      seen.add(cursor.uuid);
      ordered.push(cursor);
      cursor = cursor.parent_message_uuid ? byUuid.get(cursor.parent_message_uuid) : null;
    }
    return ordered.reverse();
  }

  function findLeafByLatest(messages) {
    const parented = new Set(
      messages.map((m) => m.parent_message_uuid).filter(Boolean),
    );
    const leaves = messages.filter((m) => !parented.has(m.uuid));
    leaves.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return leaves[0]?.uuid ?? messages[messages.length - 1]?.uuid;
  }

  // ---------- content rendering ----------

  // Fence longer than any backtick run inside body, so content can't close it early.
  function fence(body, lang = '') {
    const runs = String(body).match(/`+/g) ?? [];
    const marker = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
    return `${marker}${lang}\n${body}\n${marker}`;
  }

  function stringifyToolInput(input) {
    if (input == null) return '';
    try { return JSON.stringify(input, null, 2); } catch { return String(input); }
  }

  function toolResultText(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    if (Array.isArray(result)) {
      return result.map((p) => p?.text ?? stringifyToolInput(p)).join('\n').trim();
    }
    return stringifyToolInput(result);
  }

  function renderMessageToMarkdown(msg) {
    const parts = Array.isArray(msg.content) ? msg.content
      : typeof msg.text === 'string' ? [{ type: 'text', text: msg.text }] : [];
    const out = [];

    for (const p of parts) {
      const type = p?.type;

      if (type === 'text' && p.text) {
        out.push(p.text.trim());
      } else if (type === 'thinking' && prefs.includeThinking) {
        const t = (p.thinking ?? p.text ?? '').trim();
        if (t) out.push(`> **[thinking]**\n>\n${t.split('\n').map((l) => `> ${l}`).join('\n')}`);
      } else if (type === 'tool_use' && prefs.includeToolUse) {
        const name = p.name ?? 'tool';
        const input = stringifyToolInput(p.input);
        out.push(`**→ tool_use: \`${name}\`**\n\n${fence(input, 'json')}`);
      } else if (type === 'tool_result' && prefs.includeToolUse) {
        const body = toolResultText(p.content ?? p.text);
        if (body) out.push(`**← tool_result${p.is_error ? ' (error)' : ''}**\n\n${fence(body)}`);
      } else if (type === 'image') {
        out.push('*[image]*');
      }
    }

    if (prefs.includeAttachments) {
      const atts = [...(msg.attachments ?? []), ...(msg.files_v2 ?? [])];
      for (const att of atts) {
        const name = att.file_name ?? att.name ?? 'attachment';
        const content = att.extracted_content ?? att.content ?? '';
        if (content) {
          out.push(`**📎 attachment: ${name}**\n\n${fence(content)}`);
        } else {
          out.push(`**📎 attachment: ${name}**`);
        }
      }
    }

    return out.join('\n\n').trim();
  }

  function buildMarkdown(thread, meta) {
    const header = [
      `# ${meta.title}`,
      '',
      `- **Exported:** ${new Date().toISOString()}`,
      `- **Exporter:** Claude AI Chat Exporter v${VERSION}`,
      meta.url ? `- **Source:** ${meta.url}` : null,
      '',
      '---',
      '',
    ].filter((l) => l !== null).join('\n');

    const body = thread.map((msg) => {
      const sender = msg.sender === 'human' ? 'Human' : 'Claude';
      const ts = prefs.includeTimestamps ? formatTimestamp(msg.created_at) : null;
      const heading = ts ? `## ${sender} — ${ts}` : `## ${sender}`;
      const content = renderMessageToMarkdown(msg);
      return `${heading}\n\n${content || '*[empty]*'}\n`;
    }).join('\n---\n\n');

    return `${header}${body}`;
  }

  function buildJson(thread, meta, data) {
    return JSON.stringify({
      exporter: { name: 'claude-ai-chat-exporter', version: VERSION },
      exported_at: new Date().toISOString(),
      source_url: meta.url,
      title: meta.title,
      conversation_id: data?.uuid ?? null,
      model: data?.model ?? null,
      messages: thread.map((m) => ({
        uuid: m.uuid,
        sender: m.sender,
        created_at: m.created_at,
        content: m.content,
        attachments: m.attachments ?? [],
        files: m.files_v2 ?? [],
      })),
    }, null, 2);
  }

  // Minimal md→html: fenced code + paragraphs. Code blocks become placeholder
  // tokens first so blank lines inside them survive the paragraph split; all
  // remaining text goes through escapeHtml.
  function markdownToHtml(md) {
    const blocks = [];
    const tokenized = String(md).replace(/\u0000/g, '')
      .replace(/(^|\n)(`{3,})([^\n`]*)\n([\s\S]*?)\n\2(?=\n|$)/g, (_, lead, _f, lang, code) => {
        blocks.push(`<pre class="code" data-lang="${escapeHtml(lang.trim())}"><code>${escapeHtml(code)}</code></pre>`);
        return `${lead}\n\n\u0000CODE${blocks.length - 1}\u0000\n\n`;
      });
    return tokenized
      .split(/\n{2,}/)
      .filter((b) => b.trim())
      .map((b) => {
        const m = b.trim().match(/^\u0000CODE(\d+)\u0000$/);
        return m ? blocks[Number(m[1])] : `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>`;
      })
      .join('\n');
  }

  function buildHtml(thread, meta) {
    const rows = thread.map((msg) => {
      const sender = msg.sender === 'human' ? 'Human' : 'Claude';
      const ts = prefs.includeTimestamps ? formatTimestamp(msg.created_at) : '';
      const html = markdownToHtml(renderMessageToMarkdown(msg));
      return `<section class="msg ${sender.toLowerCase()}">
  <header><span class="who">${sender}</span>${ts ? `<span class="ts">${escapeHtml(ts)}</span>` : ''}</header>
  <div class="body">${html}</div>
</section>`;
    }).join('\n');

    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${escapeHtml(meta.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; }
  h1 { margin: 0 0 .25rem; }
  .meta { color: #888; font-size: 13px; margin-bottom: 2rem; }
  .msg { border: 1px solid color-mix(in srgb, currentColor 15%, transparent); border-radius: 12px; padding: 1rem 1.25rem; margin: 0 0 1rem; }
  .msg.human { background: color-mix(in srgb, currentColor 4%, transparent); }
  .msg header { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: .5rem; }
  .msg .ts { font-weight: 400; color: #888; font-size: 12px; }
  .msg p { margin: 0 0 .75rem; white-space: pre-wrap; }
  pre.code { background: #0b1020; color: #d6deeb; padding: .9rem 1rem; border-radius: 8px; overflow-x: auto; font: 12.5px/1.5 ui-monospace,Menlo,monospace; }
  @media (prefers-color-scheme: dark) { body { background: #0f1115; color: #e6e6e6; } }
</style>
<h1>${escapeHtml(meta.title)}</h1>
<div class="meta">Exported ${escapeHtml(new Date().toLocaleString())} · Claude AI Chat Exporter v${VERSION}${meta.url ? ` · <a href="${escapeHtml(meta.url)}">source</a>` : ''}</div>
${rows}
`;
  }

  // ---------- DOM fallback (clipboard interception) ----------

  function getDomMessageGroups() {
    return Array.from(document.querySelectorAll(SELECTORS.messageActionsGroup))
      .map((group, index) => {
        const hasFeedback = !!group.querySelector(SELECTORS.feedbackButton);
        const copyBtn = group.querySelector(SELECTORS.copyButton);
        return { index, type: hasFeedback ? 'assistant' : 'human', copyBtn };
      })
      .filter((item) => item.copyBtn);
  }

  async function extractViaDomFallback(statusDiv) {
    const items = getDomMessageGroups();
    if (!items.length) throw new Error('API unavailable and no copy buttons found on page.');

    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API unavailable — cannot use DOM fallback.');
    }

    // Captures are keyed by item index; writes outside the active item's
    // window are dropped, so a missed copy can't shift later messages.
    const captures = new Array(items.length).fill('');
    let active = -1;
    const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text) => {
      if (active >= 0 && !captures[active] && typeof text === 'string' && text.trim()) {
        captures[active] = text;
      }
    };

    try {
      for (let i = 0; i < items.length; i++) {
        statusDiv.textContent = `Fallback export ${i + 1}/${items.length}...`;
        active = i;
        items[i].copyBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
        items[i].copyBtn.click();
        const deadline = Date.now() + 1800;
        while (!captures[i] && Date.now() < deadline) await delay(60);
        active = -1;
      }
    } finally {
      active = -1;
      navigator.clipboard.writeText = origWrite;
    }

    return items.map((it, i) => ({
      sender: it.type === 'assistant' ? 'assistant' : 'human',
      created_at: null,
      content: [{ type: 'text', text: captures[i] }],
    })).filter((m) => m.content[0].text);
  }

  // ---------- title resolution ----------

  function resolveTitle(data) {
    const apiTitle = data?.name?.trim();
    if (apiTitle && !/^new conversation$/i.test(apiTitle)) return apiTitle;

    const el = document.querySelector(SELECTORS.conversationTitle);
    const dom = el?.textContent?.trim();
    if (dom && dom !== 'Claude' && !/new conversation/i.test(dom)) return dom;

    if (getRouteFromUrl()?.kind === 'share') {
      const docTitle = document.title.replace(/\s*[-|]\s*Claude\s*$/i, '').trim();
      if (docTitle && docTitle !== 'Claude') return docTitle;
    }

    return 'Claude conversation';
  }

  // ---------- output ----------

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function copyToClipboard(text) {
    try { GM_setClipboard(text, 'text'); return true; }
    catch { /* no-op */ }
    try { return navigator.clipboard.writeText(text).then(() => true).catch(() => false); }
    catch { return false; }
  }

  // ---------- UI ----------

  const IDS = {
    button: 'tyhallcsu-claude-exporter-button',
    panel: 'tyhallcsu-claude-exporter-panel',
    status: 'tyhallcsu-claude-exporter-status',
    style: 'tyhallcsu-claude-exporter-style',
  };

  const LINKS = {
    author: 'https://greasyfork.org/en/users/866731-sharmanhall',
    greasyFork: 'https://greasyfork.org/en/scripts/574914-claude-ai-chat-exporter',
    github: 'https://github.com/tyhallcsu/claude-ai-chat-exporter',
    issues: 'https://github.com/tyhallcsu/claude-ai-chat-exporter/issues',
  };

  const FORMATS = [
    { value: 'markdown', label: 'Markdown' },
    { value: 'json', label: 'JSON' },
    { value: 'html', label: 'HTML' },
  ];

  const TOGGLES = [
    ['includeThinking', 'Include thinking blocks'],
    ['includeToolUse', 'Include tool use / results'],
    ['includeAttachments', 'Include attachments'],
    ['includeTimestamps', 'Include timestamps'],
    ['copyInsteadOfDownload', 'Copy to clipboard (no download)'],
  ];

  // Static stylesheet: no interpolated values. Scoped under our element ids.
  const CSS = `
#tyhallcsu-claude-exporter-button, #tyhallcsu-claude-exporter-panel, #tyhallcsu-claude-exporter-status {
  --tce-bg: #0f172a; --tce-fg: #e2e8f0; --tce-muted: #94a3b8; --tce-border: rgba(148,163,184,.22);
  --tce-surface: #1e293b; --tce-accent: #d97757; --tce-accent-fg: #fff; --tce-focus: #60a5fa;
  --tce-ok: #15803d; --tce-err: #b91c1c; --tce-info: #1d4ed8;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; box-sizing: border-box;
}
#tyhallcsu-claude-exporter-button *, #tyhallcsu-claude-exporter-panel * { box-sizing: border-box; }
#tyhallcsu-claude-exporter-button {
  position: fixed; bottom: 18px; right: 18px; z-index: 2147483647; display: flex; gap: 6px;
}
#tyhallcsu-claude-exporter-button .tce-fab {
  display: inline-flex; align-items: center; gap: 7px; padding: 10px 16px; border: 1px solid var(--tce-border);
  border-radius: 999px; background: var(--tce-bg); color: var(--tce-fg); font: 600 13px system-ui, sans-serif;
  cursor: pointer; box-shadow: 0 10px 25px rgba(0,0,0,.25); transition: background .15s, transform .15s, opacity .15s;
}
#tyhallcsu-claude-exporter-button .tce-fab:hover:not(:disabled) { background: var(--tce-surface); transform: translateY(-1px); }
#tyhallcsu-claude-exporter-button .tce-fab:disabled { opacity: .7; cursor: progress; }
#tyhallcsu-claude-exporter-button .tce-fab svg { width: 15px; height: 15px; flex: none; }
#tyhallcsu-claude-exporter-button .tce-gear { padding: 10px 12px; }
#tyhallcsu-claude-exporter-panel {
  position: fixed; bottom: 70px; right: 18px; z-index: 2147483647; width: 290px; max-width: calc(100vw - 36px);
  background: var(--tce-bg); color: var(--tce-fg); border: 1px solid var(--tce-border); border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0,0,0,.4); padding: 14px 16px 12px; animation: tce-in .14s ease-out;
}
#tyhallcsu-claude-exporter-panel .tce-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
#tyhallcsu-claude-exporter-panel .tce-title { margin: 0; font-size: 14px; font-weight: 700; }
#tyhallcsu-claude-exporter-panel .tce-ver { margin-left: 6px; font-size: 11px; font-weight: 500; color: var(--tce-muted); }
#tyhallcsu-claude-exporter-panel .tce-sub { margin-top: 2px; font-size: 12px; color: var(--tce-muted); }
#tyhallcsu-claude-exporter-panel a { color: var(--tce-accent); text-decoration: none; border-radius: 3px; }
#tyhallcsu-claude-exporter-panel a:hover { text-decoration: underline; }
#tyhallcsu-claude-exporter-panel .tce-close {
  width: 26px; height: 26px; border: none; border-radius: 6px; background: transparent; color: var(--tce-muted);
  font-size: 18px; line-height: 1; cursor: pointer;
}
#tyhallcsu-claude-exporter-panel .tce-close:hover { background: var(--tce-surface); color: var(--tce-fg); }
#tyhallcsu-claude-exporter-panel .tce-label { margin: 14px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--tce-muted); }
#tyhallcsu-claude-exporter-panel .tce-seg { display: flex; padding: 3px; gap: 3px; border: 1px solid var(--tce-border); border-radius: 9px; background: var(--tce-surface); }
#tyhallcsu-claude-exporter-panel .tce-seg button {
  flex: 1; padding: 6px 0; border: none; border-radius: 6px; background: transparent; color: var(--tce-fg);
  font: 600 12px system-ui, sans-serif; cursor: pointer; transition: background .15s;
}
#tyhallcsu-claude-exporter-panel .tce-seg button[aria-checked="true"] { background: var(--tce-accent); color: var(--tce-accent-fg); }
#tyhallcsu-claude-exporter-panel .tce-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 5px 0; cursor: pointer; }
#tyhallcsu-claude-exporter-panel .tce-switch {
  appearance: none; -webkit-appearance: none; position: relative; flex: none; width: 32px; height: 18px; margin: 0;
  border-radius: 999px; background: #475569; cursor: pointer; transition: background .15s;
}
#tyhallcsu-claude-exporter-panel .tce-switch::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: #fff; transition: transform .15s;
}
#tyhallcsu-claude-exporter-panel .tce-switch:checked { background: var(--tce-accent); }
#tyhallcsu-claude-exporter-panel .tce-switch:checked::after { transform: translateX(14px); }
#tyhallcsu-claude-exporter-panel .tce-foot {
  display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 12px; padding-top: 10px;
  border-top: 1px solid var(--tce-border); font-size: 12px;
}
#tyhallcsu-claude-exporter-panel .tce-hint { margin-left: auto; color: var(--tce-muted); font-size: 11px; }
#tyhallcsu-claude-exporter-button :focus-visible, #tyhallcsu-claude-exporter-panel :focus-visible {
  outline: 2px solid var(--tce-focus); outline-offset: 2px;
}
#tyhallcsu-claude-exporter-status {
  position: fixed; top: 12px; right: 12px; z-index: 2147483647; max-width: 360px; padding: 10px 14px;
  border-radius: 10px; background: var(--tce-info); color: #fff; font: 12px/1.45 ui-monospace, Menlo, monospace;
  box-shadow: 0 10px 30px rgba(0,0,0,.25); animation: tce-in .14s ease-out;
}
#tyhallcsu-claude-exporter-status[data-state="success"] { background: var(--tce-ok); }
#tyhallcsu-claude-exporter-status[data-state="error"] { background: var(--tce-err); }
@keyframes tce-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-color-scheme: light) {
  #tyhallcsu-claude-exporter-button, #tyhallcsu-claude-exporter-panel {
    --tce-bg: #ffffff; --tce-fg: #0f172a; --tce-muted: #64748b; --tce-border: rgba(15,23,42,.14);
    --tce-surface: #f1f5f9; --tce-accent: #c15f3c; --tce-focus: #2563eb;
  }
  #tyhallcsu-claude-exporter-panel .tce-switch { background: #cbd5e1; }
  #tyhallcsu-claude-exporter-panel .tce-switch:checked { background: var(--tce-accent); }
}
@media (prefers-reduced-motion: reduce) {
  #tyhallcsu-claude-exporter-button *, #tyhallcsu-claude-exporter-panel, #tyhallcsu-claude-exporter-panel *,
  #tyhallcsu-claude-exporter-status, #tyhallcsu-claude-exporter-panel .tce-switch::after {
    transition: none !important; animation: none !important;
  }
  #tyhallcsu-claude-exporter-button .tce-fab:hover:not(:disabled) { transform: none; }
}
`;

  const EXPORT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';

  const ui = { exportBtn: null, exportLabel: null, closePanel: null };

  function ensureStyles() {
    if (document.getElementById(IDS.style)) return;
    const style = document.createElement('style');
    style.id = IDS.style;
    style.textContent = CSS;
    (document.head || document.documentElement || document.body).appendChild(style);
  }

  function el(tag, props = {}, attrs = {}) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function link(text, href, ariaLabel) {
    return el('a', { textContent: text, href, target: '_blank', rel: 'noopener noreferrer' },
      ariaLabel ? { 'aria-label': ariaLabel } : {});
  }

  function createStatus() {
    const status = document.createElement('div');
    status.id = IDS.status;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    ensureStyles();
    document.body.appendChild(status);
    return status;
  }

  function setStatusState(status, state) {
    status.setAttribute('data-state', state);
  }

  function setExportingUI(busy) {
    if (!ui.exportBtn) return;
    ui.exportBtn.disabled = busy;
    ui.exportBtn.setAttribute('aria-busy', String(busy));
    ui.exportLabel.textContent = busy ? 'Exporting…' : 'Export';
  }

  function createButton() {
    if (document.getElementById(IDS.button)) return;
    ensureStyles();

    const wrap = el('div', { id: IDS.button });

    const main = el('button', { type: 'button', className: 'tce-fab', title: 'Export Claude Chat (Alt+Shift+E)' },
      { 'aria-label': 'Export chat (Alt+Shift+E)', 'aria-keyshortcuts': 'Alt+Shift+E' });
    const icon = el('span', { innerHTML: EXPORT_ICON }, { 'aria-hidden': 'true' });
    const label = el('span', { textContent: 'Export' });
    main.append(icon, label);
    main.addEventListener('click', () => void startExport());

    const gear = el('button', { type: 'button', className: 'tce-fab tce-gear', textContent: '⚙', title: 'Export options' },
      { 'aria-label': 'Export options', 'aria-haspopup': 'dialog', 'aria-controls': IDS.panel });
    gear.addEventListener('click', () => togglePanel());

    ui.exportBtn = main;
    ui.exportLabel = label;
    setExportingUI(STATE.isExporting);

    wrap.append(main, gear);
    document.body.appendChild(wrap);
  }

  function togglePanel() {
    const existing = document.getElementById(IDS.panel);
    if (existing) {
      if (ui.closePanel) ui.closePanel();
      else existing.remove();
      return;
    }
    ensureStyles();

    const panel = el('div', { id: IDS.panel }, {
      role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'tyhallcsu-claude-exporter-title',
    });

    // Header: title + version, author credit, close button.
    const head = el('div', { className: 'tce-head' });
    const headText = el('div');
    const title = el('h2', { className: 'tce-title', id: 'tyhallcsu-claude-exporter-title', textContent: 'Claude Chat Exporter' });
    title.appendChild(el('span', { className: 'tce-ver', textContent: `v${VERSION}` }));
    const sub = el('div', { className: 'tce-sub', textContent: 'by ' });
    sub.appendChild(link('sharmanhall', LINKS.author, 'sharmanhall on Greasy Fork'));
    headText.append(title, sub);
    const closeBtn = el('button', { type: 'button', className: 'tce-close', textContent: '×', title: 'Close' },
      { 'aria-label': 'Close export options' });
    head.append(headText, closeBtn);

    // Format: segmented radio buttons.
    const fmtLabel = el('div', { className: 'tce-label', id: 'tyhallcsu-claude-exporter-fmt', textContent: 'Format' });
    const seg = el('div', { className: 'tce-seg' }, { role: 'radiogroup', 'aria-labelledby': 'tyhallcsu-claude-exporter-fmt' });
    const segBtns = FORMATS.map(({ value, label }) => {
      const b = el('button', { type: 'button', textContent: label }, { role: 'radio', 'data-k': value });
      b.addEventListener('click', () => { savePref('format', value); syncFormat(); });
      return b;
    });
    function syncFormat() {
      for (const b of segBtns) {
        const on = b.getAttribute('data-k') === prefs.format;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
    }
    seg.addEventListener('keydown', (e) => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const i = FORMATS.findIndex((f) => f.value === prefs.format);
      const next = FORMATS[(i + dir + FORMATS.length) % FORMATS.length].value;
      savePref('format', next);
      syncFormat();
      segBtns.find((b) => b.getAttribute('data-k') === next).focus();
    });
    seg.append(...segBtns);
    syncFormat();

    // Options: toggle switches.
    const optLabel = el('div', { className: 'tce-label', textContent: 'Include' });
    const opts = el('div');
    for (const [key, text] of TOGGLES) {
      const row = el('label', { className: 'tce-row' });
      const cb = el('input', { type: 'checkbox', className: 'tce-switch', checked: !!prefs[key] },
        { role: 'switch', 'data-k': key, 'aria-label': text });
      cb.addEventListener('change', (e) => savePref(key, e.target.checked));
      row.append(el('span', { textContent: text }), cb);
      opts.appendChild(row);
    }

    // Footer links.
    const foot = el('div', { className: 'tce-foot' });
    foot.append(
      link('Greasy Fork', LINKS.greasyFork),
      link('GitHub', LINKS.github),
      link('Report issue', LINKS.issues),
      el('span', { className: 'tce-hint', textContent: 'Alt+Shift+E' }),
    );

    panel.append(head, fmtLabel, seg, optLabel, opts, foot);

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); }
    };
    const onPointer = (e) => {
      const btnWrap = document.getElementById(IDS.button);
      if (panel.contains(e.target) || btnWrap?.contains(e.target)) return;
      close(false);
    };
    function close(restoreFocus) {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onPointer, true);
      panel.remove();
      ui.closePanel = null;
      if (restoreFocus) document.getElementById(IDS.button)?.querySelector('.tce-gear')?.focus();
    }
    closeBtn.addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onPointer, true);
    ui.closePanel = () => close(false);

    document.body.appendChild(panel);
    (segBtns.find((b) => b.tabIndex === 0) || closeBtn).focus();
  }

  // ---------- main ----------

  async function startExport(formatOverride) {
    if (STATE.isExporting) { notify('An export is already running.'); return; }
    STATE.isExporting = true;
    const statusDiv = createStatus();
    setExportingUI(true);
    const format = formatOverride ?? prefs.format;

    try {
      if (!getRouteFromUrl()) throw new Error('Open a chat or shared chat to export.');
      statusDiv.textContent = 'Fetching conversation...';
      const data = await fetchConversationData();
      let thread;

      // Share routes throw from fetchConversationData on failure, so only
      // chat routes reach the copy-button fallback.
      if (data?.chat_messages?.length) {
        thread = buildActiveThread(data);
      } else {
        statusDiv.textContent = 'API unavailable — using DOM fallback...';
        thread = await extractViaDomFallback(statusDiv);
      }

      if (!thread.length) throw new Error('No messages were captured.');

      const meta = {
        title: resolveTitle(data),
        url: window.location.href,
      };
      const base = sanitizeFilename(meta.title);
      const stamp = datestamp();

      let content, filename, mime;
      if (format === 'json') {
        content = buildJson(thread, meta, data);
        filename = `${base}_${stamp}.json`;
        mime = 'application/json';
      } else if (format === 'html') {
        content = buildHtml(thread, meta);
        filename = `${base}_${stamp}.html`;
        mime = 'text/html';
      } else {
        content = buildMarkdown(thread, meta);
        filename = `${base}_${stamp}.md`;
        mime = 'text/markdown';
      }

      if (prefs.copyInsteadOfDownload) {
        const copied = await Promise.resolve(copyToClipboard(content));
        if (!copied) throw new Error('Clipboard write failed');
        setStatusState(statusDiv, 'success');
        statusDiv.textContent = `Copied ${format} to clipboard (${thread.length} messages)`;
        notify(`Copied ${format} to clipboard`);
      } else {
        downloadFile(content, filename, mime);
        setStatusState(statusDiv, 'success');
        statusDiv.textContent = `Done. Downloaded ${filename}`;
        notify(`Downloaded ${filename}`);
      }
    } catch (error) {
      setStatusState(statusDiv, 'error');
      statusDiv.textContent = `Export failed: ${error.message}`;
      console.error('[Claude Exporter]', error);
      notify(`Export failed: ${error.message}`);
    } finally {
      STATE.isExporting = false;
      setExportingUI(false);
      setTimeout(() => statusDiv.remove(), 3500);
    }
  }

  // ---------- init ----------

  function init() {
    createButton();

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Export chat (current format)', () => void startExport());
      GM_registerMenuCommand('Export chat as Markdown', () => void startExport('markdown'));
      GM_registerMenuCommand('Export chat as JSON', () => void startExport('json'));
      GM_registerMenuCommand('Export chat as HTML', () => void startExport('html'));
      GM_registerMenuCommand('Toggle options panel', () => togglePanel());
    }

    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
        e.preventDefault();
        void startExport();
      }
    });
  }

  setTimeout(init, 600);
})();
