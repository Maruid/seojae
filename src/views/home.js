import { html, mount } from '../lib/dom.js';
import { supabase } from '../lib/supabase.js';
import { canAccess } from '../lib/nav.js';
import { icon } from '../components/icons.js';
import { initial } from '../components/layout.js';
import { loadColumns, cachedColumns } from '../lib/columns.js';
import { loadReading, allReading, statusOf } from '../lib/progress.js';
import { loadNovels, cachedNovels, cachedChapters } from '../lib/novels.js';
import { chapterLabel } from '../lib/novelText.js';

// 이어 읽기: 권한 있는 섹터에서 읽는 중인 글·회차 중 가장 최근에 본 것
async function continueItem(me) {
  const hasCol = canAccess(me, 'column');
  const hasNov = canAccess(me, 'novel');
  const rows = Object.values(allReading())
    .filter((r) => statusOf(r) === 'reading' && ((r.item_kind === 'column' && hasCol) || (r.item_kind === 'chapter' && hasNov)))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  for (const r of rows.slice(0, 5)) {
    if (r.item_kind === 'column') {
      const c = (cachedColumns() || []).find((x) => x.id === r.item_id);
      if (c) return { href: `#/c/${encodeURIComponent(c.id)}`, label: `칼럼 · ${c.category || ''}`, title: c.title, progress: r.progress || 0 };
    } else {
      const n = (cachedNovels() || []).find((x) => x.id === r.novel_id);
      if (!n) continue;
      const key = r.item_id.slice(r.novel_id.length + 1);
      let ch = (cachedChapters(n.id) || []).find((c) => c.key === key);
      if (!ch) {
        const { data } = await supabase.from('novel_chapters').select('key,title,display_title')
          .eq('novel_id', n.id).eq('key', key).maybeSingle();
        ch = data;
      }
      if (ch) return { href: `#/n/${encodeURIComponent(n.id)}/${encodeURIComponent(key)}`, label: `소설 · ${n.title}`, title: chapterLabel(ch), progress: r.progress || 0 };
    }
  }
  return null;
}

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

async function loadStats(me) {
  const out = { columns: null, unread: null, novels: null, chapters: null, recent: [], cont: null };
  const jobs = [loadReading().catch(() => null)];
  if (canAccess(me, 'column')) jobs.push(loadColumns().then((cols) => fillColumns(out, cols)));
  if (canAccess(me, 'novel')) jobs.push(loadNovels().then((ns) => fillNovels(out, ns)));
  await Promise.allSettled(jobs);
  if (out.columns != null) fillColumns(out, cachedColumns());   // 읽기 기록이 늦게 와도 안 읽음 수 다시
  out.cont = await continueItem(me).catch(() => null);
  return out;
}

function fillColumns(out, cols) {
  out.columns = cols.length;
  out.recent = cols.slice(0, 5);
  out.unread = cols.filter((c) => statusOf(allReading()[`column:${c.id}`]) === 'unread').length;
}
function fillNovels(out, ns) {
  out.novels = ns.length;
  out.chapters = ns.reduce((a, n) => a + (n.chapter_count || 0), 0);
}

