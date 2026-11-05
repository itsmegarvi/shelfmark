// Shelfmark fetcher — Cloudflare Worker (free plan is enough).
// Reads a novel page and returns metadata (title, author, cover, chapters, genres)
// and word counts for sampled chapters. Chapter text is never stored or returned.
//
// Endpoints
//   GET /meta?url=<novel page>            → { title, author, cover, status, genres, totalChapters, chapterUrls, avgWords?, totalWords? }
//   GET /words?u=<chapter>&u=<chapter>…   → { counts: [n, …] }  (max 5 per call)

// Only these sites can be fetched (keeps the Worker from being an open proxy).
const ALLOWED_HOSTS = [
  'asurascans.com', 'asuracomic.net', 'novelcodex.com', 'archiveofourown.org',
  'webnovel.com', 'royalroad.com', 'scribblehub.com',
];
// Pages allowed to call this Worker. Add your own domain if you host Shelfmark elsewhere.
const ALLOWED_ORIGINS = ['https://itsmegarvi.github.io', 'http://localhost:8080', 'http://localhost:8765'];

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const MAX_WORD_URLS = 5;
const MAX_CHAPTER_URLS = 30;

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const json = (data, status = 200, maxAge = 0) => new Response(JSON.stringify(data), {
      status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
    });
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin not allowed' }, 403);

    const url = new URL(req.url);
    try {
      if (url.pathname === '/meta') {
        const target = checkUrl(url.searchParams.get('url'));
        const html = await getPage(target, ctx);
        return json(parseMeta(target, html), 200, 21600);
      }
      if (url.pathname === '/words') {
        const list = url.searchParams.getAll('u').slice(0, MAX_WORD_URLS).map(checkUrl);
        if (!list.length) return json({ error: 'no urls' }, 400);
        const counts = await Promise.all(list.map(async (u) => {
          try { return countChapterWords(await getPage(u, ctx)); } catch { return null; }
        }));
        return json({ counts }, 200, 604800);
      }
      return json({ ok: true, service: 'shelfmark-fetcher', endpoints: ['/meta?url=', '/words?u='] });
    } catch (e) {
      return json({ error: String(e.message || e) }, e.status || 500);
    }
  },
};

function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw Object.assign(new Error('bad url'), { status: 400 }); }
  const host = u.hostname.replace(/^www\./, '');
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
    throw Object.assign(new Error('site not supported: ' + host), { status: 400 });
  }
  if (host.endsWith('archiveofourown.org') && !u.searchParams.has('view_adult')) u.searchParams.set('view_adult', 'true');
  return u;
}

