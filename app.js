import { firebaseConfig as fileConfig } from './firebase-config.js';

/* Firebase config: file → setup link (#setup=…) → pasted in Settings (localStorage) */
const CFG_KEY = 'shelfmark:fbconfig';
function parseConfig(text) {
  if (!text) return null;
  try { const j = JSON.parse(text); if (j.apiKey) return j; } catch {}
  const out = {};
  for (const m of text.matchAll(/["']?(\w+)["']?\s*:\s*["']([^"']+)["']/g)) out[m[1]] = m[2];
  return out.apiKey && out.projectId ? out : null;
}
function loadConfig() {
  if (fileConfig?.apiKey) return fileConfig;
  const m = location.hash.match(/setup=([^&]+)/);
  if (m) {
    try {
      const c = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
      if (c.apiKey) localStorage.setItem(CFG_KEY, JSON.stringify(c));
    } catch {}
    history.replaceState(null, '', location.pathname + location.search);
  }
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch { return null; }
}
const firebaseConfig = loadConfig();

const VERSION = '1.1.0';
const LS_KEY = 'shelfmark:v1';
const FIREBASE_V = '10.12.2';
const DEFAULT_SOURCES = ['AsuraNovels', 'WebNovel', 'LightWebNovelReads', 'AO3', 'Royal Road', 'ScribbleHub', 'Other'];
const SOURCE_HINTS = [
  [/asura/i, 'AsuraNovels'],
  [/webnovel\.com/i, 'WebNovel'],
  [/lightwebnovel|lightnovel|novelreads/i, 'LightWebNovelReads'],
  [/archiveofourown|(^|\.)ao3\./i, 'AO3'],
  [/royalroad/i, 'Royal Road'],
  [/scribblehub/i, 'ScribbleHub'],
];
const STATUSES = [
  ['reading', 'Reading'], ['planned', 'Plan to read'], ['completed', 'Completed'],
  ['onhold', 'On hold'], ['dropped', 'Dropped'],
];
const STATUS_LABEL = Object.fromEntries(STATUSES);
const KINDS = ['novels', 'logs'];

/* ---------------- utils ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const pad = (n) => String(n).padStart(2, '0');
const dayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); };
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
const nf = new Intl.NumberFormat();
const num = (n) => nf.format(Math.round(n || 0));
const compact = (n) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const clean = (o) => JSON.parse(JSON.stringify(o));
const prettyDay = (s) => parseDay(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: s.slice(0, 4) === String(new Date().getFullYear()) ? undefined : 'numeric' });

/* ---------------- state ---------------- */
let state = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && s.novels && s.logs) {
      s.settings = { defaultWpc: 2000, sources: DEFAULT_SOURCES, updatedAt: 0, ...(s.settings || {}) };
      return s;
    }
  } catch {}
  return { novels: {}, logs: {}, settings: { defaultWpc: 2000, sources: DEFAULT_SOURCES, updatedAt: 0 } };
}
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save locally: ' + e.message); }
}
const novels = () => Object.values(state.novels).filter((n) => !n.deleted);
const logs = () => Object.values(state.logs).filter((l) => !l.deleted && state.novels[l.novelId] && !state.novels[l.novelId].deleted);
const wpcOf = (n) => n?.wpc || state.settings.defaultWpc || 2000;
const wordsOf = (l) => l.chapters * wpcOf(state.novels[l.novelId]);

function put(kind, obj, { silent } = {}) {
  obj.updatedAt = Date.now();
  state[kind][obj.id] = obj;
  persist();
  cloudPut(kind, obj);
  if (!silent) render();
}
function putSettings(patch) {
  state.settings = { ...state.settings, ...patch, updatedAt: Date.now() };
  persist();
  cloudPutSettings();
  render();
}

/* ---------------- domain actions ---------------- */
function logChapters(novelId, delta, day = dayStr(), { backfill = false } = {}) {
  const n = state.novels[novelId];
  if (!n || !delta) return null;
  if (delta > 0 && n.totalChapters) delta = Math.min(delta, n.totalChapters - (n.chaptersRead || 0));
  if (!delta) return null;
  const before = { ...n };
  const log = { id: newId(), novelId, day, chapters: delta, backfill, createdAt: Date.now() };
  put('logs', log, { silent: true });
  const upd = { ...n, chaptersRead: Math.max(0, (n.chaptersRead || 0) + delta) };
  if (!backfill) upd.lastReadAt = Date.now();
  if (delta > 0 && !upd.startedAt) upd.startedAt = day;
  if (delta > 0 && (upd.status === 'planned' || upd.status === 'onhold')) upd.status = 'reading';
  if (upd.totalChapters && upd.chaptersRead >= upd.totalChapters && upd.status === 'reading') {
    upd.status = 'completed';
    upd.finishedAt = upd.finishedAt || day;
  }
  put('novels', upd);
  return { log, before };
}
function undoLog(res) {
  if (!res) return;
  put('logs', { ...state.logs[res.log.id], deleted: true }, { silent: true });
  put('novels', { ...state.novels[res.before.id], chaptersRead: res.before.chaptersRead, status: res.before.status, finishedAt: res.before.finishedAt ?? null, lastReadAt: res.before.lastReadAt ?? null });
}
function deleteLog(id) {
  const l = state.logs[id];
  if (!l) return;
  const n = state.novels[l.novelId];
  put('logs', { ...l, deleted: true }, { silent: true });
  if (n) put('novels', { ...n, chaptersRead: Math.max(0, (n.chaptersRead || 0) - l.chapters) }, { silent: true });
  render();
}
function deleteNovel(id) {
  const n = state.novels[id];
  if (!n) return;
  Object.values(state.logs).filter((l) => l.novelId === id && !l.deleted).forEach((l) => put('logs', { ...l, deleted: true }, { silent: true }));
  put('novels', { ...n, deleted: true });
}
function detectSource(url) {
  if (!url) return null;
  let host = url;
  try { host = new URL(url).hostname; } catch {}
  const hit = SOURCE_HINTS.find(([re]) => re.test(host));
  if (!hit) return null;
  return state.settings.sources.includes(hit[1]) ? hit[1] : null;
}

