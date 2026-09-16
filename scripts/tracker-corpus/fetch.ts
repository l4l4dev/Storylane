#!/usr/bin/env bun
/**
 * Downloads the archived Pivotal Tracker help site from the Wayback Machine
 * into a local, git-ignored reference corpus (docs/reference/tracker/).
 *
 * See scripts/tracker-corpus/README.md. Run: bun scripts/tracker-corpus/fetch.ts [--force]
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
const OUT = join(ROOT, 'docs/reference/tracker');
const HOST = 'www.pivotaltracker.com';
const ORIGIN = `https://${HOST}`;
const FORCE = process.argv.includes('--force');

// Wayback resolves a partial timestamp to the nearest capture; `id_` returns the
// original bytes with no Wayback toolbar injected.
const PREFERRED_TS = '20241231235959';
const CONCURRENCY = 3;
const SPACING_MS = 200;
const UA = 'storylane-tracker-corpus/1.0 (local research corpus; contact via github.com/l4l4dev)';

type LogEntry = {
  url: string;
  kind: string;
  status: 'ok' | 'skipped' | 'not-found' | 'failed';
  httpStatus?: number;
  bytes?: number;
  timestamp?: string;
  note?: string;
};
const log: LogEntry[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- fetch layer

let lastRequestAt = 0;
const gate: Promise<void>[] = [];
let inFlight = 0;
const waiters: (() => void)[] = [];

async function acquire() {
  if (inFlight >= CONCURRENCY) await new Promise<void>((r) => waiters.push(r));
  inFlight++;
  const wait = lastRequestAt + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}
function release() {
  inFlight--;
  waiters.shift()?.();
}
void gate;

const OFFLINE_MARKER = 'Temporarily Offline';

type Fetched = { ok: true; body: Uint8Array; text: () => string; httpStatus: number; timestamp?: string }
  | { ok: false; httpStatus: number; reason: string };

async function rawFetch(url: string, attempts: number, baseDelayMs: number): Promise<Fetched> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await acquire();
    let res: Response | undefined;
    let err: unknown;
    try {
      res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    } catch (e) {
      err = e;
    } finally {
      release();
    }

    if (res) {
      const buf = new Uint8Array(await res.arrayBuffer());
      const head = new TextDecoder().decode(buf.subarray(0, 4096));
      const offline = head.includes(OFFLINE_MARKER);

      if (res.ok && !offline) {
        const ts = /\/web\/(\d{4,14})(?:id_|im_|cs_|js_)?\//.exec(res.url)?.[1];
        return {
          ok: true,
          body: buf,
          text: () => new TextDecoder().decode(buf),
          httpStatus: res.status,
          timestamp: ts,
        };
      }
      // 404 from the archive is a real answer, not a transient failure.
      if (res.status === 404 && !offline) return { ok: false, httpStatus: 404, reason: 'not-found' };
      if (!offline && res.status < 500 && res.status !== 429) {
        return { ok: false, httpStatus: res.status, reason: `http ${res.status}` };
      }
      console.log(`  retry ${attempt}/${attempts} ${offline ? 'archive-offline' : `http ${res.status}`} ${url}`);
    } else {
      console.log(`  retry ${attempt}/${attempts} network-error ${url}`);
    }

    if (attempt < attempts) await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), 60_000));
  }
  return { ok: false, httpStatus: 0, reason: `failed after ${attempts} attempts` };
}

const wb = (original: string, ts = PREFERRED_TS) =>
  `https://web.archive.org/web/${ts}id_/${original}`;

/** Fetch an original URL through the archive, preferring a 2024 capture. */
async function fetchArchived(original: string): Promise<Fetched> {
  const r = await rawFetch(wb(original), 4, 3000);
  if (r.ok) return r;
  if (r.reason === 'not-found') {
    // No 2024 capture: fall back to the latest capture of any year.
    const any = await rawFetch(wb(original, '3000'), 3, 3000);
    if (any.ok) return any;
  }
  return r;
}

// ------------------------------------------------------------------ CDX index

const parseCdx = (text: string) =>
  text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(' '));

async function cdx(query: string, label: string): Promise<string[][]> {
  const url = `https://web.archive.org/cdx/search/cdx?${query}`;
  // The CDX endpoint is slow and frequently offline; cache each answer so re-runs
  // don't pay for it again.
  const cachePath = join(OUT, '.cdx-cache', `${Bun.hash(query).toString(16)}.txt`);
  if (!FORCE && existsSync(cachePath)) {
    const rows = parseCdx(await readFile(cachePath, 'utf8'));
    console.log(`CDX ${label}: ${rows.length} rows (cached)`);
    return rows;
  }
  const r = await rawFetch(url, 5, 10_000);
  if (!r.ok) {
    console.log(`CDX ${label}: unavailable (${r.reason})`);
    log.push({ url, kind: 'cdx', status: 'failed', httpStatus: r.httpStatus, note: r.reason });
    return [];
  }
  const text = r.text();
  if (text.trimStart().startsWith('<')) {
    console.log(`CDX ${label}: unexpected HTML response, ${r.body.length} bytes`);
    log.push({ url, kind: 'cdx', status: 'failed', note: 'html response' });
    return [];
  }
  const rows = parseCdx(text);
  await writeIfNeeded(cachePath, text);
  console.log(`CDX ${label}: ${rows.length} rows, ${r.body.length} bytes`);
  log.push({ url, kind: 'cdx', status: 'ok', bytes: r.body.length, note: `${rows.length} rows` });
  return rows;
}

