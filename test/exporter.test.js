'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_PATH = path.join(__dirname, '..', 'claude-ai-chat-exporter.user.js');
const HOOK = 'setTimeout(init, 600);';
const EXPORTS = [
  'getRouteFromUrl', 'fetchShareData', 'normalizeSnapshot', 'buildActiveThread',
  'renderMessageToMarkdown', 'markdownToHtml', 'buildHtml', 'fence',
  'extractViaDomFallback', 'copyToClipboard', 'startExport', 'prefs',
  'createButton', 'togglePanel',
];

// Load the userscript in a fresh vm context with browser/GM stubs. The init
// call is swapped for an export hook so internals are reachable.
function load(opts = {}) {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  assert.ok(src.includes(HOOK), 'init hook not found in userscript');
  const patched = src.replace(HOOK, `globalThis.__exporter = { ${EXPORTS.join(', ')} };`);

  const created = [];
  const makeEl = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(), style: {}, textContent: '', children: [], parent: null, attrs: {},
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      append(...cs) { cs.forEach((c) => this.appendChild(c)); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
      contains(n) { return n === this || this.children.some((c) => c.contains(n)); },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
      click() {}, focus() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    };
    created.push(el);
    return el;
  };
  const walk = (n) => [n, ...n.children.flatMap(walk)];
  const body = makeEl('body');
  created.length = 0;

  const fetchCalls = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
    clearTimeout,
    Promise, Date, JSON, Map, Set, Array, Object, String, Number, Math, RegExp, Error,
    Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    window: {
      location: { pathname: opts.pathname ?? '/', href: `https://claude.ai${opts.pathname ?? '/'}` },
      addEventListener() {},
    },
    document: {
      cookie: opts.cookie ?? 'lastActiveOrg=org-1',
      title: opts.title ?? 'Claude',
      body,
      createElement: makeEl,
      getElementById: (id) => walk(body).find((n) => n.id === id) ?? null,
      addEventListener() {}, removeEventListener() {},
      querySelector: () => null,
      querySelectorAll: opts.querySelectorAll ?? (() => []),
    },
    navigator: { clipboard: opts.clipboard },
    fetch: async (url, init) => {
      fetchCalls.push(url);
      if (!opts.fetch) throw new Error('fetch not stubbed');
      return opts.fetch(url, init);
    },
    GM_getValue: () => undefined,
    GM_setValue() {},
    GM_notification() {},
    GM_registerMenuCommand() {},
    GM_setClipboard: opts.GM_setClipboard ?? (() => {}),
  };
  vm.createContext(ctx);
  vm.runInContext(patched, ctx, { filename: 'claude-ai-chat-exporter.user.js' });
  return { api: ctx.__exporter, ctx, created, fetchCalls, body, walk };
}

const jsonRes = (status, body) => ({
  status, ok: status >= 200 && status < 300, json: async () => body,
});

const statusText = (created) => created[0]?.textContent ?? '';

// ---------- routes (#14) ----------

test('share route detection', () => {
  const { api } = load({ pathname: '/share/abc-123' });
  assert.deepEqual({ ...api.getRouteFromUrl() }, { kind: 'share', id: 'abc-123' });
});

test('chat route detection', () => {
  const { api } = load({ pathname: '/chat/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b' });
  assert.deepEqual({ ...api.getRouteFromUrl() },
    { kind: 'chat', id: '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b' });
});

test('#14 bare uuid path is a chat, project/<uuid> is not', () => {
  const uuid = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
  assert.equal(load({ pathname: `/${uuid}` }).api.getRouteFromUrl().kind, 'chat');
  for (const p of [`/project/${uuid}`, `/projects/${uuid}`, '/new', '/recents', `/settings/${uuid}`]) {
    assert.equal(load({ pathname: p }).api.getRouteFromUrl(), null, p);
  }
});

test('#14 startExport on non-chat page throws and skips fetch + DOM fallback', async () => {
  let domQueried = false;
  const { api, created, fetchCalls } = load({
    pathname: '/project/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b',
    querySelectorAll: () => { domQueried = true; return []; },
  });
  await api.startExport('markdown');
  assert.equal(statusText(created), 'Export failed: Open a chat or shared chat to export.');
  assert.equal(fetchCalls.length, 0);
  assert.equal(domQueried, false);
});