/* ---------------- UI: navigation ---------------- */
let currentView = 'library';
function show(view) {
  currentView = view;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#fab').classList.toggle('hidden', view !== 'library');
  render();
  window.scrollTo({ top: 0 });
}
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="add"]')) openNovel();
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
});
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.fn(); t.classList.remove('show'); };
    t.appendChild(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2600);
}

/* ---------------- Library ---------------- */
const lib = { status: 'reading', source: 'all', q: '', sort: 'updated' };
$('#search').addEventListener('input', (e) => { lib.q = e.target.value.trim().toLowerCase(); renderLibrary(); });
$('#sort').addEventListener('change', (e) => { lib.sort = e.target.value; renderLibrary(); });

function renderLibrary() {
  const all = novels();
  const statusCounts = { all: all.length };
  all.forEach((n) => (statusCounts[n.status] = (statusCounts[n.status] || 0) + 1));
  $('#statusChips').innerHTML = [['all', 'All'], ...STATUSES]
    .map(([k, label]) => `<button class="chip ${lib.status === k ? 'active' : ''}" data-status="${k}">${label}<span class="n">${statusCounts[k] || 0}</span></button>`).join('');
  $$('#statusChips .chip').forEach((c) => (c.onclick = () => { lib.status = c.dataset.status; renderLibrary(); }));

  const srcs = [...new Set(all.map((n) => n.source).filter(Boolean))];
  $('#sourceChips').classList.toggle('hidden', srcs.length < 2);
  if (!srcs.includes(lib.source)) lib.source = 'all';
  $('#sourceChips').innerHTML = ['all', ...srcs]
    .map((s) => `<button class="chip ${lib.source === s ? 'active' : ''}" data-source="${esc(s)}">${s === 'all' ? 'All sources' : esc(s)}</button>`).join('');
  $$('#sourceChips .chip').forEach((c) => (c.onclick = () => { lib.source = c.dataset.source; renderLibrary(); }));

  let list = all.filter((n) =>
    (lib.status === 'all' || n.status === lib.status) &&
    (lib.source === 'all' || n.source === lib.source) &&
    (!lib.q || [n.title, n.author, n.source, ...(n.tags || [])].join(' ').toLowerCase().includes(lib.q)));
  const pct = (n) => (n.totalChapters ? n.chaptersRead / n.totalChapters : -1);
  const sorters = {
    updated: (a, b) => (b.lastReadAt || b.updatedAt || 0) - (a.lastReadAt || a.updatedAt || 0),
    title: (a, b) => a.title.localeCompare(b.title),
    progress: (a, b) => pct(b) - pct(a),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
  };
  list.sort(sorters[lib.sort]);

  $('#emptyLib').classList.toggle('hidden', all.length > 0);
  $('#novelList').innerHTML = list.length || !all.length ? list.map(novelCard).join('')
    : `<li class="empty">Nothing here${lib.q ? ' for that search' : ''}.</li>`;
}
function novelCard(n) {
  const total = n.totalChapters;
  const p = total ? Math.min(100, (n.chaptersRead / total) * 100) : 0;
  const stars = n.rating ? '★'.repeat(n.rating) : '';
  const words = (n.chaptersRead || 0) * wpcOf(n);
  return `<li class="novel" data-id="${n.id}">
    <div class="novel-main" data-edit="${n.id}">
      <h3 class="novel-title">${esc(n.title)}</h3>
      <div class="novel-meta">
        ${n.source ? `<span class="badge">${esc(n.source)}</span>` : ''}
        ${lib.status === 'all' ? `<span class="badge status">${STATUS_LABEL[n.status] || ''}</span>` : ''}
        ${n.author ? `<span>${esc(n.author)}</span>` : ''}
        ${stars ? `<span>${stars}</span>` : ''}
        ${n.url ? `<a class="link-out" href="${esc(n.url)}" target="_blank" rel="noopener" data-stop>Open ↗</a>` : ''}
      </div>
    </div>
    <div class="novel-actions">
      <button class="plus alt" data-log="${n.id}" aria-label="Log chapters">Log</button>
      <button class="plus" data-plus="${n.id}" aria-label="Plus one chapter">+1</button>
    </div>
    <div class="progress">
      <div class="track ${total ? '' : 'unknown'}"><i style="width:${p}%"></i></div>
      <span class="progress-text">Ch ${num(n.chaptersRead || 0)}${total ? ' / ' + num(total) : ''} · ${compact(words)} words</span>
    </div>
  </li>`;
}
$('#novelList').addEventListener('click', (e) => {
  if (e.target.closest('[data-stop]')) return;
  const plus = e.target.closest('[data-plus]');
  if (plus) {
    const res = logChapters(plus.dataset.plus, 1);
    if (!res) return toast('Already on the last chapter — update total chapters if more are out');
    toast(`+1 chapter · ${state.novels[plus.dataset.plus].title}`, { label: 'Undo', fn: () => undoLog(res) });
    return;
  }
  const log = e.target.closest('[data-log]');
  if (log) return openLog(log.dataset.log);
  const ed = e.target.closest('[data-edit]');
  if (ed) openNovel(ed.dataset.edit);
});