async function getPage(u, ctx) {
  const cache = caches.default;
  const key = new Request(u.toString());
  const hit = await cache.match(key);
  if (hit) return hit.text();
  const res = await fetch(u.toString(), { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
  if (!res.ok) throw Object.assign(new Error(`site returned ${res.status}`), { status: 502 });
  const html = await res.text();
  if (/cf-chl|challenge-platform|Just a moment\.\.\./i.test(html.slice(0, 5000))) throw Object.assign(new Error('blocked by bot check'), { status: 502 });
  ctx.waitUntil(cache.put(key, new Response(html, { headers: { 'Cache-Control': 'public, max-age=86400' } })));
  return html;
}

/* ---------------- parsing helpers ---------------- */
const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const strip = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const meta = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] || '') : '';
};
const uniq = (a) => [...new Set(a.filter(Boolean))];
const toInt = (s) => { const n = parseInt(String(s || '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };
const textOf = (html) => strip(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' '));

function parseMeta(u, html) {
  const host = u.hostname.replace(/^www\./, '');
  const base = {
    source: host,
    url: u.toString().replace(/[?&]view_adult=true/, ''),
    title: meta(html, 'og:title') || strip(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]),
    cover: meta(html, 'og:image') || null,
    description: meta(html, 'og:description') || meta(html, 'description') || '',
    author: meta(html, 'author') || meta(html, 'book:author') || '',
    status: null, genres: [], totalChapters: null, chapterUrls: [],
  };
  if (host.includes('asura')) return { ...base, ...parseAsura(u, html, base) };
  if (host.endsWith('novelcodex.com')) return { ...base, ...parseNovelCodex(html, base) };
  if (host.endsWith('archiveofourown.org')) return { ...base, ...parseAO3(html) };
  return { ...base, chapterUrls: genericChapterUrls(u, html) };
}

function parseAsura(u, html, base) {
  const slug = u.pathname.match(/\/novels\/([^/]+)/)?.[1];
  const nums = uniq([...html.matchAll(new RegExp(`/novels/${slug}/chapter/(\\d+)`, 'g'))].map((m) => +m[1])).sort((a, b) => a - b);
  const text = textOf(html);
  return {
    title: base.title.replace(/\s*[-|]\s*Asura Scans\s*$/i, ''),
    author: decode(decodeURIComponent(html.match(/novels\?author=([^"&'#]+)/)?.[1] || '').replace(/\+/g, ' ')) || base.author,
    genres: uniq([...html.matchAll(/novels\?genres=([^"&'#]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, ' '))),
    status: text.match(/\b(ongoing|completed|hiatus|dropped|season end)\b/i)?.[1]?.toLowerCase() || null,
    totalChapters: toInt(text.match(/(\d[\d,]*)\s*Chapters\b/i)?.[1] || text.match(/\bChapters\s*(\d[\d,]*)/i)?.[1]) || (nums.length ? nums[nums.length - 1] : null),
    chapterUrls: nums.slice(0, MAX_CHAPTER_URLS).map((n) => `https://${u.hostname}/novels/${slug}/chapter/${n}`),
  };
}

function parseNovelCodex(html, base) {
  const text = textOf(html);
  const enc = html.match(/static\.novelcodex\.com%2Fbookcover%2F[^"&\s]+/)?.[0];
  const raw = html.match(/https:\/\/static\.novelcodex\.com\/bookcover\/[^"'\s)]+/)?.[0];
  const genreBlock = html.split(/>\s*Genres\s*</i)[1]?.split(/<h[1-6]/i)[0] || '';
  return {
    title: strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || base.title.split(/,| \|/)[0],
    cover: base.cover || (enc ? 'https://' + decodeURIComponent(enc) : raw) || null,
    author: base.author || text.match(/\bAuthor\s+([^\n]{2,40}?)\s{1,}(?:Publisher|Genres|Status|Origin|$)/)?.[1] || '',
    status: text.match(/\b(Completed|Ongoing|Hiatus)\b/)?.[1]?.toLowerCase() || null,
    totalChapters: toInt(text.match(/(\d[\d,]*)\s*Chapters\b/i)?.[1] || text.match(/\bChapters\s*(\d[\d,]*)/i)?.[1]),
    genres: uniq([...genreBlock.matchAll(/>([^<>]{2,30})</g)].map((m) => strip(m[1])).filter((g) => /^[A-Za-z][\w\s&'-]+$/.test(g))).slice(0, 10),
    chapterUrls: [], // tracker only — no chapter text here
    note: 'NovelCodex is a tracker; word counts are not available from it.',
  };
}

function parseAO3(html) {
  const dd = (cls) => strip(html.match(new RegExp(`<dd class="${cls}[^"]*">([\\s\\S]*?)<\\/dd>`, 'i'))?.[1]);
  const words = toInt(dd('words'));
  const [pub, total] = (dd('chapters') || '').split('/');
  const published = toInt(pub);
  return {
    title: strip(html.match(/<h2 class="title heading">([\s\S]*?)<\/h2>/i)?.[1]) || undefined,
    author: uniq([...html.matchAll(/rel="author"[^>]*>([^<]+)</g)].map((m) => decode(m[1]))).join(', '),
    genres: uniq([...(html.match(/<dd class="freeform tags">([\s\S]*?)<\/dd>/i)?.[1] || '').matchAll(/class="tag"[^>]*>([^<]+)</g)].map((m) => decode(m[1]))).slice(0, 8),
    fandom: uniq([...(html.match(/<dd class="fandom tags">([\s\S]*?)<\/dd>/i)?.[1] || '').matchAll(/class="tag"[^>]*>([^<]+)</g)].map((m) => decode(m[1]))),
    status: total && total.trim() !== '?' && toInt(total) === published ? 'completed' : 'ongoing',
    totalChapters: total && total.trim() !== '?' ? toInt(total) : null,
    publishedChapters: published,
    totalWords: words,
    avgWords: words && published ? Math.round(words / published) : null,
    cover: null,
  };
}

function genericChapterUrls(u, html) {
  const links = uniq([...html.matchAll(/href=["']([^"']*chapter[-_/]?\d+[^"']*)["']/gi)].map((m) => {
    try { return new URL(decode(m[1]), u).toString(); } catch { return null; }
  })).filter((l) => new URL(l).hostname === u.hostname);
  const num = (l) => toInt(l.match(/chapter[-_/]?(\d+)/i)?.[1]) ?? 0;
  return links.sort((a, b) => num(a) - num(b)).slice(0, MAX_CHAPTER_URLS);
}

// Count words of a chapter page: sum of <p> text in the body, ignoring nav/header/footer/comments.
function countChapterWords(html) {
  let body = html.replace(/<(script|style|noscript|svg|header|footer|nav|aside|form|button)[\s\S]*?<\/\1>/gi, ' ');
  body = body.replace(/<div[^>]+(?:comment|disqus)[\s\S]*$/i, ' ');
  const paras = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1])).filter((t) => t.length > 1);
  const words = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  let n = paras.reduce((s, p) => s + words(p), 0);
  if (n < 150) { // site uses <br> instead of <p>: fall back to the largest text block
    const blocks = [...body.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)].map((m) => words(strip(m[1])));
    n = Math.max(n, ...blocks, 0);
  }
  return n;
}