// ------------------------------------------------------------- tiny HTML tree

type TextNode = { type: 'text'; text: string };
type ElNode = { type: 'el'; tag: string; attrs: Record<string, string>; children: Node[] };
type Node = TextNode | ElNode;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
// Tags that may not nest inside themselves — an unclosed one is closed implicitly.
const AUTO_CLOSE: Record<string, string[]> = {
  li: ['li'], p: ['p'], td: ['td', 'th'], th: ['td', 'th'], tr: ['tr', 'td', 'th'],
  dd: ['dd', 'dt'], dt: ['dd', 'dt'], option: ['option'],
};

function parseHtml(html: string): ElNode {
  const root: ElNode = { type: 'el', tag: '#root', attrs: {}, children: [] };
  const stack: ElNode[] = [root];
  let i = 0;
  const push = (n: Node) => stack[stack.length - 1]!.children.push(n);

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { push({ type: 'text', text: html.slice(i) }); break; }
    if (lt > i) push({ type: 'text', text: html.slice(i, lt) });

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const m = /^<\s*(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (!m) { push({ type: 'text', text: '<' }); i = lt + 1; continue; }
    const closing = m[1] === '/';
    const tag = m[2]!.toLowerCase();

    // Scan to the end of the tag, honouring quoted attribute values.
    let j = lt + m[0].length;
    let quote = '';
    while (j < html.length) {
      const c = html[j]!;
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j++;
    }
    const inner = html.slice(lt + m[0].length, j);
    i = j + 1;

    if (closing) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.tag === tag) { stack.length = k; break; }
      }
      continue;
    }

    const attrs: Record<string, string> = {};
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(inner))) {
      attrs[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    }

    const selfClosing = inner.trimEnd().endsWith('/') || VOID.has(tag);
    const el: ElNode = { type: 'el', tag, attrs, children: [] };

    const closes = AUTO_CLOSE[tag];
    if (closes) {
      const top = stack[stack.length - 1]!;
      if (closes.includes(top.tag)) stack.pop();
    }
    stack[stack.length - 1]!.children.push(el);

    if (RAW.has(tag)) {
      const close = new RegExp(`</\\s*${tag}\\s*>`, 'i').exec(html.slice(i));
      const end = close ? i + close.index : html.length;
      el.children.push({ type: 'text', text: html.slice(i, end) });
      i = close ? end + close[0].length : html.length;
      continue;
    }
    if (!selfClosing) stack.push(el);
  }
  return root;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  copy: '©', reg: '®', trade: '™', times: '×', middot: '·', bull: '•', deg: '°',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', check: '✓',
};
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (full, ent: string) => {
    if (ent.startsWith('#x') || ent.startsWith('#X')) return String.fromCodePoint(parseInt(ent.slice(2), 16));
    if (ent.startsWith('#')) return String.fromCodePoint(parseInt(ent.slice(1), 10));
    return ENTITIES[ent.toLowerCase()] ?? full;
  });
}

function find(node: Node, pred: (el: ElNode) => boolean): ElNode | undefined {
  if (node.type !== 'el') return undefined;
  if (node.tag !== '#root' && pred(node)) return node;
  for (const c of node.children) {
    const r = find(c, pred);
    if (r) return r;
  }
  return undefined;
}
const hasClass = (el: ElNode, c: string) => (el.attrs.class ?? '').split(/\s+/).includes(c);
function walk(node: Node, fn: (el: ElNode) => void) {
  if (node.type !== 'el') return;
  if (node.tag !== '#root') fn(node);
  for (const c of node.children) walk(c, fn);
}
function textOf(node: Node): string {
  if (node.type === 'text') return decodeEntities(node.text);
  if (RAW.has(node.tag)) return '';
  return node.children.map(textOf).join('');
}

// ------------------------------------------------------------ HTML → Markdown