/* ---------------- Novel dialog ---------------- */
const nd = $('#novelDialog');
const nf_ = $('#novelForm');
function fillSourceOptions(selected) {
  const opts = [...state.settings.sources];
  if (selected && !opts.includes(selected)) opts.push(selected);
  nf_.source.innerHTML = opts.map((s) => `<option ${s === selected ? 'selected' : ''}>${esc(s)}</option>`).join('');
}
function openNovel(id) {
  const n = id ? state.novels[id] : null;
  nf_.reset();
  $('#novelDialogTitle').textContent = n ? 'Edit novel' : 'Add novel';
  $('#deleteNovel').classList.toggle('hidden', !n);
  fillSourceOptions(n?.source || state.settings.sources[0]);
  nf_.id.value = n?.id || '';
  nf_.url.value = n?.url || '';
  nf_.title.value = n?.title || '';
  nf_.author.value = n?.author || '';
  nf_.status.value = n?.status || 'reading';
  nf_.rating.value = String(n?.rating || 0);
  nf_.chaptersRead.value = n?.chaptersRead ?? 0;
  nf_.totalChapters.value = n?.totalChapters ?? '';
  nf_.wpc.value = n?.wpc || state.settings.defaultWpc;
  nf_.totalWords.value = n?.totalWords ?? '';
  nf_.tags.value = (n?.tags || []).join(', ');
  nf_.notes.value = n?.notes || '';
  updateNovelHints();
  nd.showModal();
  if (!n) nf_.url.focus();
}
function updateNovelHints() {
  const editing = !!nf_.id.value;
  $('#backfillHint').textContent = editing
    ? 'Changing "Chapters read" logs the difference as today\'s reading.'
    : (int(nf_.chaptersRead.value) > 0 ? 'Chapters already read count toward all-time totals, not this week/month.' : '');
  const tw = int(nf_.totalWords.value), tc = int(nf_.totalChapters.value);
  $('#wpcHint').textContent = tw && tc ? `Words/chapter set from total words ÷ total chapters.` : '';
}
nf_.url.addEventListener('input', () => {
  const s = detectSource(nf_.url.value);
  if (s) nf_.source.value = s;
});
['totalWords', 'totalChapters'].forEach((k) => nf_[k].addEventListener('input', () => {
  const tw = int(nf_.totalWords.value), tc = int(nf_.totalChapters.value);
  if (tw && tc) nf_.wpc.value = Math.round(tw / tc);
  updateNovelHints();
}));
nf_.chaptersRead.addEventListener('input', updateNovelHints);
nf_.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = nf_.id.value;
  const prev = id ? state.novels[id] : null;
  const title = nf_.title.value.trim();
  if (!title) return nf_.title.focus();
  const data = {
    id: id || newId(),
    title,
    author: nf_.author.value.trim(),
    url: nf_.url.value.trim(),
    source: nf_.source.value,
    status: nf_.status.value,
    rating: int(nf_.rating.value) || 0,
    totalChapters: int(nf_.totalChapters.value) || null,
    wpc: int(nf_.wpc.value) || state.settings.defaultWpc,
    totalWords: int(nf_.totalWords.value) || null,
    tags: nf_.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    notes: nf_.notes.value.trim(),
  };
  const targetRead = Math.max(0, int(nf_.chaptersRead.value) || 0);
  const today = dayStr();
  if (prev) {
    const merged = { ...prev, ...data };
    if (merged.status === 'completed' && prev.status !== 'completed') merged.finishedAt = merged.finishedAt || today;
    if (merged.status !== 'completed') merged.finishedAt = null;
    put('novels', merged, { silent: true });
    const delta = targetRead - (prev.chaptersRead || 0);
    if (delta) logChapters(prev.id, delta, today);
  } else {
    const created = { ...data, chaptersRead: 0, createdAt: Date.now(), startedAt: data.status === 'planned' ? null : today, finishedAt: data.status === 'completed' ? today : null };
    put('novels', created, { silent: true });
    if (targetRead) logChapters(created.id, targetRead, today, { backfill: true });
    if (lib.status !== 'all' && lib.status !== created.status) lib.status = created.status;
  }
  nd.close();
  render();
  toast(prev ? 'Saved' : 'Added to your shelf');
});
$('#deleteNovel').addEventListener('click', () => {
  const id = nf_.id.value;
  if (!id || !confirm(`Delete "${state.novels[id].title}" and its reading log?`)) return;
  deleteNovel(id);
  nd.close();
  toast('Deleted');
});