test('#14 chat route still uses DOM fallback when API fails', async () => {
  const group = makeGroup(false, (clip) => clip.writeText('hello from dom'));
  const clipboard = { async writeText() {} };
  let downloaded = false;
  const env = load({
    pathname: '/chat/abc-def-0123456789',
    fetch: async () => jsonRes(500, {}),
    clipboard,
    querySelectorAll: () => [group(clipboard)],
  });
  const origCreate = env.ctx.document.createElement;
  env.ctx.document.createElement = (tag) => {
    const el = origCreate(tag);
    if (tag === 'a') el.click = () => { downloaded = true; };
    return el;
  };
  await env.api.startExport('markdown');
  assert.match(statusText(env.created), /^Done\. Downloaded /);
  assert.equal(downloaded, true);
});

// ---------- share API ----------

test('normalizeSnapshot maps snapshot_name + chat_messages', () => {
  const { api } = load();
  const msgs = [{ uuid: 'm1', sender: 'human', content: [] }];
  const out = api.normalizeSnapshot({ snapshot_name: 'Shared title', chat_messages: msgs }, 'share-1');
  assert.equal(out.name, 'Shared title');
  assert.equal(out.uuid, 'share-1');
  assert.equal(out.chat_messages, msgs);
  assert.equal(out.current_leaf_message_uuid, null);
});

test('403 on share throws a no-access error', async () => {
  const { api } = load({ pathname: '/share/s1', fetch: async () => jsonRes(403, {}) });
  await assert.rejects(api.fetchShareData('s1'), /No access to this shared chat \(HTTP 403\)/);
});

// ---------- thread walk ----------

test('buildActiveThread follows parent links from current leaf', () => {
  const { api } = load();
  const data = {
    current_leaf_message_uuid: 'c',
    chat_messages: [
      { uuid: 'a', parent_message_uuid: null, created_at: '2026-01-01T00:00:00Z' },
      { uuid: 'b-old', parent_message_uuid: 'a', created_at: '2026-01-01T00:01:00Z' },
      { uuid: 'b', parent_message_uuid: 'a', created_at: '2026-01-01T00:02:00Z' },
      { uuid: 'c', parent_message_uuid: 'b', created_at: '2026-01-01T00:03:00Z' },
    ],
  };
  assert.deepEqual([...api.buildActiveThread(data)].map((m) => m.uuid), ['a', 'b', 'c']);
});

test('buildActiveThread without leaf id picks the latest leaf', () => {
  const { api } = load();
  const data = {
    chat_messages: [
      { uuid: 'a', parent_message_uuid: null, created_at: '2026-01-01T00:00:00Z' },
      { uuid: 'x', parent_message_uuid: 'a', created_at: '2026-01-01T00:05:00Z' },
      { uuid: 'b', parent_message_uuid: 'a', created_at: '2026-01-01T00:01:00Z' },
      { uuid: 'c', parent_message_uuid: 'b', created_at: '2026-01-01T00:02:00Z' },
    ],
  };
  assert.deepEqual([...api.buildActiveThread(data)].map((m) => m.uuid), ['a', 'x']);
});

// ---------- rendering ----------

test('#9 buildHtml escapes all text, including around code blocks', () => {
  const { api } = load();
  const md = '<script>alert(1)</script> before\n```js\nconst a = "<b>";\n```\nafter <img src=x onerror=alert(1)>';
  const html = api.markdownToHtml(md);
  assert.ok(!html.includes('<script>'), html);
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('<b>'), html);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<pre class="code" data-lang="js"><code>const a = &quot;&lt;b&gt;&quot;;<\/code><\/pre>/);
});

test('#9 text starting with <pre is escaped, not passed through', () => {
  const { api } = load();
  const html = api.markdownToHtml('<pre onmouseover=alert(1)>x</pre>');
  assert.equal(html, '<p>&lt;pre onmouseover=alert(1)&gt;x&lt;/pre&gt;</p>');
});