const escapeMd = (s: string) => s.replace(/([\\`*_[\]])/g, '\\$1');
const collapse = (s: string) => s.replace(/[ \t\r\n]+/g, ' ');

type MdCtx = { imageName: (src: string) => string | undefined; linkHref: (href: string) => string };

function inlineMd(node: Node, ctx: MdCtx): string {
  if (node.type === 'text') return escapeMd(collapse(decodeEntities(node.text)));
  const kids = () => node.children.map((c) => inlineMd(c, ctx)).join('');
  switch (node.tag) {
    case 'br': return '  \n';
    case 'strong': case 'b': { const t = kids().trim(); return t ? `**${t}**` : ''; }
    case 'em': case 'i': case 'cite': { const t = kids().trim(); return t ? `*${t}*` : ''; }
    case 'code': case 'kbd': case 'samp': { const t = collapse(textOf(node)).trim(); return t ? `\`${t}\`` : ''; }
    case 'del': case 's': { const t = kids().trim(); return t ? `~~${t}~~` : ''; }
    case 'a': {
      const t = kids().trim();
      const href = node.attrs.href;
      if (!t) return '';
      if (!href || href.startsWith('#')) return t;
      return `[${t}](${ctx.linkHref(href)})`;
    }
    case 'img': {
      const local = ctx.imageName(pickImageSrc(node));
      const alt = escapeMd(collapse(decodeEntities(node.attrs.alt ?? '')).trim());
      return local ? `![${alt}](../images/${local})` : '';
    }
    case 'script': case 'style': case 'noscript': return '';
    default: return kids();
  }
}

/** Prefer the @2x source when the page offers both. */
function pickImageSrc(el: ElNode): string {
  const cands: string[] = [];
  if (el.attrs.srcset) {
    for (const part of el.attrs.srcset.split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (u) cands.push(u);
    }
  }
  if (el.attrs['data-src']) cands.push(el.attrs['data-src']);
  if (el.attrs.src) cands.push(el.attrs.src);
  return cands.find((c) => c.includes('@2x')) ?? cands[0] ?? '';
}

function blockMd(node: Node, ctx: MdCtx, depth = 0): string {
  if (node.type === 'text') {
    const t = collapse(decodeEntities(node.text)).trim();
    return t ? escapeMd(t) + '\n\n' : '';
  }
  const children = () => node.children.map((c) => blockMd(c, ctx, depth)).join('');
  const inline = () => node.children.map((c) => inlineMd(c, ctx)).join('').replace(/[ \t]+\n/g, '  \n').trim();

  switch (node.tag) {
    case 'script': case 'style': case 'noscript': case 'nav': case 'footer': case 'form': case 'iframe':
      return '';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const t = inline();
      return t ? `${'#'.repeat(Number(node.tag[1]))} ${t}\n\n` : '';
    }
    case 'p': case 'figcaption': { const t = inline(); return t ? `${t}\n\n` : ''; }
    case 'hr': return '---\n\n';
    case 'pre': {
      const t = textOf(node).replace(/^\n+|\n+$/g, '');
      return t ? '```\n' + t + '\n```\n\n' : '';
    }
    case 'blockquote': {
      const body = children().trim();
      return body ? body.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n') + '\n\n' : '';
    }
    case 'ul': case 'ol': {
      const ordered = node.tag === 'ol';
      const items = node.children.filter((c): c is ElNode => c.type === 'el' && c.tag === 'li');
      const pad = '  '.repeat(depth);
      const lines = items.map((li, idx) => {
        const body = listItemMd(li, ctx, depth + 1).trim();
        if (!body) return '';
        const marker = ordered ? `${idx + 1}. ` : '- ';
        const [first, ...rest] = body.split('\n');
        const indent = pad + ' '.repeat(marker.length);
        return [pad + marker + first, ...rest.map((l) => (l ? indent + l : ''))].join('\n');
      }).filter(Boolean);
      return lines.length ? lines.join('\n') + '\n\n' : '';
    }
    case 'table': return tableMd(node, ctx);
    case 'img': { const t = inlineMd(node, ctx); return t ? `${t}\n\n` : ''; }
    case 'a': case 'strong': case 'em': case 'b': case 'i': case 'code': case 'span': case 'br': {
      const t = inline();
      return t ? `${t}\n\n` : '';
    }
    default: return children();
  }
}