/* ---------------- Log dialog ---------------- */
const ld = $('#logDialog');
const lf = $('#logForm');
function openLog(id) {
  const n = state.novels[id];
  lf.reset();
  lf.novelId.value = id;
  $('#logDialogTitle').textContent = n.title;
  lf.chapters.value = 1;
  lf.upTo.value = (n.chaptersRead || 0) + 1;
  lf.date.value = dayStr();
  lf.date.max = dayStr();
  updateLogHint();
  ld.showModal();
}
function updateLogHint() {
  const n = state.novels[lf.novelId.value];
  const c = int(lf.chapters.value) || 0;
  $('#logHint').textContent = n ? `${c >= 0 ? '+' : ''}${c} chapters ≈ ${num(c * wpcOf(n))} words · currently on ch ${num(n.chaptersRead || 0)}` : '';
}
lf.addEventListener('click', (e) => {
  const n = state.novels[lf.novelId.value];
  const step = e.target.closest('[data-step]');
  const set = e.target.closest('[data-set]');
  if (!step && !set) return;
  const c = set ? int(set.dataset.set) : (int(lf.chapters.value) || 0) + int(step.dataset.step);
  lf.chapters.value = c;
  lf.upTo.value = (n.chaptersRead || 0) + c;
  updateLogHint();
});
lf.chapters.addEventListener('input', () => {
  const n = state.novels[lf.novelId.value];
  lf.upTo.value = (n.chaptersRead || 0) + (int(lf.chapters.value) || 0);
  updateLogHint();
});
lf.upTo.addEventListener('input', () => {
  const n = state.novels[lf.novelId.value];
  const u = int(lf.upTo.value);
  if (u !== null) lf.chapters.value = u - (n.chaptersRead || 0);
  updateLogHint();
});
lf.addEventListener('submit', (e) => {
  e.preventDefault();
  const c = int(lf.chapters.value) || 0;
  if (!c) return ld.close();
  const res = logChapters(lf.novelId.value, c, lf.date.value || dayStr());
  ld.close();
  if (!res) return toast('Already on the last chapter — update total chapters if more are out');
  toast(`${c > 0 ? '+' : ''}${res.log.chapters} chapters logged`, { label: 'Undo', fn: () => undoLog(res) });
});

/* ---------------- Recap ---------------- */
const PERIODS = [
  ['week', 'This week'], ['month', 'This month'], ['lastmonth', 'Last month'],
  ['30d', 'Last 30 days'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom'],
];
let period = 'month';
function periodRange(p) {
  const today = dayStr();
  const d = new Date();
  if (p === 'week') { const dow = (d.getDay() + 6) % 7; return [addDays(today, -dow), today]; }
  if (p === 'month') return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, today];
  if (p === 'lastmonth') {
    const s = new Date(d.getFullYear(), d.getMonth() - 1, 1), e = new Date(d.getFullYear(), d.getMonth(), 0);
    return [dayStr(s), dayStr(e)];
  }
  if (p === '30d') return [addDays(today, -29), today];
  if (p === 'year') return [`${d.getFullYear()}-01-01`, today];
  if (p === 'custom') return [$('#rangeFrom').value || addDays(today, -6), $('#rangeTo').value || today];
  const first = logs().filter((l) => !l.backfill).map((l) => l.day).sort()[0];
  return [first || today, today];
}
$('#rangeFrom').addEventListener('change', renderRecap);
$('#rangeTo').addEventListener('change', renderRecap);

