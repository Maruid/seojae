import { html, mount } from '../lib/dom.js';
import { supabase } from '../lib/supabase.js';
import { canAccess } from '../lib/nav.js';
import { icon } from '../components/icons.js';
import { initial } from '../components/layout.js';

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

async function loadStats(me) {
  const out = { columns: null, novels: null, chapters: null, recent: [] };
  const jobs = [];
  if (canAccess(me, 'column')) {
    jobs.push(supabase.from('columns').select('id', { count: 'exact', head: true }).then(({ count }) => { out.columns = count; }));
    jobs.push(supabase.from('columns').select('id,title,category,published_at').order('published_at', { ascending: false }).limit(5)
      .then(({ data }) => { out.recent = data || []; }));
  }
  if (canAccess(me, 'novel')) {
    jobs.push(supabase.from('novels').select('chapter_count').then(({ data }) => {
      out.novels = data?.length ?? null;
      out.chapters = data?.reduce((a, n) => a + (n.chapter_count || 0), 0) ?? null;
    }));
  }
  await Promise.allSettled(jobs);
  return out;
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
          <h1 class="m-0 font-serif text-xl font-bold">아직 열람 권한이 없어요</h1>
          <p class="m-0 text-sm leading-relaxed text-muted">관리자가 칼럼이나 소설 권한을 주면 여기에 나타나요.</p>
        </div>` : html`
      <section class="flex flex-col gap-3">
        <h2 class="m-0 text-[15px] lg:font-serif lg:text-[30px] font-bold text-muted lg:text-ink">이어 읽기</h2>
        <div class="rounded-[18px] border border-dashed border-line p-5 text-sm text-muted">읽던 글이 생기면 여기에서 바로 이어 읽을 수 있어요.</div>
      </section>

      <div class="flex flex-col lg:flex-row lg:flex-wrap gap-7 lg:gap-8">
        <section class="flex flex-col gap-3 lg:flex-[1_1_320px]">
          <h2 class="m-0 text-[15px] font-bold text-muted">내 서재</h2>
          <div class="grid gap-3 ${sectorCount === 2 ? 'grid-cols-2' : 'grid-cols-1'}">
            ${hasCol ? html`
              <a href="#/columns" class="no-underline text-ink bg-surface border border-line rounded-[18px] p-[18px] flex ${sectorCount === 1 ? 'items-center gap-4' : 'flex-col gap-4'} hover-mouse:border-muted">
                <span class="text-ink">${icon('columns', 26, 1.8)}</span>
                <span class="flex flex-col gap-1 flex-1"><span class="text-[17px] font-bold">칼럼</span>
                  <span class="text-[13px] text-muted">${st.columns == null ? '…' : `${st.columns}편`}</span></span>
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

  draw({ columns: null, novels: null, chapters: null, recent: [] });
  if (sectorCount) draw(await loadStats(me));
}