function listItemMd(li: ElNode, ctx: MdCtx, depth: number): string {
  let out = '';
  let pending: Node[] = [];
  const flush = () => {
    if (!pending.length) return;
    const t = pending.map((c) => inlineMd(c, ctx)).join('').replace(/[ \t]+\n/g, '  \n').trim();
    if (t) out += t + '\n\n';
    pending = [];
  };
  for (const c of li.children) {
    if (c.type === 'el' && ['ul', 'ol', 'table', 'pre', 'blockquote', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(c.tag)) {
      flush();
      out += blockMd(c, ctx, depth);
    } else pending.push(c);
  }
  flush();
  return out.replace(/\n{3,}/g, '\n\n');
}

function tableMd(table: ElNode, ctx: MdCtx): string {
  const rows: ElNode[] = [];
  walk(table, (el) => { if (el.tag === 'tr') rows.push(el); });
  if (!rows.length) return '';
  const cells = rows.map((tr) =>
    tr.children.filter((c): c is ElNode => c.type === 'el' && (c.tag === 'td' || c.tag === 'th'))
      .map((td) => td.children.map((c) => inlineMd(c, ctx)).join('').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()));
  const width = Math.max(...cells.map((r) => r.length));
  if (!width) return '';
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const headerIsTh = rows[0]!.children.some((c) => c.type === 'el' && c.tag === 'th');
  const header = headerIsTh ? pad(cells[0]!) : Array(width).fill('');
  const body = (headerIsTh ? cells.slice(1) : cells).map(pad);
  return [
    `| ${header.join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n') + '\n\n';
}

// ------------------------------------------------------------------- crawling

const abs = (href: string, base: string): string | undefined => {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    u.hash = '';
    u.protocol = 'https:';
    return u.toString();
  } catch { return undefined; }
};

/** Help pages are served with a trailing slash; a query string must not get one appended. */
function normalizeHelpUrl(raw: string): string {
  const u = new URL(raw);
  u.search = '';
  if (!u.pathname.endsWith('/') && !/\/help\/api$/.test(u.pathname)) u.pathname += '/';
  return u.toString();
}

function slugFor(url: string): { slug: string; area: 'articles' | 'api' } {
  const path = new URL(url).pathname.replace(/^\/help\/?/, '').replace(/\/$/, '');
  const area = path === 'api' || path.startsWith('api/') ? 'api' : 'articles';
  const rest = area === 'api' ? path.replace(/^api\/?/, '') : path.replace(/^articles\//, '');
  const slug = (rest || (area === 'api' ? 'index' : 'help-home')).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return { slug, area };
}

const isHelpPage = (url: string) => {
  const u = new URL(url);
  if (u.hostname !== HOST) return false;
  if (!u.pathname.startsWith('/help')) return false;
  if (u.pathname.startsWith('/help/assets/')) return false;
  if (/\.(css|js|png|jpe?g|gif|svg|pdf|zip|ico|woff2?)$/i.test(u.pathname)) return false;
  return true;
};

type Article = {
  url: string; slug: string; area: 'articles' | 'api'; title: string;
  timestamp: string; h2s: string[]; images: string[];
};

async function ensureDir(p: string) { await mkdir(p, { recursive: true }); }
async function writeIfNeeded(path: string, data: string | Uint8Array): Promise<boolean> {
  if (!FORCE && existsSync(path)) return false;
  await ensureDir(dirname(path));
  await writeFile(path, data as never);
  return true;
}

const imageQueue = new Map<string, string>(); // absolute original URL -> local filename
// @2x local filename -> @1x local filename, used to downgrade a reference when the
// retina variant turns out not to be archived.
const retinaPair = new Map<string, string>();
// URLs the archive definitively has no capture for; persisted so re-runs don't retry them.
const missesPath = () => join(OUT, '.misses.json');
const knownMisses = new Set<string>();

function localImageName(srcAbs: string): string {
  const name = decodeURIComponent(new URL(srcAbs).pathname.split('/').pop() || 'image');
  return name.replace(/[^a-zA-Z0-9.@_-]+/g, '-');
}

async function processArticle(url: string, discovered: Set<string>): Promise<Article | undefined> {
  const { slug, area } = slugFor(url);
  const htmlPath = join(OUT, area, `${slug}.html`);
  const mdPath = join(OUT, area, `${slug}.md`);

  let html: string;
  let timestamp = '';

  if (!FORCE && existsSync(htmlPath) && existsSync(mdPath)) {
    html = await readFile(htmlPath, 'utf8');
    timestamp = /^<!-- capture: (\d+)/m.exec(html)?.[1] ?? '';
    log.push({ url, kind: area, status: 'skipped' });
  } else {
    const r = await fetchArchived(url);
    if (!r.ok) {
      log.push({ url, kind: area, status: r.reason === 'not-found' ? 'not-found' : 'failed', httpStatus: r.httpStatus, note: r.reason });
      console.log(`  ${r.reason === 'not-found' ? '404' : 'FAIL'} ${url}`);
      return undefined;
    }
    timestamp = r.timestamp ?? '';
    html = r.text();
    log.push({ url, kind: area, status: 'ok', httpStatus: r.httpStatus, bytes: r.body.length, timestamp });
    await writeIfNeeded(htmlPath, `<!-- capture: ${timestamp} source: ${url} -->\n${html}`);
  }

  const doc = parseHtml(html);

  // Discover further help pages from the whole document (the sidebar nav is the TOC).
  for (const el of collectEls(doc)) {
    if (el.tag !== 'a' || !el.attrs.href) continue;
    const u = abs(el.attrs.href, url);
    if (u && isHelpPage(u)) discovered.add(normalizeHelpUrl(u));
  }

  const content =
    find(doc, (el) => el.tag === 'article' && hasClass(el, 'article-content')) ??
    find(doc, (el) => el.tag === 'div' && hasClass(el, 'kb-article')) ??
    find(doc, (el) => el.tag === 'article') ??
    find(doc, (el) => el.tag === 'main') ??
    find(doc, (el) => el.tag === 'body');
  if (!content) return undefined;

  const header = find(doc, (el) => el.tag === 'header' && hasClass(el, 'article-header'));
  const title =
    (header && collapse(textOf(header)).trim()) ||
    collapse(textOf(find(doc, (el) => el.tag === 'title') ?? { type: 'text', text: '' })).trim() ||
    slug;

  // The page templates ship the @2x source only inside commented-out markup, so
  // scan the raw HTML (comments included) for every asset reference first.
  const retina = new Map<string, string>(); // "<base>@" -> absolute @2x URL
  for (const m of html.matchAll(/["'(\s](\/help\/assets\/[^"'\s)<>]+?\.(?:png|jpe?g|gif|svg|webp))/gi)) {
    const u = abs(m[1]!, url);
    if (!u) continue;
    const name = localImageName(u);
    const at = name.indexOf('@2x');
    if (at > 0) retina.set(name.slice(0, at), u);
  }

  const images: string[] = [];
  const queueImage = (u: string): string => {
    const name = localImageName(u);
    imageQueue.set(u, name);
    return name;
  };
  const imageName = (src: string): string | undefined => {
    if (!src || src.startsWith('data:')) return undefined;
    const u = abs(src, url);
    if (!u) return undefined;
    let name = queueImage(u);
    const at = name.indexOf('@1x');
    if (at > 0) {
      const hi = retina.get(name.slice(0, at));
      // Keep the @1x file on disk too, but reference the sharper variant.
      if (hi) { const hiName = queueImage(hi); retinaPair.set(hiName, name); name = hiName; }
    }
    if (!images.includes(name)) images.push(name);
    return name;
  };
  const ctx: MdCtx = {
    imageName,
    linkHref: (href) => {
      const u = abs(href, url);
      if (!u) return href;
      if (isHelpPage(u)) {
        const t = slugFor(u);
        return t.area === area ? `./${t.slug}.md` : `../${t.area}/${t.slug}.md`;
      }
      return u;
    },
  };

  // Queue every @1x/@2x pair the page offers, not just the one we reference.
  for (const el of collectEls(content)) {
    if (el.tag !== 'img') continue;
    for (const raw of [el.attrs.src, el.attrs['data-src'], ...(el.attrs.srcset ?? '').split(',').map((p) => p.trim().split(/\s+/)[0] ?? '')]) {
      if (raw) imageName(raw);
    }
  }

  const h2s = collectEls(content).filter((e) => e.tag === 'h2').map((e) => collapse(textOf(e)).trim()).filter(Boolean);

  let body = blockMd(content, ctx).replace(/\n{3,}/g, '\n\n').trim();
  const front = [
    `<!--`,
    `  Archived copy of Pivotal Tracker help documentation — © Pivotal Software / VMware.`,
    `  Local reference corpus only; not redistributed (see scripts/tracker-corpus/README.md).`,
    `-->`,
    ``,
    `# ${title}`,
    ``,
    `- Source: ${url}`,
    `- Archived: https://web.archive.org/web/${timestamp || PREFERRED_TS}id_/${url}`,
    `- Capture timestamp: ${timestamp || 'unknown'}`,
    ``,
    `---`,
    ``,
  ].join('\n');
  await writeIfNeeded(mdPath, front + body + '\n');

  return { url, slug, area, title, timestamp, h2s, images };
}

function collectEls(node: Node): ElNode[] {
  const out: ElNode[] = [];
  walk(node, (el) => out.push(el));
  return out;
}

// --------------------------------------------------------------------- images

async function fetchImages() {
  const entries = [...imageQueue.entries()];
  console.log(`\nImages referenced: ${entries.length}`);
  let ok = 0, failed = 0, skipped = 0;
  const queue = entries.slice();
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [url, name] = next;
      const path = join(OUT, 'images', name);
      if (!FORCE && existsSync(path)) { skipped++; log.push({ url, kind: 'image', status: 'skipped' }); continue; }
      if (!FORCE && knownMisses.has(url)) { skipped++; log.push({ url, kind: 'image', status: 'not-found', note: 'known miss, not retried' }); continue; }
      const r = await fetchArchived(url);
      if (!r.ok) {
        failed++;
        if (r.reason === 'not-found') knownMisses.add(url);
        log.push({ url, kind: 'image', status: r.reason === 'not-found' ? 'not-found' : 'failed', httpStatus: r.httpStatus, note: r.reason });
        continue;
      }
      await writeIfNeeded(path, r.body);
      ok++;
      log.push({ url, kind: 'image', status: 'ok', bytes: r.body.length, timestamp: r.timestamp });
    }
  });
  await Promise.all(workers);
  console.log(`Images: ${ok} fetched, ${skipped} already present, ${failed} failed`);
  return { ok, skipped, failed, total: entries.length };
}