function computeRecap(from, to, allTime) {
  const inRange = logs().filter((l) => l.day >= from && l.day <= to && !l.backfill);
  const backfill = allTime ? logs().filter((l) => l.backfill) : [];
  const counted = [...inRange, ...backfill];
  const chapters = counted.reduce((s, l) => s + l.chapters, 0);
  const words = counted.reduce((s, l) => s + wordsOf(l), 0);
  const backfillCh = backfill.reduce((s, l) => s + l.chapters, 0);

  const perNovel = {};
  counted.forEach((l) => {
    const p = (perNovel[l.novelId] ||= { chapters: 0, words: 0 });
    p.chapters += l.chapters; p.words += wordsOf(l);
  });
  const top = Object.entries(perNovel).filter(([, v]) => v.chapters > 0)
    .map(([id, v]) => ({ n: state.novels[id], ...v })).sort((a, b) => b.chapters - a.chapters);

  const bySource = {};
  top.forEach((t) => (bySource[t.n.source || 'Other'] = (bySource[t.n.source || 'Other'] || 0) + t.words));
  const tags = {};
  top.forEach((t) => (t.n.tags || []).forEach((g) => (tags[g] = (tags[g] || 0) + t.chapters)));

  const perDay = {};
  inRange.forEach((l) => (perDay[l.day] = (perDay[l.day] || 0) + l.chapters));
  const activeDays = Object.keys(perDay).filter((d) => perDay[d] > 0).sort();
  let longest = 0, run = 0, prev = null;
  activeDays.forEach((d) => { run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1; longest = Math.max(longest, run); prev = d; });

  const ns = novels();
  const completed = ns.filter((n) => n.finishedAt && n.finishedAt >= from && n.finishedAt <= to && n.status === 'completed');
  const started = ns.filter((n) => n.startedAt && n.startedAt >= from && n.startedAt <= to);
  const spanDays = Math.max(1, daysBetween(from, to < dayStr() ? to : dayStr()) + 1);

  return { from, to, chapters, words, backfillCh, top, bySource, tags, perDay, activeDays, longest, completed, started, spanDays, inRangeCh: chapters - backfillCh };
}
function currentStreak() {
  const days = new Set(logs().filter((l) => !l.backfill && l.chapters > 0).map((l) => l.day));
  let d = dayStr();
  if (!days.has(d)) d = addDays(d, -1);
  let s = 0;
  while (days.has(d)) { s++; d = addDays(d, -1); }
  return s;
}
function chartSvg(r) {
  const span = daysBetween(r.from, r.to) + 1;
  let buckets = [];
  if (span <= 62) {
    for (let i = 0; i < span; i++) { const d = addDays(r.from, i); buckets.push({ k: d, v: r.perDay[d] || 0, label: String(parseDay(d).getDate()) }); }
  } else {
    const map = {};
    Object.entries(r.perDay).forEach(([d, v]) => (map[d.slice(0, 7)] = (map[d.slice(0, 7)] || 0) + v));
    let cur = new Date(parseDay(r.from).getFullYear(), parseDay(r.from).getMonth(), 1);
    const end = parseDay(r.to);
    while (cur <= end) {
      const k = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}`;
      buckets.push({ k, v: map[k] || 0, label: cur.toLocaleDateString(undefined, { month: 'short' }) + (cur.getMonth() === 0 ? ` ’${String(cur.getFullYear()).slice(2)}` : '') });
      cur.setMonth(cur.getMonth() + 1);
    }
    if (buckets.length > 36) buckets = buckets.slice(-36);
  }
  const W = 600, H = 160, padB = 20, padT = 14;
  const max = Math.max(1, ...buckets.map((b) => b.v));
  const bw = W / buckets.length;
  const every = Math.ceil(buckets.length / 12);
  const bars = buckets.map((b, i) => {
    const h = (b.v / max) * (H - padB - padT);
    const x = i * bw + bw * 0.15;
    return `<rect class="bar" x="${x.toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(b.v ? 2 : 0, h).toFixed(1)}" rx="2"><title>${esc(b.k)}: ${b.v} ch</title></rect>` +
      (i % every === 0 ? `<text class="axis" x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${esc(b.label)}</text>` : '');
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chapters over time">
    <line class="grid" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>
    <text class="axis" x="0" y="10">${max} ch</text>${bars}</svg>`;
}
function hbars(entries, fmt) {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return `<div class="hbars">${entries.map(([name, v]) => `<div class="hbar"><span class="name">${esc(name)}</span><span class="val">${fmt(v)}</span><div class="track"><i style="width:${(v / max) * 100}%"></i></div></div>`).join('')}</div>`;
}
function renderRecap() {
  $('#periodChips').innerHTML = PERIODS.map(([k, l]) => `<button class="chip ${period === k ? 'active' : ''}" data-p="${k}">${l}</button>`).join('');
  $$('#periodChips .chip').forEach((c) => (c.onclick = () => { period = c.dataset.p; renderRecap(); }));
  $('#customRange').classList.toggle('hidden', period !== 'custom');
  const [from, to] = periodRange(period);
  if (period === 'custom') { $('#rangeFrom').value = from; $('#rangeTo').value = to; }
  const r = computeRecap(from, to, period === 'all');
  const label = PERIODS.find((p) => p[0] === period)[1];
  const rangeTxt = `${prettyDay(from)} – ${prettyDay(to)}`;

  if (!novels().length) { $('#recapBody').innerHTML = `<div class="empty">Add a novel and log some chapters to see your recap.</div>`; return; }

  const hours = r.words / 250 / 60; // ~250 wpm
  $('#recapBody').innerHTML = `
    <div class="recap-hero">
      <div class="label">${esc(label)} · ${esc(rangeTxt)}</div>
      <div class="big">${num(r.words)}</div>
      <div class="sub">words across ${num(r.chapters)} chapters${period === 'all' && r.backfillCh ? ` (incl. ${num(r.backfillCh)} read before tracking)` : ''}</div>
    </div>
    <div class="stats">
      <div class="stat"><b>${r.top.length}</b><span>novels read</span></div>
      <div class="stat"><b>${r.completed.length}</b><span>completed</span></div>
      <div class="stat"><b>${r.started.length}</b><span>started</span></div>
      <div class="stat"><b>${r.activeDays.length}</b><span>reading days</span></div>
      <div class="stat"><b>${(r.inRangeCh / r.spanDays).toFixed(1)}</b><span>chapters / day</span></div>
      <div class="stat"><b>${hours >= 10 ? Math.round(hours) : hours.toFixed(1)}h</b><span>est. reading time</span></div>
      <div class="stat"><b>${r.longest}</b><span>best streak (days)</span></div>
      <div class="stat"><b>${currentStreak()}</b><span>current streak</span></div>
      <div class="stat"><b>${r.top[0] ? num(r.top[0].chapters) : 0}</b><span>most in one novel</span></div>
    </div>
    ${r.activeDays.length ? `<div class="card"><h3>Chapters over time</h3>${chartSvg(r)}</div>` : ''}
    ${r.top.length ? `<div class="card"><h3>Top novels</h3>${hbars(r.top.slice(0, 8).map((t) => [t.n.title, t.chapters]), (v) => num(v) + ' ch')}</div>` : ''}
    ${Object.keys(r.bySource).length ? `<div class="card"><h3>By source</h3>${hbars(Object.entries(r.bySource).sort((a, b) => b[1] - a[1]), (v) => compact(v) + ' words')}</div>` : ''}
    ${Object.keys(r.tags).length ? `<div class="card"><h3>Top tags</h3>${hbars(Object.entries(r.tags).sort((a, b) => b[1] - a[1]).slice(0, 8), (v) => num(v) + ' ch')}</div>` : ''}
    ${r.completed.length ? `<div class="card"><h3>Finished</h3>${r.completed.map((n) => `<div>${esc(n.title)} <span class="muted">· ${n.rating ? '★'.repeat(n.rating) : 'unrated'}</span></div>`).join('')}</div>` : ''}
    <div class="recap-actions">
      <button class="primary" id="copyRecap">Copy recap</button>
      ${navigator.share ? '<button class="ghost" id="shareRecap">Share</button>' : ''}
    </div>`;
  const text = recapText(r, label, rangeTxt);
  $('#copyRecap').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Recap copied'); } catch { toast('Copy failed'); } };
  const sh = $('#shareRecap');
  if (sh) sh.onclick = () => navigator.share({ title: 'Reading recap', text }).catch(() => {});
}
function recapText(r, label, rangeTxt) {
  const lines = [
    `📚 Reading recap — ${label} (${rangeTxt})`,
    `${num(r.words)} words · ${num(r.chapters)} chapters · ${r.top.length} novels`,
    `${r.completed.length} completed · ${r.activeDays.length} reading days · best streak ${r.longest}d`,
  ];
  if (r.top.length) { lines.push('', 'Top reads:'); r.top.slice(0, 5).forEach((t, i) => lines.push(`${i + 1}. ${t.n.title} — ${num(t.chapters)} ch (${t.n.source || '—'})`)); }
  if (r.completed.length) { lines.push('', 'Finished:'); r.completed.forEach((n) => lines.push(`• ${n.title}${n.rating ? ' ' + '★'.repeat(n.rating) : ''}`)); }
  return lines.join('\n');
}

/* ---------------- History ---------------- */
let historyLimit = 60;
function renderHistory() {
  const all = logs().sort((a, b) => (b.day.localeCompare(a.day)) || (b.createdAt - a.createdAt));
  const shown = all.slice(0, historyLimit);
  let html = '', lastDay = null;
  shown.forEach((l) => {
    if (l.day !== lastDay) { html += `<li class="history-day">${esc(prettyDay(l.day))}</li>`; lastDay = l.day; }
    const n = state.novels[l.novelId];
    html += `<li class="history-item"><span class="t">${esc(n.title)}${l.backfill ? ' <span class="muted">· starting point</span>' : ''}</span>
      <span class="c">${l.chapters > 0 ? '+' : ''}${num(l.chapters)} ch · ${compact(wordsOf(l))}w</span>
      <button data-dellog="${l.id}" aria-label="Delete entry">×</button></li>`;
  });
  $('#historyList').innerHTML = html || '<li class="empty">No reading logged yet.</li>';
  $('#moreHistory').classList.toggle('hidden', all.length <= historyLimit);
}
$('#moreHistory').addEventListener('click', () => { historyLimit += 100; renderHistory(); });
$('#historyList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dellog]');
  if (!b) return;
  if (confirm('Delete this entry? The novel\'s chapter count will be adjusted.')) { deleteLog(b.dataset.dellog); toast('Entry deleted'); }
});

