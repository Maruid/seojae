// 소설 목록 (#/novels) · 회차 목록 (#/n/<id>)
import { html, mount, onAction, toast } from '../lib/dom.js';
import { errorMessage } from '../lib/supabase.js';
import { loadNovels, cachedNovels, novelById, loadChapters, cachedChapters, countNewSince, chapterSortDesc, setChapterSortDesc } from '../lib/novels.js';
import { chapterNoLabel, chapterRest, chapterTitleLine, chapterTotal, continueTarget, lastOpened, filterNovels, genresOf } from '../lib/novelText.js';
import { coverUrl, coverHue, signCovers } from '../lib/covers.js';
import { loadReading, novelReading, statusOf } from '../lib/progress.js';
import { fmtDate } from '../lib/columns.js';
import { icon } from '../components/icons.js';

export const chapterHref = (nid, key) => `#/n/${encodeURIComponent(nid)}/${encodeURIComponent(key)}`;

function novelStats(n) {
  const rows = novelReading(n.id);
  const read = Object.values(rows).filter((r) => statusOf(r) === 'read').length;
  const opened = lastOpened(rows);
  const list = cachedChapters(n.id);
  const cont = list ? continueTarget(list, rows) : null;
  return { read, opened, cont, started: !!opened };
}

// 표지: 올린 이미지가 있으면 그것, 없으면 제목으로 색을 정한 기본 표지
export function coverBox(n, { cls = '' } = {}) {
  const url = coverUrl(n.cover_path);
  return html`
    <span class="nv-cover ${cls}" style="--h:${coverHue(n.title)}">
      <span class="nv-cover-ph" aria-hidden="true"><b>${n.title}</b>${n.author ? html`<small>${n.author}</small>` : ''}</span>
      ${url ? html`<img src="${url}" alt="" loading="lazy" decoding="async">` : ''}
    </span>`;
}

// ---------------------------------------------------------------------
// #/novels  (바둑판형: 표지 + 제목 · 작가 · 장르 칩 · 태그)
// ---------------------------------------------------------------------
const FILTER_KEY = 'ui:nvFilter';
const readFilter = () => {
  try {
    const f = JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}');
    return { genres: f.genres || (f.genre ? [f.genre] : []), tags: f.tags || [] };
  } catch { return { genres: [], tags: [] }; }
};
const saveFilter = (f) => { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch {} };