export async function renderHome(view, app) {
  const me = app.me;
  const hasCol = canAccess(me, 'column');
  const hasNov = canAccess(me, 'novel');
  const sectorCount = (hasCol ? 1 : 0) + (hasNov ? 1 : 0);

  const draw = (st) => mount(view, html`
    <header class="lg:hidden h-16 px-5 flex items-center justify-between">
      <span class="font-serif text-[22px] font-bold">서재</span>
      <a href="#/me" aria-label="내 정보" class="w-11 h-11 rounded-full bg-chip text-muted font-bold text-[15px] no-underline flex items-center justify-center">${initial(me)}</a>
    </header>
    <div class="px-5 pt-1 pb-8 lg:px-12 lg:pt-10 max-w-[1080px] mx-auto flex flex-col gap-7 lg:gap-9">
      ${sectorCount === 0 ? html`
        <div class="bg-surface border border-line rounded-2xl p-6 flex flex-col gap-2">
          <h1 class="m-0 text-xl font-bold">아직 열람 권한이 없어요</h1>
          <p class="m-0 text-sm leading-relaxed text-muted">관리자가 칼럼이나 소설 권한을 주면 여기에 나타나요.</p>
        </div>` : html`
      <section class="flex flex-col gap-3">
        <h2 class="m-0 text-[15px] lg:text-[28px] font-bold text-muted lg:text-ink">이어 읽기</h2>
        ${st.cont ? html`
          <a href="${st.cont.href}" class="no-underline bg-hero text-hero-ink rounded-[18px] p-5 flex flex-col gap-2.5 hover-mouse:opacity-95">
            <span class="text-xs text-hero-muted">${st.cont.label}</span>
            <span class="text-[18px] lg:text-[20px] font-bold leading-snug">${st.cont.title}</span>
            <span class="flex items-center gap-3 text-xs text-hero-muted">
              <span class="flex-1 h-1 rounded-full bg-white/15 overflow-hidden"><span class="block h-full bg-accent" style="width:${Math.max(4, Math.round(st.cont.progress * 100))}%"></span></span>
              ${Math.round(st.cont.progress * 100)}% · 이어 읽기 ›</span>
          </a>` : html`
        <div class="rounded-[18px] border border-dashed border-line p-5 text-sm text-muted">읽던 글이 생기면 여기에서 바로 이어 읽을 수 있어요.</div>`}
      </section>

      <div class="flex flex-col lg:flex-row lg:flex-wrap gap-7 lg:gap-8">
        <section class="flex flex-col gap-3 lg:flex-[1_1_320px]">
          <h2 class="m-0 text-[15px] font-bold text-muted">내 서재</h2>
          <div class="grid gap-3 ${sectorCount === 2 ? 'grid-cols-2' : 'grid-cols-1'}">
            ${hasCol ? html`
              <a href="#/columns" class="no-underline text-ink bg-surface border border-line rounded-[18px] p-[18px] flex ${sectorCount === 1 ? 'items-center gap-4' : 'flex-col gap-4'} hover-mouse:border-muted">
                <span class="text-ink">${icon('columns', 26, 1.8)}</span>
                <span class="flex flex-col gap-1 flex-1"><span class="text-[17px] font-bold">칼럼</span>
                  <span class="text-[13px] text-muted">${st.columns == null ? '…' : `${st.columns}편${st.unread ? ` · 안 읽음 ${st.unread}` : ''}`}</span></span>
              </a>` : ''}
            ${hasNov ? html`
              <a href="#/novels" class="no-underline text-ink bg-surface border border-line rounded-[18px] p-[18px] flex ${sectorCount === 1 ? 'items-center gap-4' : 'flex-col gap-4'} hover-mouse:border-muted">
                <span class="text-ink">${icon('novels', 26, 1.8)}</span>
                <span class="flex flex-col gap-1 flex-1"><span class="text-[17px] font-bold">소설</span>
                  <span class="text-[13px] text-muted">${st.novels == null ? '…' : `${st.novels}편 · ${st.chapters.toLocaleString()}화`}</span></span>
              </a>` : ''}
          </div>
        </section>

        ${hasCol ? html`
        <section class="flex flex-col gap-1 lg:flex-[1.4_1_420px]">
          <h2 class="m-0 mb-2 text-[15px] font-bold text-muted">최근 올라온 칼럼</h2>
          ${st.recent.length ? st.recent.map((c, i) => html`
            <a href="#/c/${encodeURIComponent(c.id)}" class="no-underline text-ink py-2.5 flex gap-3 items-baseline ${i < st.recent.length - 1 ? 'border-b border-line' : ''}">
              <span class="flex-1 text-[15px] truncate">${c.title}</span>
              <span class="text-xs text-muted shrink-0"><span class="hidden lg:inline">${c.category} · </span>${fmtDate(c.published_at)}</span>
            </a>`) : html`<span class="text-sm text-muted py-2">${st.columns === 0 ? '아직 올라온 칼럼이 없어요' : '불러오는 중…'}</span>`}
        </section>` : ''}
      </div>`}
    </div>`);

  const first = { columns: null, unread: null, novels: null, chapters: null, recent: [], cont: null };
  if (hasCol && cachedColumns()) fillColumns(first, cachedColumns());
  if (hasNov && cachedNovels()) fillNovels(first, cachedNovels());
  draw(first);
  if (sectorCount) draw(await loadStats(me));
}
