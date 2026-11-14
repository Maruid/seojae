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
import { isNovelSaved, savedNovelsNow, savedKeysOf, novelDiff, refreshIndex, onSaved } from '../lib/offline/index.js';
import { openNovelDownload, quickNext } from '../components/dlFlow.js';
import { cachedQuota, loadQuota } from '../lib/offline/quota.js';
import { fmtBytes, roomOf } from '../lib/offline/plan.js';

export const chapterHref = (nid, key) => `#/n/${encodeURIComponent(nid)}/${encodeURIComponent(key)}`;

// 표지 상자는 홈과 같이 씀
export { coverBox };

// ---------------------------------------------------------------------
// #/novels  — 보기 3종(카드 · 작은 카드 · 리스트) · 검색 · 필터 창
// ---------------------------------------------------------------------
const FILTER_KEY = 'ui:nvFilter';
const VIEW_KEY = 'ui:nvView';
const DEF = { q: '', genres: [], tags: [], status: 'all', sort: 'recent', saved: false };
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
  let pick = null;        // 여러 편 받기: 고른 소설 id Set (null = 평소)
  let menuFor = null;     // 카드 메뉴가 열린 소설

  const openedOf = (n) => lastOpened(novelReading(n.id));
  const statusOk = (n) => {
    if (filter.saved && !isNovelSaved(n.id)) return false;
    if (filter.status === 'all') return true;
    if (filter.status === 'new') return hasNew(n, openedOf(n));
    return novelStatus(n, novelReading(n.id)) === filter.status;
  };

  mount(view, html`
    <header class="h-16 px-5 lg:px-12 lg:pt-6 flex items-center gap-2" data-slot="head"></header>
    <div class="px-5 lg:px-12 max-w-[1180px] flex flex-col gap-2.5">
      <div class="nv-searchrow">
        <label class="nv-search">${icon('search', 18)}<span class="sr-only">소설 검색</span>
          <input type="search" data-input="q" value="${filter.q}" placeholder="제목·작가·장르·#태그" enterkeyhint="search" autocomplete="off"></label>
        <button type="button" class="nv-filterbtn" data-action="sheet" data-slot="fbtn" aria-haspopup="dialog"></button>
      </div>
      <div data-slot="chips"></div>
    </div>
    <div class="px-5 lg:px-12 pb-10 pt-3 max-w-[1180px]" data-slot="list"></div>
    <div data-slot="sheet"></div>
    <div data-slot="pickbar"></div>
    <div data-slot="menu"></div>`);
  const slot = (k) => view.querySelector(`[data-slot="${k}"]`);

  let visible = [];
  const draw = () => {
    const all = list || [];
    const tokens = parseQuery(filter.q);
    filter.genres = filter.genres.filter((g) => all.some((n) => genresOf(n).includes(g)));
    filter.tags = filter.tags.filter((t) => all.some((n) => (n.tags || []).includes(t)));
    const base = all.filter((n) => matchNovel(n, tokens) && statusOk(n));
    const f = filterNovels(base, filter);
    const items = sortNovels(f.list, filter.sort, openedOf);
    const nCond = filter.genres.length + filter.tags.length + (filter.status !== 'all' ? 1 : 0) + (filter.sort !== DEF.sort ? 1 : 0) + (filter.saved ? 1 : 0);

    mount(slot('head'), pick ? html`
      <h1 class="m-0 flex-1 text-[20px] font-bold">받을 소설 고르기</h1>
      <button type="button" class="nv-hbtn is-text" data-action="pick-all">모두 선택</button>
      <button type="button" class="nv-hbtn" data-action="pick-cancel">취소</button>` : html`
      <h1 class="m-0 flex-1 text-[22px] font-bold">소설</h1>
      ${navigator.onLine ? html`<button type="button" class="nv-hbtn" data-action="pick-start" aria-label="여러 편 받기" title="여러 편 받기">${icon('download', 15)}<span>여러 편 받기</span></button>` : ''}
      <div class="nv-views" role="group" aria-label="보기">${VIEWS.map(([k, l, ic]) => html`
        <button type="button" data-action="view" data-v="${k}" aria-pressed="${String(mode === k)}" aria-label="${l}로 보기" title="${l}">${icon(ic, 18)}</button>`)}</div>`);
    const q = cachedQuota();
    mount(slot('pickbar'), pick ? html`
      <div class="nv-pickbar">
        <span><b>${pick.size}편</b> 선택${q && !q.unlimited ? html`<br><small>남은 한도 ${fmtBytes(roomOf(q))}</small>` : ''}</span>
        <button type="button" class="dl-main" data-action="pick-go" ${pick.size ? '' : 'disabled'}>회차 고르기</button>
      </div>` : '');
    mount(slot('fbtn'), html`${icon('filter', 18)}<span>필터</span>${nCond ? html`<b>${nCond}</b>` : ''}`);
    const label = (k, arr) => arr.find((x) => x[0] === k)?.[1];
    mount(slot('chips'), nCond || filter.q ? html`
      <div class="nv-active">
        ${filter.saved ? html`<button type="button" data-action="rm" data-k="saved">다운로드됨 ×</button>` : ''}
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
      <div class="nv-grid is-${mode} ${pick ? 'is-pick' : ''}">${items.map((n) => (mode === 'small' ? smallCard(n) : mode === 'list' ? listRow(n) : bigCard(n)))}</div>`);

    mount(slot('sheet'), sheet ? sheetHtml(f, items.length) : '');
    mount(slot('menu'), menuFor ? menuHtml(menuFor) : '');
    visible = items;
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
    const saved = isNovelSaved(n.id);
    return html`
      <span class="nv-card-wrap ${!navigator.onLine && !saved ? 'is-off' : ''}">
        <a href="#/n/${encodeURIComponent(n.id)}" class="nv-card-link" aria-label="${n.title}${!navigator.onLine && !saved ? ' (연결되면 열 수 있어요)' : ''}" data-card="${n.id}">
          ${coverBox(n, { cls })}
          ${newBadge(n)}
          ${saved ? html`<span class="nv-dl" title="받아 둠" aria-label="받아 둠">${icon('download', 12, 2.6)}</span>` : ''}
          ${p.started ? html`<span class="nv-card-p"><i style="width:${Math.max(3, p.pct)}%"></i></span>` : ''}
        </a>
        ${pick ? html`<input type="checkbox" class="nv-pick" data-action="pick-one" data-id="${n.id}" ${pick.has(n.id) ? 'checked' : ''} aria-label="${n.title} 고르기">`
          : navigator.onLine ? html`<button type="button" class="nv-more" data-action="menu" data-id="${n.id}" aria-label="${n.title} 메뉴">${icon('more', 18)}</button>` : ''}
      </span>`;
  };
  // 카드 메뉴 (휴대폰: 길게 누르기 · PC: ⋯ 버튼)
  const menuHtml = (id) => {
    const n = (list || []).find((x) => x.id === id);
    if (!n) return '';
    const s = savedNovelsNow().get(id);
    return html`
      <div class="nv-sheet-back" data-action="menu-close"></div>
      <section class="nv-sheet nv-menu" role="dialog" aria-label="${n.title} 메뉴">
        <div class="nv-menu-h">${coverBox(n, { cls: 'is-sm' })}<span><b>${n.title}</b><small>${n.chapter_count.toLocaleString()}화${s ? ` · 받은 ${s.saved.size}화` : ''}</small></span></div>
        <button type="button" class="nv-mi" data-action="m-pick" data-id="${id}">${icon('download', 18)}<span>회차 골라 받기<small>회차 선택 창이 열려요</small></span></button>
        <button type="button" class="nv-mi" data-action="m-next" data-id="${id}">${icon('next', 18)}<span>다음 50화 바로 받기<small>읽던 회차부터 · 받은 회차는 빼고</small></span></button>
        <a class="nv-mi" href="#/n/${encodeURIComponent(id)}">${icon('novels', 18)}<span>소설 보기</span></a>
        <button type="button" class="nv-mi" data-action="m-multi" data-id="${id}">${icon('check', 18)}<span>여러 편 고르기<small>이 소설부터 선택해서 시작</small></span></button>
      </section>`;
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
          <h3>보관</h3>
          <div class="nv-fchips"><button type="button" class="${chip(filter.saved)}" data-action="f-saved" aria-pressed="${String(filter.saved)}">다운로드됨 <span>${(list || []).filter((n) => isNovelSaved(n.id)).length}</span></button></div>
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
    reset() { keepSheetScroll(() => set({ genres: [], tags: [], status: 'all', sort: DEF.sort, saved: false })); },
    'f-saved'() { keepSheetScroll(() => set({ saved: !filter.saved })); },
    'f-status'(b) { keepSheetScroll(() => set({ status: b.dataset.v })); },
    'f-sort'(b) { keepSheetScroll(() => set({ sort: b.dataset.v })); },
    genre(b) { keepSheetScroll(() => set({ genres: toggle(filter.genres, b.dataset.v) })); },
    tag(b) { keepSheetScroll(() => set({ tags: toggle(filter.tags, b.dataset.v) })); },
    'genre-add'(b) { if (!filter.genres.includes(b.dataset.v)) set({ genres: [...filter.genres, b.dataset.v] }); window.scrollTo({ top: 0 }); },
    rm(b) {
      const k = b.dataset.k;
      if (k === 'saved') set({ saved: false });
      else if (k === 'status') set({ status: 'all' });
      else if (k === 'sort') set({ sort: DEF.sort });
      else if (k === 'genre') set({ genres: filter.genres.filter((x) => x !== b.dataset.v) });
      else set({ tags: filter.tags.filter((x) => x !== b.dataset.v) });
    },
    clear() { set({ genres: [], tags: [], status: 'all', sort: DEF.sort, saved: false }); },
    'pick-start'() { pick = new Set(); loadQuota().then(() => { if (pick && view.isConnected) draw(); }).catch(() => {}); draw(); },
    'pick-cancel'() { pick = null; draw(); },
    'pick-all'() { pick = new Set(visible.map((n) => n.id)); draw(); },
    async 'pick-go'() {
      const ns = (list || []).filter((n) => pick.has(n.id));
      const r = await openNovelDownload(ns);
      if (r) { pick = null; }
      if (view.isConnected) draw();
    },
    menu(b) { menuFor = b.dataset.id; draw(); },
    'menu-close'() { menuFor = null; draw(); },
    async 'm-pick'(b) { menuFor = null; draw(); await openNovelDownload([novelById(b.dataset.id)]); if (view.isConnected) draw(); },
    async 'm-next'(b) { menuFor = null; draw(); await quickNext(novelById(b.dataset.id), 50); if (view.isConnected) draw(); },
    'm-multi'(b) { menuFor = null; pick = new Set([b.dataset.id]); loadQuota().then(() => { if (pick && view.isConnected) draw(); }).catch(() => {}); draw(); },
  });
  view.addEventListener('change', (e) => {
    if (e.target.dataset.action !== 'pick-one' || !pick) return;
    if (e.target.checked) pick.add(e.target.dataset.id); else pick.delete(e.target.dataset.id);
    draw();
  });
  // 고르는 중에는 카드를 눌러도 들어가지 않고 고르기
  view.addEventListener('click', (e) => {
    if (!pick) return;
    const a = e.target.closest('.nv-card-link, .nv-card-t, .nv-lrow-main');
    if (!a) return;
    e.preventDefault();
    const id = a.dataset.card || a.closest('.nv-card, .nv-lrow')?.querySelector('[data-card]')?.dataset.card;
    if (!id) return;
    if (pick.has(id)) pick.delete(id); else pick.add(id);
    draw();
  }, true);
  // 길게 누르기 → 카드 메뉴
  let lp = null; let lpFired = false;
  view.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || pick || !navigator.onLine) return;
    const a = e.target.closest('[data-card]');
    if (!a) return;
    lpFired = false;
    lp = setTimeout(() => { lpFired = true; menuFor = a.dataset.card; draw(); try { navigator.vibrate?.(10); } catch {} }, 520);
  });
  const lpCancel = () => clearTimeout(lp);
  view.addEventListener('pointerup', lpCancel);
  view.addEventListener('pointercancel', lpCancel);
  view.addEventListener('pointermove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) lpCancel(); });
  view.addEventListener('click', (e) => { if (lpFired && e.target.closest('[data-card]')) { e.preventDefault(); lpFired = false; } }, true);
  // 안드로이드는 길게 누르면 링크 메뉴가 먼저 뜸 → 터치일 때는 그 대신 카드 메뉴
  let lastPointer = 'mouse';
  view.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; }, true);
  view.addEventListener('contextmenu', (e) => {
    const a = e.target.closest('[data-card]');
    if (!a || lastPointer === 'mouse' || pick || !navigator.onLine) return;
    e.preventDefault();
    if (!lpFired) { clearTimeout(lp); lpFired = true; menuFor = a.dataset.card; draw(); }
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
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (menuFor) { menuFor = null; draw(); } else if (sheet) { sheet = false; draw(); } else if (pick) { pick = null; draw(); } else return;
    e.preventDefault();   // 처리함 (앱 뒤로가기가 화면을 넘기지 않게)
  };
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
  const offSaved = onSaved(() => { if (view.isConnected) draw(); });
  const onNet = () => { if (view.isConnected) { if (!navigator.onLine) { pick = null; menuFor = null; } draw(); } };
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
  refreshIndex().catch(() => {});
  draw();
  refresh();
  return () => {
    clearTimeout(qt); clearTimeout(lp); offSaved(); document.removeEventListener('keydown', onKey); jumpers.destroy();
    window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet);
  };
}