/* ---------------- Settings ---------------- */
function renderSettings() {
  $('#defaultWpc').value = state.settings.defaultWpc;
  $('#sourcesInput').value = state.settings.sources.join(', ');
  $('#versionInfo').textContent = `Shelfmark v${VERSION} · ${novels().length} novels · ${logs().length} log entries`;
  const signedIn = !!fb?.user;
  $('#accountInfo').textContent = !firebaseConfig?.apiKey
    ? 'Cloud sync isn\'t set up yet. Your library is stored on this device only. Paste your Firebase config below to enable sign-in and sync.'
    : signedIn ? `Signed in as ${fb.user.email}. Your library syncs across devices.` : 'Sign in with Google to sync your library across devices.';
  $('#settingsSignIn').classList.toggle('hidden', signedIn || !firebaseConfig?.apiKey);
  $('#settingsSignOut').classList.toggle('hidden', !signedIn);
  $('#emailAuth').classList.toggle('hidden', signedIn || !firebaseConfig?.apiKey);
  const fromFile = !!fileConfig?.apiKey;
  $('#setupCard').classList.toggle('hidden', fromFile);
  $('#cfgLink').classList.toggle('hidden', !firebaseConfig?.apiKey);
  $('#cfgClear').classList.toggle('hidden', !firebaseConfig?.apiKey);
  $('#setupInfo').innerHTML = firebaseConfig?.apiKey
    ? `Connected to Firebase project <b>${esc(firebaseConfig.projectId)}</b>. Use "Copy setup link" to set up another device in one tap.`
    : 'Paste the <code>firebaseConfig</code> from your Firebase console (Project settings → Your apps → Web app). Saved on this device only.';
  $('#cfgInput').classList.toggle('hidden', !!firebaseConfig?.apiKey);
  $('#cfgSave').classList.toggle('hidden', !!firebaseConfig?.apiKey);
}
$('#cfgSave').addEventListener('click', () => {
  const c = parseConfig($('#cfgInput').value);
  if (!c) return toast('Could not read that config — paste the whole firebaseConfig block');
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
  location.reload();
});
$('#cfgLink').addEventListener('click', async () => {
  const link = location.origin + location.pathname + '#setup=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(firebaseConfig)))));
  try { await navigator.clipboard.writeText(link); toast('Setup link copied — open it on your other device'); } catch { prompt('Copy this link', link); }
});
$('#cfgClear').addEventListener('click', async () => {
  if (!confirm('Remove cloud config from this device? Your library stays here.')) return;
  if (fb?.user) await fb.A.signOut(fb.auth);
  localStorage.removeItem(CFG_KEY);
  location.reload();
});
async function emailAuth(create) {
  if (!fb) return toast('Cloud sync not ready');
  const email = $('#authEmail').value.trim(), pass = $('#authPass').value;
  if (!email || pass.length < 6) return toast('Enter email and a 6+ character password');
  try {
    await (create ? fb.A.createUserWithEmailAndPassword : fb.A.signInWithEmailAndPassword)(fb.auth, email, pass);
    toast(create ? 'Account created' : 'Signed in');
  } catch (e) { toast('Sign-in failed: ' + e.code); }
}
$('#emailSignIn').addEventListener('click', () => emailAuth(false));
$('#emailSignUp').addEventListener('click', () => emailAuth(true));
$('#saveSettings').addEventListener('click', () => {
  const sources = [...new Set($('#sourcesInput').value.split(',').map((s) => s.trim()).filter(Boolean))];
  putSettings({ defaultWpc: int($('#defaultWpc').value) || 2000, sources: sources.length ? sources : DEFAULT_SOURCES });
  toast('Settings saved');
});
$('#exportBtn').addEventListener('click', () => {
  const data = { app: 'shelfmark', version: VERSION, exportedAt: new Date().toISOString(), settings: state.settings, novels: Object.values(state.novels), logs: Object.values(state.logs) };
  download(`shelfmark-${dayStr()}.json`, JSON.stringify(data, null, 2), 'application/json');
});
$('#exportCsvBtn').addEventListener('click', () => {
  const cols = ['title', 'author', 'source', 'status', 'chaptersRead', 'totalChapters', 'wpc', 'wordsRead', 'rating', 'tags', 'startedAt', 'finishedAt', 'url', 'notes'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = novels().map((n) => cols.map((c) => q(c === 'wordsRead' ? (n.chaptersRead || 0) * wpcOf(n) : c === 'tags' ? (n.tags || []).join('; ') : n[c])).join(','));
  download(`shelfmark-${dayStr()}.csv`, [cols.join(','), ...rows].join('\n'), 'text/csv');
});
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.novels) || !Array.isArray(data.logs)) throw new Error('Not a Shelfmark export');
    let changed = 0;
    KINDS.forEach((k) => data[k].forEach((o) => {
      if (!o?.id) return;
      const cur = state[k][o.id];
      if (!cur || (o.updatedAt || 0) > (cur.updatedAt || 0)) { state[k][o.id] = o; cloudPut(k, o); changed++; }
    }));
    if (data.settings && (data.settings.updatedAt || 0) > (state.settings.updatedAt || 0)) { state.settings = { ...state.settings, ...data.settings }; cloudPutSettings(); }
    persist(); render();
    toast(`Imported ${changed} records`);
  } catch (err) { toast('Import failed: ' + err.message); }
  e.target.value = '';
});
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- Firebase sync ---------------- */
let fb = null; // { auth, db, api, user, unsubs }
function setSync(s) {
  const dot = $('#syncState');
  dot.className = 'sync-dot ' + (s || '');
  dot.title = s === 'on' ? 'Synced' : s === 'busy' ? 'Syncing…' : 'Local only';
}
function renderAccount() {
  const btn = $('#accountBtn');
  btn.classList.remove('hidden');
  if (!firebaseConfig?.apiKey) { btn.textContent = 'Set up sync'; return; }
  btn.textContent = fb?.user ? (fb.user.displayName?.split(' ')[0] || 'Account') : 'Sign in';
}
async function initFirebase() {
  if (!firebaseConfig?.apiKey) return;
  try {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_V}`;
    const [app, auth, fs] = await Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`)]);
    const fapp = app.initializeApp(firebaseConfig);
    fb = { auth: auth.getAuth(fapp), db: fs.getFirestore(fapp), A: auth, F: fs, user: null, unsubs: [] };
    auth.getRedirectResult(fb.auth).catch((e) => toast('Sign-in failed: ' + e.code));
    auth.onAuthStateChanged(fb.auth, (user) => {
      fb.user = user;
      renderAccount(); renderSettings();
      if (user) startSync(); else stopSync();
    });
  } catch (e) {
    console.error(e);
    toast('Cloud sync unavailable (offline?) — working locally');
  }
}
async function signIn() {
  if (!fb) return toast('Cloud sync not ready');
  const provider = new fb.A.GoogleAuthProvider();
  try { await fb.A.signInWithPopup(fb.auth, provider); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) await fb.A.signInWithRedirect(fb.auth, provider);
    else if (e.code !== 'auth/popup-closed-by-user') toast('Sign-in failed: ' + e.code);
  }
}
async function signOutNow() {
  if (!fb?.user) return;
  if (!confirm('Sign out? Your library stays on this device.')) return;
  await fb.A.signOut(fb.auth);
}
const colRef = (kind) => fb.F.collection(fb.db, 'users', fb.user.uid, kind);
const settingsRef = () => fb.F.doc(fb.db, 'users', fb.user.uid, 'meta', 'settings');