test('#10 code blocks with blank lines stay intact', () => {
  const { api } = load();
  const html = api.markdownToHtml('intro\n\n```py\ndef a():\n    pass\n\n\ndef b():\n    pass\n```\n\noutro');
  const pres = html.match(/<pre[\s\S]*?<\/pre>/g);
  assert.equal(pres.length, 1);
  assert.equal(pres[0], '<pre class="code" data-lang="py"><code>def a():\n    pass\n\n\ndef b():\n    pass</code></pre>');
  assert.match(html, /^<p>intro<\/p>\n<pre/);
  assert.match(html, /<\/pre>\n<p>outro<\/p>$/);
});

test('buildHtml wraps rendered messages', () => {
  const { api } = load();
  const html = api.buildHtml([{ sender: 'human', content: [{ type: 'text', text: 'a <x>' }] }],
    { title: 'T <1>', url: null });
  assert.match(html, /<title>T &lt;1&gt;<\/title>/);
  assert.match(html, /<p>a &lt;x&gt;<\/p>/);
});

test('#13 attachment names are not HTML-escaped in markdown', () => {
  const { api } = load();
  const md = api.renderMessageToMarkdown({
    content: [],
    attachments: [{ file_name: 'Q&A <draft>.txt', extracted_content: 'body' }, { file_name: "it's.pdf" }],
  });
  assert.match(md, /attachment: Q&A <draft>\.txt\*\*/);
  assert.match(md, /attachment: it's\.pdf\*\*/);
  assert.ok(!md.includes('&amp;'));
});

test('#15 legacy msg.text is rendered when content is not an array', () => {
  const { api } = load();
  assert.equal(api.renderMessageToMarkdown({ text: 'legacy body' }), 'legacy body');
  assert.equal(api.renderMessageToMarkdown({ content: 'nope', text: 'legacy body' }), 'legacy body');
  assert.equal(api.renderMessageToMarkdown({}), '');
});

test('#16 fence grows past backtick runs in content', () => {
  const { api } = load();
  assert.equal(api.fence('plain'), '```\nplain\n```');
  assert.equal(api.fence('has ``` inside', 'json'), '````json\nhas ``` inside\n````');
  assert.equal(api.fence('x ````` y'), '``````\nx ````` y\n``````');

  const md = api.renderMessageToMarkdown({
    content: [
      { type: 'tool_use', name: 't', input: { s: '```' } },
      { type: 'tool_result', content: 'out\n```\nmore' },
    ],
    attachments: [{ file_name: 'a.md', extracted_content: '```js\nx\n```' }],
  });
  assert.match(md, /````json\n\{\n {2}"s": "```"\n\}\n````/);
  assert.match(md, /````\nout\n```\nmore\n````/);
  assert.match(md, /````\n```js\nx\n```\n````/);

  // Round-trip: the nested fence stays inside one <pre>.
  const html = api.markdownToHtml(md);
  assert.equal(html.match(/<pre/g).length, 3);
  assert.match(html, /<code>out\n```\nmore<\/code>/);
});

// ---------- clipboard (#11) ----------

async function exportWithCopy(opts) {
  const env = load({
    pathname: '/chat/abc-def-0123456789',
    fetch: async () => jsonRes(200, {
      name: 'T', chat_messages: [{ uuid: 'a', sender: 'human', content: [{ type: 'text', text: 'hi' }] }],
    }),
    ...opts,
  });
  env.api.prefs.copyInsteadOfDownload = true;
  await env.api.startExport('markdown');
  return statusText(env.created);
}

test('#11 async clipboard failure surfaces as export failure', async () => {
  const status = await exportWithCopy({
    GM_setClipboard: () => { throw new Error('no GM'); },
    clipboard: { writeText: () => Promise.reject(new Error('denied')) },
  });
  assert.equal(status, 'Export failed: Clipboard write failed');
});

test('#11 sync clipboard failure surfaces as export failure', async () => {
  const status = await exportWithCopy({
    GM_setClipboard: () => { throw new Error('no GM'); },
    clipboard: undefined,
  });
  assert.equal(status, 'Export failed: Clipboard write failed');
});

test('#11 successful clipboard write reports copied', async () => {
  const status = await exportWithCopy({});
  assert.match(status, /^Copied markdown to clipboard/);
});

// ---------- DOM fallback (#12) ----------

function makeGroup(isAssistant, onClick) {
  return (clipboard) => ({
    querySelector(sel) {
      if (sel.includes('feedback')) return isAssistant ? {} : null;
      if (sel.includes('action-bar-copy')) {
        return { scrollIntoView() {}, click() { onClick(navigatorClip(clipboard)); } };
      }
      return null;
    },
  });
}
// Always call the currently-installed writeText (the fallback swaps it).
const navigatorClip = (clipboard) => ({ writeText: (t) => clipboard.writeText(t) });

test('#12 missed and late copies do not shift messages', async () => {
  const clipboard = { async writeText() {} };
  const groups = [
    makeGroup(false, (c) => c.writeText('A')),
    // Missed within its window; arrives late during item 2's window.
    makeGroup(true, (c) => { setTimeout(() => c.writeText('B-late'), 1900).unref(); }),
    makeGroup(false, (c) => c.writeText('C')),
  ].map((g) => g(clipboard));
  const { api } = load({ clipboard, querySelectorAll: () => groups });

  const msgs = await api.extractViaDomFallback({ textContent: '' });
  assert.deepEqual(msgs.map((m) => [m.sender, m.content[0].text]),
    [['human', 'A'], ['human', 'C']]);

  // Late write after the loop must not land anywhere or throw.
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(msgs.length, 2);
});

// ---------- UI (#8) ----------

const PANEL_ID = 'tyhallcsu-claude-exporter-panel';
const BUTTON_ID = 'tyhallcsu-claude-exporter-button';
const links = (env, root) => env.walk(root).filter((n) => n.tagName === 'A');

test('#8 panel credits sharmanhall with a safe Greasy Fork link', () => {
  const env = load();
  env.api.togglePanel();
  const panel = env.ctx.document.getElementById(PANEL_ID);
  assert.ok(panel, 'panel not appended');
  assert.equal(panel.getAttribute('role'), 'dialog');

  const author = links(env, panel).find((a) => a.textContent === 'sharmanhall');
  assert.ok(author, 'sharmanhall credit link missing');
  assert.equal(author.href, 'https://greasyfork.org/en/users/866731-sharmanhall');
  assert.equal(author.target, '_blank');
  assert.match(author.rel, /\bnoopener\b/);
  assert.match(author.rel, /\bnoreferrer\b/);

  const text = env.walk(panel).map((n) => n.textContent).join(' ');
  assert.match(text, /Claude Chat Exporter/);
  assert.match(text, /by /);
});

test('#8 panel footer links to Greasy Fork, GitHub and issues', () => {
  const env = load();
  env.api.togglePanel();
  const byText = Object.fromEntries(
    links(env, env.ctx.document.getElementById(PANEL_ID)).map((a) => [a.textContent, a]));
  assert.equal(byText['Greasy Fork'].href, 'https://greasyfork.org/en/scripts/574914-claude-ai-chat-exporter');
  assert.equal(byText.GitHub.href, 'https://github.com/tyhallcsu/claude-ai-chat-exporter');
  assert.equal(byText['Report issue'].href, 'https://github.com/tyhallcsu/claude-ai-chat-exporter/issues');
  for (const a of Object.values(byText)) assert.match(a.rel, /noopener/);
});

test('#8 toggling the panel twice removes it', () => {
  const env = load();
  env.api.togglePanel();
  assert.ok(env.ctx.document.getElementById(PANEL_ID));
  env.api.togglePanel();
  assert.equal(env.ctx.document.getElementById(PANEL_ID), null);
  env.api.togglePanel();
  assert.ok(env.ctx.document.getElementById(PANEL_ID), 'panel reopens after close');
});

test('#8 createButton twice creates one button; style injected once', () => {
  const env = load();
  env.api.createButton();
  env.api.createButton();
  env.api.togglePanel();
  const nodes = env.walk(env.body);
  assert.equal(nodes.filter((n) => n.id === BUTTON_ID).length, 1);
  assert.equal(nodes.filter((n) => n.id === 'tyhallcsu-claude-exporter-style').length, 1);
});