/**
 * Many pages reference a @2x source that the archive never captured (the retina markup
 * was commented out, so no browser ever requested it). Point those references back at the
 * @1x file that did come down, so no Markdown link dangles.
 */
async function repairRetinaRefs(articles: Article[]) {
  const have = (name: string) => existsSync(join(OUT, 'images', name));
  const downgrade = new Map<string, string>();
  for (const [hi, lo] of retinaPair) if (!have(hi) && have(lo)) downgrade.set(hi, lo);
  if (!downgrade.size) return 0;

  let patched = 0;
  for (const a of articles) {
    const next = a.images.map((n) => downgrade.get(n) ?? n).filter((n) => have(n));
    const path = join(OUT, a.area, `${a.slug}.md`);
    let md: string;
    try { md = await readFile(path, 'utf8'); } catch { continue; }
    let out = md;
    for (const [hi, lo] of downgrade) out = out.split(`../images/${hi}`).join(`../images/${lo}`);
    // Drop image links whose file never arrived at all.
    out = out.replace(/^!\[[^\]]*\]\(\.\.\/images\/([^)]+)\)\s*$/gm, (full, name: string) => (have(name) ? full : ''));
    if (out !== md) { await writeFile(path, out.replace(/\n{3,}/g, '\n\n')); patched++; }
    a.images = [...new Set(next)];
  }
  console.log(`Retina repair: ${downgrade.size} reference(s) downgraded to @1x across ${patched} file(s)`);
  return patched;
}