// ---------------------------------------------------------------------
// 회차 목록 행 (회차 목록 화면 · 읽기 화면의 회차 패널 공용)
// ---------------------------------------------------------------------
export function chapterRows(nid, chapters, { current = null, since = null, desc = false } = {}) {
  const rows = novelReading(nid);
  const list = desc ? [...chapters].reverse() : chapters;
  // 받아 둔 회차 표시: 받음 · 바뀜 / 오프라인이면 안 받은 회차는 흐리게
  const saved = savedKeysOf(nid);
  const d = saved.size ? novelDiff(nid, chapters) : null;
  const changed = new Set(d?.changed || []);
  const fresh = new Set(d?.fresh || []);
  const off = !navigator.onLine;
  return list.map((c) => {
    const r = rows[c.key];
    const s = statusOf(r);
    const on = c.key === current;
    const isNew = (since && c.added_at > since && s === 'unread') || fresh.has(c.key);
    const have = saved.has(c.key);
    return html`
      <a href="${chapterHref(nid, c.key)}" data-key="${c.key}" ${on ? html`aria-current="true"` : ''}
         class="nv-row ${on ? 'is-current' : ''} ${s === 'read' ? 'is-read' : ''} ${off && !have ? 'is-off' : ''}">
        <span class="nv-row-n">${chapterNoLabel(c)}</span>
        <span class="nv-row-t">${chapterRest(c)}</span>
        ${isNew ? html`<span class="nv-new">새</span>` : ''}
        ${changed.has(c.key) ? html`<span class="dl-badge is-acc">바뀜</span>` : have ? html`<span class="nv-row-dl" aria-label="받아 둠">${icon('download', 14, 2.4)}</span>` : ''}
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
          ${keepCard()}
          <div class="flex items-center gap-2 border-b border-line pb-2 text-[13px]">
            <span class="flex-1 font-bold">회차</span>
            ${cont && !cont.fresh ? html`<button type="button" data-action="jump" class="h-8 px-2.5 rounded-lg border-0 bg-transparent text-muted cursor-pointer hover-mouse:text-ink">읽던 회차로</button>` : ''}
            <button type="button" data-action="sort" class="h-8 px-2.5 rounded-lg border-0 bg-chip text-ink cursor-pointer">${desc ? '최신 회차부터' : '1화부터'}</button>
          </div>
          <nav class="nv-list" aria-label="회차 목록">${chapterRows(id, chapters, { current: cont && !cont.fresh ? cont.chapter.key : null, since, desc })}</nav>`}
      </div>`);
  };

  // 오프라인 보관 카드: 받은 회차 · 크기 · 새 회차 · 바뀐 회차 · [회차 받기] · 관리 ›
  const keepCard = () => {
    const sv = savedNovelsNow().get(id);
    const d = sv && chapters ? novelDiff(id, chapters) : { fresh: [], changed: [], resplit: false };
    if (!sv?.saved.size) {
      return navigator.onLine ? html`
        <div class="dl-keep is-empty">
          <span class="dl-keep-ic">${icon('download', 18)}</span>
          <span class="dl-keep-t"><b>오프라인으로 읽기</b><small>회차를 받아 두면 인터넷 없이 읽을 수 있어요</small></span>
          <button type="button" class="dl-main is-sm" data-action="dl">회차 받기</button>
        </div>` : '';
    }
    return html`
      <section class="dl-keep" aria-label="오프라인 보관">
        <div class="flex items-center gap-2.5">
          <span class="dl-keep-ic is-ok">${icon('download', 18)}</span>
          <span class="dl-keep-t"><b>오프라인 보관 중 · ${sv.saved.size}화</b><small>${fmtBytes(sv.bytes)} · 이 브라우저에 저장됨</small></span>
          ${navigator.onLine ? html`<button type="button" class="dl-main is-sm" data-action="dl">회차 받기</button>` : ''}
        </div>
        <div class="flex items-center gap-1.5 flex-wrap">
          ${d.resplit || sv.rec.resplit ? html`<span class="dl-badge is-acc">회차가 새로 나뉨</span>` : ''}
          ${d.fresh.length ? html`<span class="dl-badge is-acc">새 회차 ${d.fresh.length}</span>` : ''}
          ${d.changed.length ? html`<span class="dl-badge is-acc">바뀐 회차 ${d.changed.length}</span>` : ''}
          <span class="flex-1"></span>
          <a href="#/downloads" class="text-[13px] no-underline">관리 ›</a>
        </div>
      </section>`;
  };

  const jump = () => {
    const el = view.querySelector('.nv-row.is-current');
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3 });
  };
  onAction(view, {
    sort() { desc = !desc; setChapterSortDesc(id, desc); draw(); },
    jump,
    cover() { if (novel) openCover(novel); },
    async dl() { if (novel) { await openNovelDownload([novel]); if (view.isConnected) draw(); } },
  });
  const offSaved = onSaved(() => { if (view.isConnected && chapters) draw(); });
  const onNet = () => { if (view.isConnected && chapters) draw(); };
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
  refreshIndex().catch(() => {});
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
  return () => { jumpers.destroy(); closeCover(); offSaved(); window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet); };
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
