// 칼럼 목록
//   모바일: 목록 화면 하나 (#/columns) → 글 누르면 읽기 화면 (#/c/<id>)
//   PC(1024px~): 왼쪽 목록 + 오른쪽 글 (목록은 화면이 바뀌어도 그대로 유지)
import { html, mount, onAction, toast } from '../lib/dom.js';
import { errorMessage } from '../lib/supabase.js';
import { loadColumns, cachedColumns, categoriesOf, fmtDate, monthOf } from '../lib/columns.js';
import { loadReading, getReading, statusOf, onReadingChange } from '../lib/progress.js';
import { icon } from '../components/icons.js';
import { isColumnSaved, savedColumnsNow, refreshIndex, onSaved } from '../lib/offline/index.js';
import { openColumnDownload } from '../components/dlFlow.js';

const STATE_KEY = 'ui:colList';
const FILTERS = [['all', '전체'], ['unread', '안 읽음'], ['reading', '읽는 중'], ['read', '읽음']];

export function listState() {
  try { return { cat: '', filter: 'all', sort: 'new', q: '', ...JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}') }; }
  catch { return { cat: '', filter: 'all', sort: 'new', q: '' }; }
}
function setListState(patch) {
  const s = { ...listState(), ...patch };
  try { sessionStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {}
  return s;
}

// 현재 목록 조건으로 거른 글 (읽기 화면의 이전·다음 글에도 씀)
export function filteredColumns(cols, st = listState(), { ignoreRead = false } = {}) {
  const q = st.q.trim().toLowerCase();
  let out = cols.filter((c) => {
    if (st.cat && (c.category || '기타') !== st.cat) return false;
    if (!ignoreRead && st.filter !== 'all' && statusOf(getReading('column', c.id)) !== st.filter) return false;
    if (q && !(c.title || '').toLowerCase().includes(q) && !(c.tags || []).some((t) => t.toLowerCase().includes(q))) return false;
    return true;
  });
  if (st.sort === 'old') out = [...out].reverse();
  return out;
}

export function unreadCount(cols) {
  return cols.filter((c) => statusOf(getReading('column', c.id)) === 'unread').length;
}

// ---------------------------------------------------------------------
// 목록 패널 (모바일 목록 화면과 PC 왼쪽 패널 공용)
// ---------------------------------------------------------------------
let pane = null;

function createPane() {
  const el = document.createElement('div');
  el.className = 'col-list-pane';
  const p = { el, activeId: null, cols: cachedColumns(), error: null, searching: !!listState().q };

  p.draw = () => {
    const st = listState();
    const cols = p.cols || [];
    const cats = categoriesOf(cols);
    const items = filteredColumns(cols, st);
    let lastMonth = '';
    mount(el, html`
      <div class="sticky top-0 z-10 bg-bg lg:bg-surface">
        <header class="h-16 px-5 lg:px-5 flex items-center gap-2">
          <h1 class="m-0 flex-1 text-[22px] font-bold">칼럼</h1>
          ${navigator.onLine ? html`<button type="button" data-action="dl" aria-label="${st.cat ? `${st.cat} 받기` : '칼럼 받기'}" title="오프라인으로 받기"
            class="w-11 h-11 rounded-full border-0 bg-transparent text-ink cursor-pointer flex items-center justify-center hover-mouse:bg-chip">${icon('download', 20)}</button>` : ''}
          <button type="button" data-action="search" aria-label="검색" aria-pressed="${String(p.searching)}"
            class="w-11 h-11 rounded-full border-0 bg-transparent text-ink cursor-pointer flex items-center justify-center hover-mouse:bg-chip ${p.searching ? 'bg-chip' : ''}">${icon('search')}</button>
        </header>
        ${p.searching ? html`
          <div class="px-5 pb-2">
            <input type="search" data-input="q" value="${st.q}" placeholder="제목·태그 검색" aria-label="제목·태그 검색" enterkeyhint="search"
              class="w-full h-11 px-3.5 rounded-xl border border-line bg-surface lg:bg-bg text-ink outline-none focus:border-muted">
          </div>` : ''}
        <div class="px-5 pb-2">
          <label class="col-cat ${st.cat ? 'is-on' : ''}">
            <span class="sr-only">분류</span>
            <select data-input="cat" aria-label="분류">
              <option value="" ${st.cat ? '' : 'selected'}>분류 · 전체 ${cols.length}</option>
              ${cats.map((c) => html`<option value="${c.name}" ${st.cat === c.name ? 'selected' : ''}>${c.name} ${c.count}</option>`)}
            </select>
            ${icon('down', 16)}
          </label>
        </div>
        <div class="flex items-center gap-1 px-5 pb-2 border-b border-line text-[13px]">
          ${FILTERS.map(([k, l]) => html`
            <button type="button" data-action="filter" data-v="${k}" aria-pressed="${String(st.filter === k)}"
              class="h-8 px-2.5 rounded-lg border-0 cursor-pointer ${st.filter === k ? 'bg-chip text-ink font-bold' : 'bg-transparent text-muted hover-mouse:text-ink'}">${l}</button>`)}
          <span class="flex-1"></span>
          <button type="button" data-action="sort" class="h-8 px-2 rounded-lg border-0 bg-transparent text-muted cursor-pointer hover-mouse:text-ink">${st.sort === 'new' ? '최신순' : '오래된순'}</button>
        </div>
      </div>
      <div class="pb-6" role="list">
        ${!p.cols ? html`<p class="px-5 py-8 text-sm text-muted">${p.error ? p.error : '불러오는 중…'}</p>` : ''}
        ${p.cols && !items.length ? html`<p class="px-5 py-8 text-sm text-muted">${cols.length ? '조건에 맞는 글이 없어요.' : '아직 올라온 칼럼이 없어요.'}</p>` : ''}
        ${items.map((c) => {
          const m = monthOf(c.published_at);
          const head = m !== lastMonth ? html`<div class="px-5 pt-5 pb-1.5 text-xs font-bold text-muted">${m}</div>` : '';
          lastMonth = m;
          const r = getReading('column', c.id);
          const s = statusOf(r);
          const on = c.id === p.activeId;
          const saved = isColumnSaved(c.id);
          return html`${head}
            <a role="listitem" href="#/c/${encodeURIComponent(c.id)}" data-id="${c.id}" ${on ? html`aria-current="true"` : ''}
               class="relative block no-underline px-5 py-3 ${on ? 'bg-chip' : 'hover-mouse:bg-chip/50'} ${!navigator.onLine && !saved ? 'is-off' : ''}">
              ${s === 'unread' ? html`<span class="absolute left-2 top-[19px] w-1.5 h-1.5 rounded-full bg-accent" aria-label="안 읽음"></span>` : ''}
              <span class="block text-[15px] leading-snug ${s === 'read' ? 'text-muted' : 'text-ink font-medium'}">${c.title}</span>
              <span class="flex items-center gap-2 mt-1 text-xs text-muted">
                <span>${c.category || '기타'}</span><span aria-hidden="true">·</span><span>${fmtDate(c.published_at)}</span>
                ${saved ? html`<span class="text-ok-ink flex items-center" aria-label="받아 둠" title="받아 둠">${icon('download', 13, 2.4)}</span>` : ''}
                ${s === 'reading' ? html`<span class="ml-auto flex items-center gap-1.5" aria-label="${Math.round((r.progress || 0) * 100)}% 읽음">
                  <span class="w-12 h-1 rounded-full bg-line overflow-hidden"><span class="block h-full bg-accent" style="width:${Math.max(4, Math.round((r.progress || 0) * 100))}%"></span></span></span>` : ''}
                ${s === 'read' ? html`<span class="ml-auto text-ok-ink flex items-center gap-0.5">${icon('check', 14, 2.4)}읽음</span>` : ''}
              </span>
            </a>`;
        })}
      </div>`);
    if (p.searching) {
      const inp = el.querySelector('[data-input="q"]');
      if (p.focusSearch && inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); p.focusSearch = false; }
    }
  };

  el.addEventListener('change', (e) => {
    if (e.target.dataset.input === 'cat') { setListState({ cat: e.target.value }); p.draw(); }
  });
  onAction(el, {
    filter(b) { setListState({ filter: b.dataset.v }); p.draw(); },
    async dl() {
      const st = listState();
      const cols = (p.cols || []).filter((c) => !st.cat || (c.category || '기타') === st.cat);
      await openColumnDownload(cols, { title: st.cat ? `칼럼 받기 · ${st.cat}` : '칼럼 받기 · 전체' });
      if (el.isConnected) p.draw();
    },
    sort() { setListState({ sort: listState().sort === 'new' ? 'old' : 'new' }); p.draw(); },
    search() {
      p.searching = !p.searching;
      if (!p.searching) setListState({ q: '' });
      p.focusSearch = p.searching;
      p.draw();
    },
  });
  let t = null;
  el.addEventListener('input', (e) => {
    if (e.target.dataset.input !== 'q') return;
    clearTimeout(t);
    t = setTimeout(() => { setListState({ q: e.target.value }); p.focusSearch = true; p.draw(); }, 180);
  });

  onReadingChange(() => { if (el.isConnected) p.draw(); });
  onSaved(() => { if (el.isConnected) p.draw(); });
  const onNet = () => { if (el.isConnected) p.draw(); };
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
  refreshIndex().catch(() => {});

  p.refresh = async () => {
    try {
      const [cols] = await Promise.all([loadColumns(), loadReading().catch(() => null)]);
      p.cols = cols;
      p.error = null;
    } catch (err) {
      p.error = errorMessage(err);
      if (!p.cols) toast(p.error);
    }
    if (el.isConnected) p.draw();
  };
  return p;
}

export function getPane() {
  if (!pane) pane = createPane();
  return pane;
}
export function resetPane() { pane = null; }

// 활성 글을 목록 화면 안에 보이게
export function revealActive(p) {
  const a = p.el.querySelector('[aria-current="true"]');
  if (!a) return;
  const box = p.el.getBoundingClientRect();
  const r = a.getBoundingClientRect();
  if (r.top < box.top + 140 || r.bottom > box.bottom) p.el.scrollTop += r.top - box.top - box.height / 3;
}

// ---------------------------------------------------------------------
// #/columns
// ---------------------------------------------------------------------
const wide = () => matchMedia('(min-width: 1024px)').matches;

export function renderColumns(view, app) {
  // 홈의 "이어 읽기 · 칼럼 › 전체" → 읽는 중
  const f = app?.route?.query?.f;
  if (f && FILTERS.some(([k]) => k === f)) { setListState({ filter: f, cat: '', q: '' }); history.replaceState(null, '', '#/columns'); }
  const p = getPane();
  p.activeId = null;
  const savedScroll = p.el.scrollTop;

  if (wide()) {
    mount(view, html`<div class="col-split"><div data-slot></div>
      <section class="hidden lg:flex flex-col items-center justify-center gap-3 min-h-dvh text-muted text-sm px-10 text-center">
        ${icon('columns', 40, 1.4)}
        <p class="m-0">왼쪽 목록에서 읽을 글을 골라 주세요.</p>
        <p class="m-0 text-xs">J · K 키로 다음·이전 글로 넘어갈 수 있어요.</p>
      </section></div>`);
  } else {
    mount(view, html`<div data-slot></div>`);
  }
  view.querySelector('[data-slot]').replaceWith(p.el);
  p.draw();
  p.el.scrollTop = savedScroll;

  // 모바일: 목록에서 읽던 위치로
  if (!wide()) {
    const y = +sessionStorage.getItem('ui:colListY') || 0;
    if (y) requestAnimationFrame(() => window.scrollTo(0, y));
  }
  p.refresh();

  return () => { if (!wide()) { try { sessionStorage.setItem('ui:colListY', String(window.scrollY)); } catch {} } };
}
