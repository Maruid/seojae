// 소설 목록 (#/novels) · 회차 목록 (#/n/<id>)
import { html, mount, onAction, toast } from '../lib/dom.js';
import { errorMessage } from '../lib/supabase.js';
import { loadNovels, cachedNovels, novelById, loadChapters, cachedChapters, chapterSortDesc, setChapterSortDesc } from '../lib/novels.js';
import { chapterNoLabel, chapterRest, chapterTitleLine, chapterTotal, continueTarget, lastOpened, filterNovels, genresOf,
  parseQuery, matchNovel, novelStatus, sortNovels, hasNew } from '../lib/novelText.js';
import { coverUrl, signCovers } from '../lib/covers.js';
import { latestOf, contCached, resolveCont } from '../lib/continue.js';
import { coverBox } from '../components/cover.js';
import { attachScrollJump } from '../components/scrollJump.js';
import { loadReading, novelReading, statusOf } from '../lib/progress.js';
import { fmtDate } from '../lib/columns.js';
import { icon } from '../components/icons.js';

export const chapterHref = (nid, key) => `#/n/${encodeURIComponent(nid)}/${encodeURIComponent(key)}`;

// 표지 상자는 홈과 같이 씀
export { coverBox };

// ---------------------------------------------------------------------
// #/novels  — 보기 3종(카드 · 작은 카드 · 리스트) · 검색 · 필터 창
// ---------------------------------------------------------------------
const FILTER_KEY = 'ui:nvFilter';
const VIEW_KEY = 'ui:nvView';
const DEF = { q: '', genres: [], tags: [], status: 'all', sort: 'recent' };
const STATUS = [['all', '전체'], ['reading', '읽는 중'], ['unread', '안 읽음'], ['read', '다 읽음'], ['new', '새 회차 있음']];
const SORTS = [['recent', '최근 읽은 순'], ['added', '최근 추가 순'], ['title', '제목 순'], ['count', '회차 많은 순']];
const VIEWS = [['card', '카드', 'grid'], ['small', '작은 카드', 'grid3'], ['list', '리스트', 'list']];
const readFilter = () => {
  try {
    const f = JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}');
    return { ...DEF, ...f, genres: f.genres || (f.genre ? [f.genre] : []), tags: f.tags || [] };
  } catch { return { ...DEF }; }
};
const saveFilter = (f) => { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch {} };
const readView = () => { try { return localStorage.getItem(VIEW_KEY) || 'card'; } catch { return 'card'; } };