// ------------------------------------------------------- app CSS/JS asset hunt

type AssetHit = { host: string; path: string; url: string; timestamp: string; bytes: number; mime: string };

async function huntAssets(): Promise<{ hits: AssetHit[]; cdxWorked: boolean; notes: string[] }> {
  const notes: string[] = [];
  const hits: AssetHit[] = [];
  let cdxWorked = false;
  const candidates = new Map<string, string>(); // original URL -> timestamp hint

  const cdxQueries: Array<[string, string]> = [
    ['app assets css', `url=${HOST}/assets/*&collapse=urlkey&fl=original,timestamp,statuscode,mimetype&filter=statuscode:200&filter=mimetype:text/css&from=2018&to=2024&limit=400`],
    ['app assets js', `url=${HOST}/assets/*&collapse=urlkey&fl=original,timestamp,statuscode,mimetype&filter=statuscode:200&filter=mimetype:.*javascript&from=2018&to=2024&limit=400`],
    ['app routes /n/', `url=${HOST}/n/*&collapse=urlkey&fl=original,timestamp,statuscode&filter=statuscode:200&from=2018&to=2024&limit=100`],
    ['app routes /projects/', `url=${HOST}/projects/*&collapse=urlkey&fl=original,timestamp,statuscode&filter=statuscode:200&from=2018&to=2024&limit=100`],
  ];
  for (const [label, q] of cdxQueries) {
    const rows = await cdx(q, label);
    if (rows.length) cdxWorked = true;
    for (const row of rows) {
      const [original, ts] = row;
      if (original && ts) candidates.set(original, ts);
    }
  }

  // Independent of CDX: fetch the app entry pages and read their <link>/<script> refs.
  const entryPages = [`${ORIGIN}/dashboard`, `${ORIGIN}/signin`, `${ORIGIN}/n/projects`, `${ORIGIN}/`];
  for (const page of entryPages) {
    const r = await fetchArchived(page);
    if (!r.ok) {
      console.log(`  entry ${page}: ${r.reason}`);
      log.push({ url: page, kind: 'app-page', status: r.reason === 'not-found' ? 'not-found' : 'failed', note: r.reason });
      continue;
    }
    console.log(`  entry ${page}: ok ${r.body.length} bytes @ ${r.timestamp}`);
    log.push({ url: page, kind: 'app-page', status: 'ok', bytes: r.body.length, timestamp: r.timestamp });
    const { slug } = { slug: new URL(page).pathname.replace(/\//g, '_') || '_root' };
    await writeIfNeeded(join(OUT, 'assets', 'pages', `${slug}.html`), r.text());
    for (const el of collectEls(parseHtml(r.text()))) {
      const href = el.tag === 'link' && /stylesheet/i.test(el.attrs.rel ?? '') ? el.attrs.href
        : el.tag === 'script' ? el.attrs.src : undefined;
      if (!href) continue;
      const u = abs(href, page);
      if (u && !u.includes('web.archive.org') && /\.(css|js)(\?|$)/i.test(u)) candidates.set(u, r.timestamp ?? PREFERRED_TS);
    }
  }

  console.log(`Asset candidates: ${candidates.size}`);
  const list = [...candidates.entries()].slice(0, 200);
  for (const [url, ts] of list) {
    let host: string, path: string;
    try { const u = new URL(url); host = u.hostname; path = u.pathname.replace(/^\//, '') || 'index'; if (path.endsWith('/')) path += 'index'; }
    catch { continue; }
    // Flatten the path to one filename: CDX returns deep, junk-laden app URLs whose prefixes
    // collide as file-vs-directory. Long names are cut and suffixed with a hash of the full path.
    let flat = path.replace(/[^a-zA-Z0-9.@_-]+/g, '__');
    if (flat.length > 150) flat = flat.slice(0, 120) + '-' + Bun.hash(path).toString(16) + (path.match(/\.(css|js)$/)?.[0] ?? '');
    const outPath = join(OUT, 'assets', host, flat);
    if (!FORCE && existsSync(outPath)) {
      const bytes = (await readFile(outPath)).length;
      hits.push({ host, path, url, timestamp: ts, bytes, mime: path.endsWith('.css') ? 'text/css' : 'application/javascript' });
      continue;
    }
    const r = await rawFetch(wb(url, ts), 3, 3000);
    if (!r.ok) { log.push({ url, kind: 'asset', status: r.reason === 'not-found' ? 'not-found' : 'failed', note: r.reason }); continue; }
    await writeIfNeeded(outPath, r.body);
    log.push({ url, kind: 'asset', status: 'ok', bytes: r.body.length, timestamp: r.timestamp });
    hits.push({ host, path, url, timestamp: r.timestamp ?? ts, bytes: r.body.length, mime: path.endsWith('.css') ? 'text/css' : 'application/javascript' });
  }
  if (!cdxWorked) notes.push('The Wayback CDX index was unavailable for every query in this run (it returned the "Temporarily Offline" page). Asset discovery fell back to parsing archived app entry pages only — re-run later for a fuller sweep.');
  return { hits, cdxWorked, notes };
}

async function writeAssetsReadme(res: { hits: AssetHit[]; cdxWorked: boolean; notes: string[] }) {
  const lines: string[] = [
    '# Archived Pivotal Tracker assets',
    '',
    'Generated by `bun scripts/tracker-corpus/fetch.ts`. Pivotal Software / VMware copyrighted material — local reference only, never committed.',
    '',
  ];
  for (const n of res.notes) lines.push(`> ${n}`, '');

  const css = res.hits.filter((h) => h.path.endsWith('.css'));
  const js = res.hits.filter((h) => !h.path.endsWith('.css'));

  const appish = (h: AssetHit) => /\/(assets|packs)\//.test('/' + h.path) && !/^help\//.test(h.path);
  lines.push(`Found ${res.hits.length} asset files (${css.length} CSS, ${js.length} JS).`, '');

  if (!res.hits.length) {
    lines.push('**No CSS/JS assets could be retrieved in this run.**', '');
  }

  lines.push('## CSS files', '');
  if (!css.length) lines.push('_None retrieved._', '');
  for (const h of css) {
    const text = await readFile(join(OUT, 'assets', h.host, h.path.replace(/[^a-zA-Z0-9./@_-]+/g, '-')), 'utf8').catch(() => '');
    const fams = [...new Set([...text.matchAll(/font-family\s*:\s*([^;}"']+)/gi)].map((m) => m[1]!.trim()))].slice(0, 20);
    const sizes = [...new Set([...text.matchAll(/font-size\s*:\s*([^;}]+)/gi)].map((m) => m[1]!.trim()))].sort().slice(0, 60);
    const lh = [...new Set([...text.matchAll(/line-height\s*:\s*([^;}]+)/gi)].map((m) => m[1]!.trim()))].sort().slice(0, 60);
    lines.push(
      `### ${h.host}/${h.path}`,
      '',
      `- Archived: ${h.timestamp} · ${h.bytes} bytes`,
      `- Source: ${h.url}`,
      `- Looks like: ${appish(h) ? 'possibly the app UI bundle (under /assets/)' : 'marketing / help site stylesheet'}`,
      `- font-family declarations (${fams.length}): ${fams.length ? fams.map((f) => `\`${f}\``).join(', ') : 'none'}`,
      `- distinct font-size values (${sizes.length}): ${sizes.length ? sizes.join(', ') : 'none'}`,
      `- distinct line-height values (${lh.length}): ${lh.length ? lh.join(', ') : 'none'}`,
      '',
    );
  }
  lines.push('## JS files', '');
  if (!js.length) lines.push('_None retrieved._', '');
  for (const h of js) lines.push(`- \`${h.host}/${h.path}\` — ${h.bytes} bytes, archived ${h.timestamp}`);
  lines.push('');

  const appHits = res.hits.filter(appish);
  lines.push('## Verdict', '',
    appHits.length
      ? `${appHits.length} file(s) sit under the app's \`/assets/\` path and may be the logged-in UI bundle — inspect them before trusting that.`
      : 'No asset that looks like the logged-in Tracker application UI bundle was retrieved. The archived pages reachable here are the marketing site, the help site and the sign-in page; the application itself was behind auth and its bundles are not in the archive as far as this run could tell.',
    '');
  await writeFile(join(OUT, 'assets', 'README.md'), lines.join('\n'));
}

// ------------------------------------------------------------------------ run

async function main() {
  const started = Date.now();
  await ensureDir(OUT);
  console.log(`Output: ${OUT}${FORCE ? ' (--force)' : ''}`);

  const seeds = new Set<string>([`${ORIGIN}/help/`, `${ORIGIN}/help/articles/quick_start/`, `${ORIGIN}/help/api`]);

  // CDX gives completeness beyond what the in-page nav links to.
  const cdxRows = await cdx(
    `url=${HOST}/help/articles/*&collapse=urlkey&fl=original,timestamp,statuscode&filter=statuscode:200`,
    'help articles',
  );
  for (const row of cdxRows) {
    const original = row[0];
    if (!original) continue;
    const u = abs(original, ORIGIN);
    if (u && isHelpPage(u)) seeds.add(normalizeHelpUrl(u));
  }

  const visited = new Set<string>();
  const articles: Article[] = [];
  let frontier = [...seeds];

  while (frontier.length) {
    const batch = frontier.filter((u) => !visited.has(u));
    batch.forEach((u) => visited.add(u));
    if (!batch.length) break;
    console.log(`\nCrawling ${batch.length} page(s) (visited ${visited.size - batch.length})`);

    const discovered = new Set<string>();
    const queue = batch.slice();
    let done = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const url = queue.shift();
        if (!url) return;
        const a = await processArticle(url, discovered);
        if (a) articles.push(a);
        if (++done % 25 === 0) console.log(`  ...${done}/${batch.length}`);
      }
    }));
    frontier = [...discovered].filter((u) => !visited.has(u));
  }

  try { for (const u of JSON.parse(await readFile(missesPath(), 'utf8')) as string[]) knownMisses.add(u); } catch { /* first run */ }
  const imgStats = await fetchImages();
  await repairRetinaRefs(articles);
  await writeFile(missesPath(), JSON.stringify([...knownMisses].sort(), null, 0) + '\n');

  console.log('\nHunting for app CSS/JS assets...');
  const assetRes = await huntAssets();
  await writeAssetsReadme(assetRes);

  // index.md
  articles.sort((a, b) => (a.area === b.area ? a.slug.localeCompare(b.slug) : a.area.localeCompare(b.area)));
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const idx: string[] = [
    '# Pivotal Tracker help corpus',
    '',
    'Generated by `bun scripts/tracker-corpus/fetch.ts`. Archived from the Wayback Machine.',
    'Pivotal Software / VMware copyrighted material — local reference only, kept out of git.',
    '',
    `Generated: ${new Date().toISOString()} · ${articles.length} pages · ${imgStats.total} images referenced`,
    '',
    '| slug | title | capture | images | h2 headings |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const a of articles) {
    const year = a.timestamp.slice(0, 4);
    const cap = year && year !== '2024' ? `${a.timestamp} (⚠ ${year})` : a.timestamp || 'unknown';
    const link = `[${a.slug}](./${a.area}/${a.slug}.md)`;
    idx.push(`| ${link} | ${esc(a.title)} | ${cap} | ${a.images.length} | ${esc(a.h2s.join('; ')) || '—'} |`);
  }
  await writeFile(join(OUT, 'index.md'), idx.join('\n') + '\n');

  await writeFile(join(OUT, 'fetch-log.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    durationSec: Math.round((Date.now() - started) / 1000),
    counts: {
      pagesOk: log.filter((l) => l.kind !== 'image' && l.kind !== 'asset' && l.kind !== 'cdx' && l.status === 'ok').length,
      pagesSkipped: log.filter((l) => l.kind !== 'image' && l.kind !== 'asset' && l.kind !== 'cdx' && l.status === 'skipped').length,
      pagesFailed: log.filter((l) => l.kind !== 'image' && l.kind !== 'asset' && l.kind !== 'cdx' && l.status !== 'ok' && l.status !== 'skipped').length,
      images: imgStats,
      assets: assetRes.hits.length,
      cdxAvailable: assetRes.cdxWorked || cdxRows.length > 0,
    },
    entries: log,
  }, null, 2) + '\n');

  const failed = log.filter((l) => l.status === 'failed').length;
  const notFound = log.filter((l) => l.status === 'not-found').length;
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s: ${articles.length} pages, ${imgStats.total} images, ${assetRes.hits.length} assets, ${failed} failed, ${notFound} not found.`);
}

await main();