export function renderNovels(view) {
  let list = cachedNovels();
  let error = null;
  const fresh = {};   // id → 새 회차 수
  let filter = readFilter();
  let moreTags = false;

  const chip = (on) => `shrink-0 h-9 px-3 rounded-full text-[13px] cursor-pointer whitespace-nowrap ${on ? 'bg-ink text-bg border border-ink font-bold' : 'bg-transparent text-ink border border-line hover-mouse:bg-chip'}`;
  const tagChip = (on) => `shrink-0 h-8 px-2.5 rounded-full text-[13px] cursor-pointer whitespace-nowrap border ${on ? 'bg-accent-soft text-accent-ink border-accent font-bold' : 'bg-transparent text-muted border-line hover-mouse:text-ink'}`;

  const draw = () => {
    const all = list || [];
    const hasMeta = all.some((n) => genresOf(n).length || (n.tags || []).length);
    // 지금 데이터에 없는 장르·태그 선택은 버림 (관리 탭에서 바뀌었을 때)
    filter.genres = filter.genres.filter((g) => all.some((n) => genresOf(n).includes(g)));
    filter.tags = filter.tags.filter((t) => all.some((n) => (n.tags || []).includes(t)));
    const f = filterNovels(all, filter);
    const TAG_MAX = 10;
    const tags = moreTags ? f.tags : f.tags.slice(0, TAG_MAX);
    const any = filter.genres.length || filter.tags.length;
    mount(view, html`
    <header class="h-16 px-5 lg:px-12 lg:pt-6 flex items-center">
      <h1 class="m-0 text-[22px] font-bold">소설</h1>
    </header>
    <div class="px-5 lg:px-12 pb-10 max-w-[1180px] flex flex-col gap-3">
      ${hasMeta ? html`
        <div class="relative flex gap-1.5 overflow-x-auto [scrollbar-width:none]" data-keep-scroll="genres" role="group" aria-label="장르 (여러 개 고르면 모두 포함)">
          <button type="button" data-action="genre" data-v="" aria-pressed="${String(!filter.genres.length)}" class="${chip(!filter.genres.length)}">전체 <span class="opacity-70">${all.length}</span></button>
          ${f.genres.map((g) => { const on = filter.genres.includes(g.name); return html`<button type="button" data-action="genre" data-v="${g.name}" aria-pressed="${String(on)}" class="${chip(on)}" ${!on && !g.count ? 'disabled' : ''}>${g.name} <span class="${on ? 'opacity-70' : 'text-muted'}">${g.count}</span></button>`; })}
        </div>
        ${f.tags.length || any ? html`
          <div class="flex flex-wrap gap-1.5" role="group" aria-label="태그 (여러 개 고르면 모두 포함)">
            ${tags.map((t) => { const on = filter.tags.includes(t.name); return html`<button type="button" data-action="tag" data-v="${t.name}" aria-pressed="${String(on)}" class="${tagChip(on)}" ${!on && !t.count ? 'disabled' : ''}>#${t.name} <span class="opacity-70">${t.count}</span></button>`; })}
            ${f.tags.length > TAG_MAX ? html`<button type="button" data-action="more-tags" class="h-8 px-2.5 rounded-full text-[13px] border-0 bg-transparent text-muted cursor-pointer underline">${moreTags ? '접기' : `더보기 ${f.tags.length - TAG_MAX}`}</button>` : ''}
            ${any ? html`<button type="button" data-action="clear" class="h-8 px-2.5 rounded-full text-[13px] border-0 bg-transparent text-accent-ink cursor-pointer">조건 지우기</button>` : ''}
          </div>` : ''}` : ''}
      ${!list ? html`<p class="text-sm text-muted py-6">${error || '불러오는 중…'}</p>` : ''}
      ${list && !all.length ? html`<p class="text-sm text-muted py-6">아직 올라온 소설이 없어요.</p>` : ''}
      ${list && all.length && !f.list.length ? html`<p class="text-sm text-muted py-6">조건에 맞는 소설이 없어요.</p>` : ''}
      <div class="nv-grid">
        ${f.list.map((n) => {
          const st = novelStats(n);
          const pct = n.chapter_count ? Math.round((st.read / n.chapter_count) * 100) : 0;
          const ntags = n.tags || [];
          return html`
          <article class="nv-card">
            <a href="#/n/${encodeURIComponent(n.id)}" class="nv-card-link" aria-label="${n.title}">
              ${coverBox(n)}
              ${fresh[n.id] ? html`<span class="nv-badge">새 ${fresh[n.id]}</span>` : ''}
              ${st.started ? html`<span class="nv-card-p" aria-label="${st.read.toLocaleString()} / ${n.chapter_count.toLocaleString()}화 읽음"><i style="width:${Math.max(3, pct)}%"></i></span>` : ''}
            </a>
            <a href="#/n/${encodeURIComponent(n.id)}" class="nv-card-t">${n.title}</a>
            <span class="nv-card-a">${n.author ? html`<span>${n.author}</span> · ` : ''}${n.chapter_count.toLocaleString()}화${st.started ? ` · ${pct}%` : ''}</span>
            ${genresOf(n).length ? html`<span class="nv-card-g">${genresOf(n).map((g) => html`<button type="button" data-action="genre-add" data-v="${g}" class="nv-gchip ${filter.genres.includes(g) ? 'is-on' : ''}">${g}</button>`)}</span>` : ''}
            ${ntags.length ? html`<span class="nv-card-tags">
              ${ntags.slice(0, 3).map((t) => html`<button type="button" data-action="tag" data-v="${t}" class="${filter.tags.includes(t) ? 'is-on' : ''}">#${t}</button>`)}
              ${ntags.length > 3 ? html`<span>+${ntags.length - 3}</span>` : ''}
            </span>` : ''}
            ${st.cont && st.started ? html`
              <a href="${chapterHref(n.id, st.cont.chapter.key)}" class="nv-card-go">${icon('play', 13)}<span>${chapterNoLabel(st.cont.chapter) || '이어 읽기'}</span></a>` : ''}
          </article>`;
        })}
      </div>
    </div>`);
  };

  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  onAction(view, {
    genre(b) {
      const g = b.dataset.v;
      filter.genres = g ? toggle(filter.genres, g) : [];
      saveFilter(filter); draw();
    },
    'genre-add'(b) {
      if (!filter.genres.includes(b.dataset.v)) filter.genres = [...filter.genres, b.dataset.v];
      saveFilter(filter); draw(); window.scrollTo({ top: 0 });
    },
    tag(b) {
      filter.tags = toggle(filter.tags, b.dataset.v);
      saveFilter(filter); draw();
    },
    'more-tags'() { moreTags = !moreTags; draw(); },
    clear() { filter = { genres: [], tags: [] }; saveFilter(filter); draw(); },
  });

  const refresh = async () => {
    try {
      const [ns] = await Promise.all([loadNovels(), loadReading().catch(() => null)]);
      list = ns;
      draw();
      // 표지 주소 (받은 게 있으면 다시 그림)
      signCovers(ns.map((n) => n.cover_path)).then((got) => { if (got && view.isConnected) draw(); }).catch(() => {});
      // 새 회차: 마지막으로 연 뒤 회차가 추가된 소설만 개수 확인
      await Promise.all(ns.map(async (n) => {
        const since = lastOpened(novelReading(n.id));
        if (since && n.last_added_at && n.last_added_at > since) {
          const c = await countNewSince(n.id, since);
          if (c) fresh[n.id] = c;
        }
      }));
      if (view.isConnected) draw();
    } catch (err) { error = errorMessage(err); if (!list) draw(); else toast(error); }
  };
  draw();
  refresh();
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
            ${coverBox(novel, { cls: 'is-lg' })}
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
  });
  // 장르 칩 → 그 장르로 거른 소설 목록
  view.addEventListener('click', (e) => {
    const g = e.target.closest?.('[data-genre]');
    if (g) saveFilter({ genres: [g.dataset.genre], tags: [] });
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
      if (!scrolled) { scrolled = true; requestAnimationFrame(jump); }
    } catch (err) { error = errorMessage(err); if (!chapters) draw(); else toast(error); }
  })();
}
