// ==UserScript==
// @name         Claude AI Chat Exporter
// @namespace    https://github.com/tyhallcsu/claude-ai-chat-exporter
// @version      2026.09.29.1
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

  const VERSION = '2026.09.29.1';

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
    const last = parts[parts.length - 1];
    return /^[0-9a-f-]{16,}$/i.test(last) ? { kind: 'chat', id: last } : null;
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
    const parts = Array.isArray(msg.content) ? msg.content : [];
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
        out.push(`**→ tool_use: \`${name}\`**\n\n\`\`\`json\n${input}\n\`\`\``);
      } else if (type === 'tool_result' && prefs.includeToolUse) {
        const body = toolResultText(p.content ?? p.text);
        if (body) out.push(`**← tool_result${p.is_error ? ' (error)' : ''}**\n\n\`\`\`\n${body}\n\`\`\``);
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
          out.push(`**📎 attachment: ${escapeHtml(name)}**\n\n\`\`\`\n${content}\n\`\`\``);
        } else {
          out.push(`**📎 attachment: ${escapeHtml(name)}**`);
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

  function buildHtml(thread, meta) {
    const rows = thread.map((msg) => {
      const sender = msg.sender === 'human' ? 'Human' : 'Claude';
      const ts = prefs.includeTimestamps ? formatTimestamp(msg.created_at) : '';
      const md = renderMessageToMarkdown(msg);
      // minimal md→html: fenced code + paragraphs
      const html = md
        .replace(/```(\w*)\n([\s\S]*?)```/g,
          (_, lang, code) => `<pre class="code" data-lang="${escapeHtml(lang)}"><code>${escapeHtml(code)}</code></pre>`)
        .split(/\n{2,}/)
        .map((b) => b.startsWith('<pre') ? b : `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
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

    const captures = [];
    const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text) => {
      if (typeof text === 'string' && text.trim()) captures.push(text);
    };

    try {
      for (let i = 0; i < items.length; i++) {
        const before = captures.length;
        statusDiv.textContent = `Fallback export ${i + 1}/${items.length}...`;
        items[i].copyBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
        items[i].copyBtn.click();
        const deadline = Date.now() + 1800;
        while (captures.length === before && Date.now() < deadline) await delay(60);
      }
    } finally {
      navigator.clipboard.writeText = origWrite;
    }

    return items.map((it, i) => ({
      sender: it.type === 'assistant' ? 'assistant' : 'human',
      created_at: null,
      content: [{ type: 'text', text: captures[i] ?? '' }],
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

  function createStatus() {
    const el = document.createElement('div');
    el.id = 'tyhallcsu-claude-exporter-status';
    el.style.cssText = [
      'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
      'background:#1f6feb', 'color:#fff', 'padding:10px 14px',
      'border-radius:10px', 'font:12px/1.45 ui-monospace,Menlo,monospace',
      'box-shadow:0 10px 30px rgba(0,0,0,.25)', 'max-width:360px',
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  function createButton() {
    if (document.getElementById('tyhallcsu-claude-exporter-button')) return;

    const wrap = document.createElement('div');
    wrap.id = 'tyhallcsu-claude-exporter-button';
    wrap.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:2147483647;display:flex;gap:6px;';

    const main = document.createElement('button');
    main.type = 'button';
    main.textContent = 'Export';
    main.title = 'Export Claude Chat (Alt+Shift+E)';
    main.style.cssText = baseBtnStyle();
    main.addEventListener('click', () => void startExport());

    const gear = document.createElement('button');
    gear.type = 'button';
    gear.textContent = '⚙';
    gear.title = 'Export options';
    gear.style.cssText = baseBtnStyle() + ';padding:10px 12px;';
    gear.addEventListener('click', () => togglePanel());

    wrap.append(main, gear);
    document.body.appendChild(wrap);
  }

  function baseBtnStyle() {
    return [
      'padding:12px 16px', 'border:none', 'border-radius:999px',
      'background:#111827', 'color:#fff', 'font:600 13px system-ui',
      'cursor:pointer', 'box-shadow:0 10px 25px rgba(0,0,0,.25)',
    ].join(';');
  }

  function togglePanel() {
    const existing = document.getElementById('tyhallcsu-claude-exporter-panel');
    if (existing) { existing.remove(); return; }

    const panel = document.createElement('div');
    panel.id = 'tyhallcsu-claude-exporter-panel';
    panel.style.cssText = [
      'position:fixed', 'bottom:78px', 'right:18px', 'z-index:2147483647',
      'background:#0f172a', 'color:#e2e8f0', 'padding:14px 16px',
      'border-radius:12px', 'box-shadow:0 14px 40px rgba(0,0,0,.35)',
      'font:13px/1.4 system-ui', 'min-width:240px',
    ].join(';');

    panel.innerHTML = `
      <div style="font-weight:700;margin-bottom:8px;">Export options</div>
      <label style="display:block;margin:6px 0;">Format:
        <select data-k="format" style="margin-left:6px;">
          <option value="markdown">Markdown (.md)</option>
          <option value="json">JSON (.json)</option>
          <option value="html">HTML (.html)</option>
        </select>
      </label>
      ${checkbox('includeThinking', 'Include thinking blocks')}
      ${checkbox('includeToolUse', 'Include tool use / results')}
      ${checkbox('includeAttachments', 'Include attachments')}
      ${checkbox('includeTimestamps', 'Include timestamps')}
      ${checkbox('copyInsteadOfDownload', 'Copy to clipboard (no download)')}
      <div style="margin-top:10px;opacity:.65;font-size:11px;">v${VERSION}</div>
    `;

    const sel = panel.querySelector('[data-k="format"]');
    sel.value = prefs.format;
    sel.addEventListener('change', (e) => savePref('format', e.target.value));

    panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = !!prefs[cb.dataset.k];
      cb.addEventListener('change', (e) => savePref(e.target.dataset.k, e.target.checked));
    });

    document.body.appendChild(panel);
  }

  function checkbox(key, label) {
    return `<label style="display:block;margin:6px 0;">
      <input type="checkbox" data-k="${key}" style="margin-right:6px;">
      ${escapeHtml(label)}
    </label>`;
  }

  // ---------- main ----------

  async function startExport(formatOverride) {
    if (STATE.isExporting) { notify('An export is already running.'); return; }
    STATE.isExporting = true;
    const statusDiv = createStatus();
    const format = formatOverride ?? prefs.format;

    try {
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
        await Promise.resolve(copyToClipboard(content));
        statusDiv.style.background = '#15803d';
        statusDiv.textContent = `Copied ${format} to clipboard (${thread.length} messages)`;
        notify(`Copied ${format} to clipboard`);
      } else {
        downloadFile(content, filename, mime);
        statusDiv.style.background = '#15803d';
        statusDiv.textContent = `Done. Downloaded ${filename}`;
        notify(`Downloaded ${filename}`);
      }
    } catch (error) {
      statusDiv.style.background = '#b91c1c';
      statusDiv.textContent = `Export failed: ${error.message}`;
      console.error('[Claude Exporter]', error);
      notify(`Export failed: ${error.message}`);
    } finally {
      STATE.isExporting = false;
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
