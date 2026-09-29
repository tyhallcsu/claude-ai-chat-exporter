const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('claude-ai-chat-exporter.user.js', 'utf8');
const snap = fs.readFileSync(__dirname + '/snapshot-fixture.json', 'utf8');
async function run(path, status, body) {
  const els = {}, blobs = [], urls = []; let keyHandler;
  const mkEl = () => { const t = { style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){} }, setAttribute(k, v){ t[k] = v; }, getAttribute(k){ return t[k]; }, removeAttribute(){}, append(){}, appendChild(){}, addEventListener(){}, removeEventListener(){}, focus(){}, contains(){ return false; }, remove(){ delete els[t.id]; }, querySelector(){ return null; }, querySelectorAll(){ return []; }, click(){}, scrollIntoView(){} };
    return new Proxy(t, { set(o,k,v){ o[k]=v; if (k==='id') els[v]=o; return true; } }); };
  const ctx = { console: { log(){}, warn(){}, error(){} }, setTimeout, Promise, Map, Set, Date, JSON, Array, Object, String, RegExp, Error, Blob,
    document: { head: { appendChild(){} }, addEventListener(){}, removeEventListener(){}, cookie: 'lastActiveOrg=org1', title: 'Claude', body: { appendChild(){} }, createElement: mkEl, getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [] },
    navigator: {}, window: { location: { pathname: path, href: 'https://claude.ai' + path }, addEventListener: (t, f) => { keyHandler = f; } },
    URL: { createObjectURL: b => { blobs.push(b); return 'blob:'; }, revokeObjectURL(){} },
    fetch: async u => { urls.push(u); return { ok: status === 200, status, json: async () => JSON.parse(body) }; },
    GM_getValue: (k, d) => d, GM_setValue(){}, GM_notification(){}, GM_registerMenuCommand(){}, GM_setClipboard(){} };
  vm.runInNewContext(src, ctx);
  await new Promise(r => setTimeout(r, 700));
  let statusEl; const orig = ctx.document.createElement; ctx.document.createElement = () => { const e = orig(); statusEl = statusEl || e; return e; };
  keyHandler({ altKey: true, shiftKey: true, key: 'E', preventDefault(){} });
  await new Promise(r => setTimeout(r, 300));
  const md = blobs[0] ? await blobs[0].text() : '';
  return { url: urls[0], status: statusEl?.textContent, md };
}
(async () => {
  const a = await run('/share/abc-123', 200, snap);
  console.log('SHARE OK  ', a.url, '|', a.status);
  console.log(a.md.split('\n').filter(l => /^#/.test(l)).join('\n'));
  const b = await run('/share/abc-123', 403, '{}'); console.log('SHARE 403 ', b.status);
  const c = await run('/chat/0123456789abcdef0', 200, snap.replace('"snapshot_name":"T"', '"name":"C"')); console.log('CHAT OK   ', c.url, '|', c.status);
})();