async function startSync() {
  setSync('busy');
  const { F } = fb;
  try {
    const toPush = [];
    for (const kind of KINDS) {
      const snap = await F.getDocs(colRef(kind));
      const remote = {};
      snap.forEach((d) => (remote[d.id] = d.data()));
      Object.entries(remote).forEach(([id, r]) => { const l = state[kind][id]; if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) state[kind][id] = r; });
      Object.entries(state[kind]).forEach(([id, l]) => { const r = remote[id]; if (!r || (l.updatedAt || 0) > (r.updatedAt || 0)) toPush.push([kind, l]); });
    }
    const sSnap = await F.getDoc(settingsRef());
    const rs = sSnap.exists() ? sSnap.data() : null;
    if (rs && (rs.updatedAt || 0) > (state.settings.updatedAt || 0)) state.settings = { ...state.settings, ...rs };
    else if (state.settings.updatedAt) await F.setDoc(settingsRef(), clean(state.settings));
    for (let i = 0; i < toPush.length; i += 400) {
      const batch = F.writeBatch(fb.db);
      toPush.slice(i, i + 400).forEach(([k, o]) => batch.set(F.doc(colRef(k), o.id), clean(o)));
      await batch.commit();
    }
    persist(); render();
    fb.unsubs = KINDS.map((kind) => F.onSnapshot(colRef(kind), (snap) => {
      let changed = false;
      snap.docChanges().forEach((ch) => {
        const r = ch.doc.data(), l = state[kind][ch.doc.id];
        if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) { state[kind][ch.doc.id] = r; changed = true; }
      });
      if (changed) { persist(); render(); }
    }));
    fb.unsubs.push(F.onSnapshot(settingsRef(), (d) => {
      const r = d.data();
      if (r && (r.updatedAt || 0) > (state.settings.updatedAt || 0)) { state.settings = { ...state.settings, ...r }; persist(); render(); }
    }));
    setSync('on');
    if (toPush.length) toast(`Synced ${toPush.length} local changes`);
  } catch (e) {
    console.error(e);
    setSync('');
    toast('Sync failed: ' + (e.code || e.message));
  }
}
function stopSync() {
  fb?.unsubs.forEach((u) => u());
  if (fb) fb.unsubs = [];
  setSync('');
}
function cloudPut(kind, obj) {
  if (!fb?.user) return;
  fb.F.setDoc(fb.F.doc(colRef(kind), obj.id), clean(obj)).catch((e) => toast('Cloud save failed: ' + e.code));
}
function cloudPutSettings() {
  if (!fb?.user) return;
  fb.F.setDoc(settingsRef(), clean(state.settings)).catch((e) => toast('Cloud save failed: ' + e.code));
}
$('#accountBtn').addEventListener('click', () => (fb && !fb.user ? signIn() : show('settings')));
$('#settingsSignIn').addEventListener('click', signIn);
$('#settingsSignOut').addEventListener('click', signOutNow);

/* ---------------- render + boot ---------------- */
function render() {
  if (currentView === 'library') renderLibrary();
  if (currentView === 'recap') renderRecap();
  if (currentView === 'history') renderHistory();
  if (currentView === 'settings') renderSettings();
}
window.addEventListener('storage', (e) => { if (e.key === LS_KEY) { state = load(); render(); } });

if (!novels().some((n) => n.status === 'reading')) lib.status = 'all';
renderAccount();
render();
initFirebase();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