export function renderNovels(view, query = {}) {
  let list = cachedNovels();
  let error = null;
  let filter = readFilter();
  if (query.status) { filter = { ...DEF, status: query.status }; saveFilter(filter); history.replaceState(null, '', '#/novels'); }
  let mode = readView();
  let sheet = false;
  let tagQ = '';

  const openedOf = (n) => lastOpened(novelReading(n.id));
  const statusOk = (n) => {
    if (filter.status === 'all') return true;
    if (filter.status === 'new') return hasNew(n, openedOf(n));
    return novelStatus(n, novelReading(n.id)) === filter.status;
  };

  mount(view, html`
    <header class="h-16 px-5 lg:px-12 lg:pt-6 flex items-center gap-2">
      <h1 class="m-0 flex-1 text-[22px] font-bold">소설</h1>
      <div class="nv-views" role="group" aria-label="보기" data-slot="views"></div>
    </header>
    <div class="px-5 lg:px-12 max-w-[1180px] flex flex-col gap-2.5">
      <div class="nv-searchrow">
        <label class="nv-search">${icon('search', 18)}<span class="sr-only">소설 검색</span>
          <input type="search" data-input="q" value="${filter.q}" placeholder="제목·작가·장르·#태그" enterkeyhint="search" autocomplete="off"></label>
        <button type="button" class="nv-filterbtn" data-action="sheet" data-slot="fbtn" aria-haspopup="dialog"></button>
      </div>
      <div data-slot="chips"></div>
    </div>
    <div class="px-5 lg:px-12 pb-10 pt-3 max-w-[1180px]" data-slot="list"></div>
    <div data-slot="sheet"></div>`);
  const slot = (k) => view.querySelector(`[data-slot="${k}"]`);

  const draw = () => {
    const all = list || [];
    const tokens = parseQuery(filter.q);
    filter.genres = filter.genres.filter((g) => all.some((n) => genresOf(n).includes(g)));
    filter.tags = filter.tags.filter((t) => all.some((n) => (n.tags || []).includes(t)));
    const base = all.filter((n) => matchNovel(n, tokens) && statusOk(n));
    const f = filterNovels(base, filter);
    const items = sortNovels(f.list, filter.sort, openedOf);
    const nCond = filter.genres.length + filter.tags.length + (filter.status !== 'all' ? 1 : 0) + (filter.sort !== DEF.sort ? 1 : 0);

    mount(slot('views'), html`${VIEWS.map(([k, l, ic]) => html`
      <button type="button" data-action="view" data-v="${k}" aria-pressed="${String(mode === k)}" aria-label="${l}로 보기" title="${l}">${icon(ic, 18)}</button>`)}`);
    mount(slot('fbtn'), html`${icon('filter', 18)}<span>필터</span>${nCond ? html`<b>${nCond}</b>` : ''}`);
    const label = (k, arr) => arr.find((x) => x[0] === k)?.[1];
    mount(slot('chips'), nCond || filter.q ? html`
      <div class="nv-active">
        ${filter.status !== 'all' ? html`<button type="button" data-action="rm" data-k="status">${label(filter.status, STATUS)} ×</button>` : ''}
        ${filter.genres.map((g) => html`<button type="button" data-action="rm" data-k="genre" data-v="${g}">${g} ×</button>`)}
        ${filter.tags.map((t) => html`<button type="button" data-action="rm" data-k="tag" data-v="${t}">#${t} ×</button>`)}
        ${filter.sort !== DEF.sort ? html`<button type="button" data-action="rm" data-k="sort">${label(filter.sort, SORTS)} ×</button>` : ''}
        <span class="nv-active-n">${items.length}편</span>
        ${nCond ? html`<button type="button" class="is-clear" data-action="clear">조건 지우기</button>` : ''}
      </div>` : '');

    mount(slot('list'), html`
      ${!list ? html`<p class="text-sm text-muted py-6">${error || '불러오는 중…'}</p>` : ''}
      ${list && !all.length ? html`<p class="text-sm text-muted py-6">아직 올라온 소설이 없어요.</p>` : ''}
      ${list && all.length && !items.length ? html`<p class="text-sm text-muted py-6">조건에 맞는 소설이 없어요.</p>` : ''}
      <div class="nv-grid is-${mode}">${items.map((n) => (mode === 'small' ? smallCard(n) : mode === 'list' ? listRow(n) : bigCard(n)))}</div>`);

    mount(slot('sheet'), sheet ? sheetHtml(f, items.length) : '');
  };

  // ---- 카드 3종 ----
  const progressOf = (n) => {
    const rows = novelReading(n.id);
    const read = Object.entries(rows).filter(([k, r]) => k !== 'intro' && statusOf(r) === 'read').length;
    return { started: Object.keys(rows).length > 0, pct: n.chapter_count ? Math.min(100, Math.round((read / n.chapter_count) * 100)) : 0 };
  };
  const contLink = (n, cls) => {
    const c = contCached(n);
    if (!c || c.done) return '';
    const no = chapterNoLabel(c.chapter) || chapterRest(c.chapter);
    return html`<a href="${chapterHref(n.id, c.chapter.key)}" class="${cls}" aria-label="${n.title} ${no} 이어 읽기">${icon('play', 13)}<span>${no}</span></a>`;
  };
  const newBadge = (n) => {
    const c = contCached(n);
    return c?.newCount ? html`<span class="nv-badge">새 ${c.newCount}</span>` : '';
  };
  const coverLink = (n, cls = '') => {
    const p = progressOf(n);
    return html`
      <a href="#/n/${encodeURIComponent(n.id)}" class="nv-card-link" aria-label="${n.title}">
        ${coverBox(n, { cls })}
        ${newBadge(n)}
        ${p.started ? html`<span class="nv-card-p"><i style="width:${Math.max(3, p.pct)}%"></i></span>` : ''}
      </a>`;
  };
  const genreChips = (n) => (genresOf(n).length ? html`<span class="nv-card-g">${genresOf(n).map((g) => html`<button type="button" data-action="genre-add" data-v="${g}" class="nv-gchip ${filter.genres.includes(g) ? 'is-on' : ''}">${g}</button>`)}</span>` : '');
  const bigCard = (n) => {
    const p = progressOf(n);
    const ntags = n.tags || [];
    return html`
      <article class="nv-card">
        ${coverLink(n)}
        <a href="#/n/${encodeURIComponent(n.id)}" class="nv-card-t">${n.title}</a>
        <span class="nv-card-a">${n.author ? html`<span>${n.author}</span> · ` : ''}${n.chapter_count.toLocaleString()}화${p.started ? ` · ${p.pct}%` : ''}</span>
        ${genreChips(n)}
        ${ntags.length ? html`<span class="nv-card-tags">
          ${ntags.slice(0, 3).map((t) => html`<button type="button" data-action="tag" data-v="${t}" class="${filter.tags.includes(t) ? 'is-on' : ''}">#${t}</button>`)}
          ${ntags.length > 3 ? html`<span>+${ntags.length - 3}</span>` : ''}</span>` : ''}
        ${contLink(n, 'nv-card-go')}
      </article>`;
  };
  const smallCard = (n) => html`
    <article class="nv-card is-small">
      ${coverLink(n, 'is-sm')}
      <a href="#/n/${encodeURIComponent(n.id)}" class="nv-card-t">${n.title}</a>
    </article>`;
  const listRow = (n) => {
    const p = progressOf(n);
    const g = genresOf(n);
    return html`
      <article class="nv-lrow">
        ${coverLink(n, 'is-sm')}
        <a href="#/n/${encodeURIComponent(n.id)}" class="nv-lrow-main">
          <b>${n.title}</b>
          <span>${[n.author, g.join(' · ')].filter(Boolean).join(' · ') || ' '}</span>
          <small>${n.chapter_count.toLocaleString()}화${p.started ? ` · ${p.pct}%` : ''}${(n.tags || []).length ? ` · ${n.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}` : ''}</small>
        </a>
        ${contLink(n, 'nv-lrow-go')}
      </article>`;
  };

  // ---- 필터 창 ----
  const sheetHtml = (f, count) => {
    const chip = (on) => `nv-fchip ${on ? 'is-on' : ''}`;
    const tq = fold(tagQ);
    const tags = f.tags.filter((t) => !tq || fold(t.name).includes(tq));
    return html`
      <div class="nv-sheet-back" data-action="sheet-close"></div>
      <section class="nv-sheet" role="dialog" aria-label="필터">
        <header><strong>필터</strong><button type="button" data-action="reset">초기화</button></header>
        <div class="nv-sheet-body">
          <h3>읽기 상태</h3>
          <div class="nv-fchips">${STATUS.map(([k, l]) => html`<button type="button" class="${chip(filter.status === k)}" data-action="f-status" data-v="${k}" aria-pressed="${String(filter.status === k)}">${l}</button>`)}</div>
          <h3>정렬</h3>
          <div class="nv-fchips">${SORTS.map(([k, l]) => html`<button type="button" class="${chip(filter.sort === k)}" data-action="f-sort" data-v="${k}" aria-pressed="${String(filter.sort === k)}">${l}</button>`)}</div>
          <h3>장르 <small>여러 개 고르면 모두 포함</small></h3>
          <div class="nv-fchips">${f.genres.length ? f.genres.map((g) => { const on = filter.genres.includes(g.name); return html`<button type="button" class="${chip(on)}" data-action="genre" data-v="${g.name}" aria-pressed="${String(on)}" ${!on && !g.count ? 'disabled' : ''}>${g.name} <span>${g.count}</span></button>`; }) : html`<span class="nv-fnone">장르가 아직 없어요</span>`}</div>
          <h3>태그 <small>여러 개 고르면 모두 포함</small></h3>
          ${f.tags.length > 12 ? html`<input class="nv-ftagq" data-input="tagq" value="${tagQ}" placeholder="태그 찾기" autocomplete="off">` : ''}
          <div class="nv-fchips" data-slot="ftags">${tagChips(tags)}</div>
        </div>
        <footer><button type="button" class="is-main" data-action="sheet-close">${count.toLocaleString()}편 보기</button></footer>
      </section>`;
  };
  const tagChips = (tags) => (tags.length
    ? tags.map((t) => { const on = filter.tags.includes(t.name); return html`<button type="button" class="nv-fchip ${on ? 'is-on' : ''}" data-action="tag" data-v="${t.name}" aria-pressed="${String(on)}" ${!on && !t.count ? 'disabled' : ''}>#${t.name} <span>${t.count}</span></button>`; })
    : html`<span class="nv-fnone">${tagQ ? '맞는 태그가 없어요' : '태그가 아직 없어요'}</span>`);
  const fold = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

  const set = (patch) => { filter = { ...filter, ...patch }; saveFilter(filter); draw(); };
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const keepSheetScroll = (fn) => {
    const b = view.querySelector('.nv-sheet-body');
    const y = b ? b.scrollTop : 0;
    fn();
    const nb = view.querySelector('.nv-sheet-body');
    if (nb) nb.scrollTop = y;
  };
  onAction(view, {
    view(b) { mode = b.dataset.v; try { localStorage.setItem(VIEW_KEY, mode); } catch {} draw(); },
    sheet() { sheet = true; tagQ = ''; draw(); view.querySelector('.nv-sheet header button')?.focus({ preventScroll: true }); },
    'sheet-close'() { sheet = false; draw(); },
    reset() { keepSheetScroll(() => set({ genres: [], tags: [], status: 'all', sort: DEF.sort })); },
    'f-status'(b) { keepSheetScroll(() => set({ status: b.dataset.v })); },
    'f-sort'(b) { keepSheetScroll(() => set({ sort: b.dataset.v })); },
    genre(b) { keepSheetScroll(() => set({ genres: toggle(filter.genres, b.dataset.v) })); },
    tag(b) { keepSheetScroll(() => set({ tags: toggle(filter.tags, b.dataset.v) })); },
    'genre-add'(b) { if (!filter.genres.includes(b.dataset.v)) set({ genres: [...filter.genres, b.dataset.v] }); window.scrollTo({ top: 0 }); },
    rm(b) {
      const k = b.dataset.k;
      if (k === 'status') set({ status: 'all' });
      else if (k === 'sort') set({ sort: DEF.sort });
      else if (k === 'genre') set({ genres: filter.genres.filter((x) => x !== b.dataset.v) });
      else set({ tags: filter.tags.filter((x) => x !== b.dataset.v) });
    },
    clear() { set({ genres: [], tags: [], status: 'all', sort: DEF.sort }); },
  });
  let qt = null;
  view.addEventListener('input', (e) => {
    if (e.target.dataset.input === 'q') {
      clearTimeout(qt);
      qt = setTimeout(() => { filter = { ...filter, q: e.target.value }; saveFilter(filter); draw(); }, 150);
    } else if (e.target.dataset.input === 'tagq') {
      tagQ = e.target.value;
      // 태그 목록만 다시 (입력칸 포커스 유지)
      const all = list || [];
      const f = filterNovels(all.filter((n) => matchNovel(n, parseQuery(filter.q)) && statusOk(n)), filter);
      const tq = fold(tagQ);
      mount(view.querySelector('[data-slot="ftags"]'), html`${tagChips(f.tags.filter((t) => !tq || fold(t.name).includes(tq)))}`);
    }
  });
  const onKey = (e) => { if (e.key === 'Escape' && sheet) { sheet = false; draw(); } };
  document.addEventListener('keydown', onKey);
  const jumpers = attachScrollJump(view);

  const refresh = async () => {
    try {
      const [ns] = await Promise.all([loadNovels(), loadReading().catch(() => null)]);
      list = ns;
      if (view.isConnected) draw();
      signCovers(ns.map((n) => n.cover_path)).then((got) => { if (got && view.isConnected) draw(); }).catch(() => {});
      // 읽던 소설의 이어 읽을 회차 · 새 회차 수 (기억해 둔 건 바로)
      const todo = ns.filter((n) => latestOf(n.id) && !contCached(n));
      if (todo.length) { await Promise.allSettled(todo.map((n) => resolveCont(n))); if (view.isConnected) draw(); }
    } catch (err) { error = errorMessage(err); if (!list) draw(); else toast(error); }
  };
  draw();
  refresh();
  return () => { clearTimeout(qt); document.removeEventListener('keydown', onKey); jumpers.destroy(); };
}

// ---------------------------------------------------------------------
// 회차 목록 행 (회차 목록 화면 · 읽기 화면의 회차 패널 공용)
// ---------------------------------------------------------------------
export function chapterRows(nid, chapters, { current = null, since = null, desc = false } = {}) {
  const rows = novelReading(nid);
  const list = desc ? [...chapters].reverse() : chapters;
  return list.map((c) => {
    const r = rows[c.key];
    const s = statusOf(r);
    const on = c.key === current;
    const isNew = since && c.added_at > since && s === 'unread';
    return html`
      <a href="${chapterHref(nid, c.key)}" data-key="${c.key}" ${on ? html`aria-current="true"` : ''}
         class="nv-row ${on ? 'is-current' : ''} ${s === 'read' ? 'is-read' : ''}">
        <span class="nv-row-n">${chapterNoLabel(c)}</span>
        <span class="nv-row-t">${chapterRest(c)}</span>
        ${isNew ? html`<span class="nv-new">새</span>` : ''}
        ${s === 'reading' ? html`<span class="nv-row-p" aria-label="${Math.round((r.progress || 0) * 100)}% 읽음"><i style="width:${Math.max(6, Math.round((r.progress || 0) * 100))}%"></i></span>` : ''}
        ${s === 'read' ? html`<span class="nv-row-c" aria-label="읽음">${icon('check', 15, 2.4)}</span>` : ''}
      </a>`;
  });
}

// ---------------------------------------------------------------------
// #/n/<id>
// ---------------------------------------------------------------------
export function renderNovel(view, id) {
  let novel = novelById(id);
  let chapters = cachedChapters(id);
  let error = null;
  let desc = chapterSortDesc(id);
  let since = lastOpened(novelReading(id));   // 들어오기 전 마지막으로 연 시각 (새 회차 표시용)
  let scrolled = false;

  const draw = () => {
    const rows = novelReading(id);
    const cont = chapters ? continueTarget(chapters, rows) : null;
    const read = Object.values(rows).filter((r) => statusOf(r) === 'read').length;
    mount(view, html`
      <header class="h-16 px-2 lg:px-10 lg:pt-6 flex items-center gap-1">
        <a href="#/novels" class="w-11 h-11 rounded-full flex items-center justify-center text-ink hover-mouse:bg-chip" aria-label="소설 목록">${icon('back', 24)}</a>
        <h1 class="m-0 flex-1 min-w-0 text-[20px] font-bold truncate">${novel?.title || ''}</h1>
      </header>
      <div class="px-5 lg:px-12 pb-10 max-w-[760px] flex flex-col gap-4">
        ${novel ? html`
          <div class="nv-head">
            ${novel.cover_path ? html`<button type="button" class="nv-cover-btn" data-action="cover" aria-label="표지 크게 보기">${coverBox(novel, { cls: 'is-lg' })}</button>` : coverBox(novel, { cls: 'is-lg' })}
            <div class="nv-head-info">
              ${novel.author ? html`<span class="text-[14px]">${novel.author}</span>` : ''}
              ${genresOf(novel).length ? html`<span class="nv-card-g">${genresOf(novel).map((g) => html`<a class="nv-gchip" href="#/novels" data-genre="${g}">${g}</a>`)}</span>` : ''}
              ${(novel.tags || []).length ? html`<span class="nv-card-tags">${novel.tags.map((t) => html`<span>#${t}</span>`)}</span>` : ''}
              ${chapters ? html`<span class="text-[13px] text-muted">${chapterTotal(chapters).toLocaleString()}화 · 읽은 회차 ${read.toLocaleString()}${novel.last_added_at ? html`<br>마지막 추가 ${fmtDate(novel.last_added_at)}` : ''}</span>` : ''}
            </div>
          </div>` : ''}
        ${!chapters ? html`<p class="text-sm text-muted py-6">${error || '불러오는 중…'}</p>` : html`
          ${cont ? html`
            <a href="${chapterHref(id, cont.chapter.key)}" class="no-underline bg-hero text-hero-ink rounded-[16px] p-4 flex items-center gap-3 hover-mouse:opacity-95">
              <span class="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center shrink-0">${icon('play', 18)}</span>
              <span class="flex-1 min-w-0 flex flex-col gap-0.5">
                <span class="text-xs text-hero-muted">${cont.fresh && !since ? '처음부터 읽기' : cont.fresh ? '다음 회차' : '이어 읽기'}</span>
                <span class="font-bold truncate">${chapterTitleLine(cont.chapter)}</span>
              </span>
            </a>` : ''}
          <div class="flex items-center gap-2 border-b border-line pb-2 text-[13px]">
            <span class="flex-1 font-bold">회차</span>
            ${cont && !cont.fresh ? html`<button type="button" data-action="jump" class="h-8 px-2.5 rounded-lg border-0 bg-transparent text-muted cursor-pointer hover-mouse:text-ink">읽던 회차로</button>` : ''}
            <button type="button" data-action="sort" class="h-8 px-2.5 rounded-lg border-0 bg-chip text-ink cursor-pointer">${desc ? '최신 회차부터' : '1화부터'}</button>
          </div>
          <nav class="nv-list" aria-label="회차 목록">${chapterRows(id, chapters, { current: cont && !cont.fresh ? cont.chapter.key : null, since, desc })}</nav>`}
      </div>`);
  };

  const jump = () => {
    const el = view.querySelector('.nv-row.is-current');
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3 });
  };
  onAction(view, {
    sort() { desc = !desc; setChapterSortDesc(id, desc); draw(); },
    jump,
    cover() { if (novel) openCover(novel); },
  });
  const jumpers = attachScrollJump(view);
  const syncJump = () => {
    const cont = chapters ? continueTarget(chapters, novelReading(id)) : null;
    jumpers.setExtra(cont && !cont.fresh ? { label: '읽던 회차', run: jump } : null);
  };
  // 장르 칩 → 그 장르로 거른 소설 목록
  view.addEventListener('click', (e) => {
    const g = e.target.closest?.('[data-genre]');
    if (g) saveFilter({ ...DEF, genres: [g.dataset.genre] });
  });

  draw();
  (async () => {
    try {
      if (!novel) { await loadNovels(); novel = novelById(id); }
      if (novel?.cover_path && !coverUrl(novel.cover_path)) signCovers([novel.cover_path]).then((got) => { if (got && view.isConnected) draw(); }).catch(() => {});
      const [chs] = await Promise.all([loadChapters(id), loadReading().catch(() => null)]);
      chapters = chs;
      if (!novel) { error = '소설을 찾을 수 없어요.'; chapters = null; }
      since = since || null;
      if (!view.isConnected) return;
      draw();
      syncJump();
      if (!scrolled) { scrolled = true; requestAnimationFrame(jump); }
    } catch (err) { error = errorMessage(err); if (!chapters) draw(); else toast(error); }
  })();
  return () => { jumpers.destroy(); closeCover(); };
}

// ---------------------------------------------------------------------
// 표지 크게 보기: 화면에 맞춰 띄움 (확대·축소 없음). 크게 보기용 표지가 있으면 그것, 없으면 목록용 표지
// ---------------------------------------------------------------------
let coverEl = null;
function closeCover() {
  if (!coverEl) return;
  coverEl.remove();
  coverEl = null;
  document.removeEventListener('keydown', coverKey, true);
}
const coverKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCover(); } };
async function openCover(n) {
  closeCover();
  const big = n.cover_large_path;
  const small = coverUrl(n.cover_path);
  coverEl = document.createElement('div');
  coverEl.className = 'cv-modal';
  coverEl.setAttribute('role', 'dialog');
  coverEl.setAttribute('aria-label', `${n.title} 표지`);
  mount(coverEl, html`
    <button type="button" class="cv-x" aria-label="닫기">${icon('close', 22)}</button>
    <img alt="${n.title} 표지" src="${coverUrl(big) || small || ''}">`);
  coverEl.addEventListener('click', closeCover);
  document.body.append(coverEl);
  document.addEventListener('keydown', coverKey, true);
  coverEl.querySelector('.cv-x').focus({ preventScroll: true });
  if (big && !coverUrl(big)) {
    try {
      await signCovers([big]);
      const img = coverEl?.querySelector('img');
      if (img && coverUrl(big)) img.src = coverUrl(big);
    } catch {}
  }
}
