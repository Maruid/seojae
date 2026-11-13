// #/downloads — 다운로드 관리 (받아 둔 소설 · 칼럼)
//   - 이번 달 남은 한도, 서버에서 내려가 지운 것 알림
//   - 소설: 새 회차 · 바뀐 회차 · 다시 나뉨 · 보류 표시, 업데이트 / 회차 고르기 / 다 읽은 회차 지우기 / ★ / 지우기
//   - 칼럼: 분류별, 다 읽은 글 지우기 / 하나씩 지우기
import { html, mount, onAction, toast } from '../lib/dom.js';
import { icon } from '../components/icons.js';
import { coverBox } from '../components/cover.js';
import { confirmBox } from '../components/modal.js';
import { canAccess } from '../lib/nav.js';
import { cachedChapters } from '../lib/novels.js';
import { cachedColumns, fmtDate } from '../lib/columns.js';
import { novelReading, getReading, statusOf, loadReading } from '../lib/progress.js';
import { fmtBytes, resplitRange } from '../lib/offline/plan.js';
import { cachedQuota, loadQuota, resetText, onQuota } from '../lib/offline/quota.js';
import { refreshIndex, savedNovelsNow, savedColumnsNow, novelDiff, reconcile, deleteNovel, deleteChapters, deleteColumns, setStar, onSaved } from '../lib/offline/index.js';
import { takeNotices } from '../lib/offline/store.js';
import { openNovelDownload, openNovelUpdate, openColumnDownload } from '../components/dlFlow.js';
import { onJob, currentJob } from '../lib/offline/engine.js';

export function renderDownloads(view, app, ctx) {
  let tab = sessionStorage.getItem('ui:dlTab') || (canAccess(app.me, 'novel') ? 'novels' : 'columns');
  let notices = [];
  let checking = false;
  const canN = canAccess(app.me, 'novel');
  const canC = canAccess(app.me, 'column');
  if (tab === 'novels' && !canN) tab = 'columns';

  const serverOf = (id) => cachedChapters(id) || savedNovelsNow().get(id)?.rec.chapters || [];

  const novelCard = (id, s) => {
    const n = s.rec.meta || { id, title: id };
    const server = serverOf(id);
    const d = navigator.onLine ? novelDiff(id, server) : { fresh: [], changed: [], gone: [], resplit: false };
    const rows = novelReading(id);
    const readSaved = [...s.saved.keys()].filter((k) => statusOf(rows[k]) === 'read');
    const resplit = s.rec.resplit || d.resplit;
    return html`
      <article class="dl-card">
        <div class="dl-card-top">
          <a href="#/n/${encodeURIComponent(id)}" class="dl-cv" aria-label="${n.title}">${coverBox(n, { ph: false })}</a>
          <div class="dl-card-info">
            <b>${s.rec.star ? '★ ' : ''}${n.title}</b>
            <span>받은 ${s.saved.size}화 · ${fmtBytes(s.bytes)}${readSaved.length ? ` · 다 읽은 회차 ${readSaved.length}` : ''}</span>
            ${resplit ? html`<span class="dl-warn-t">회차가 새로 나뉘었어요. 받은 범위를 다시 받을까요?</span>` : html`
              <span class="dl-badges">
                ${d.fresh.length ? html`<span class="dl-badge is-acc">새 회차 ${d.fresh.length}</span>` : ''}
                ${d.changed.length ? html`<span class="dl-badge is-acc">바뀐 회차 ${d.changed.length}</span>` : ''}
                ${d.changed.length && navigator.onLine ? html`<span class="dl-badge">보류 · 한도가 남으면 자동으로 받아요</span>` : ''}
              </span>`}
          </div>
          <button type="button" class="dl-star ${s.rec.star ? 'is-on' : ''}" data-action="star" data-id="${id}" aria-pressed="${String(!!s.rec.star)}" aria-label="남기고 싶은 소설 표시">${icon('star', 18)}</button>
        </div>
        <div class="dl-btns">
          ${resplit ? html`<button type="button" class="dl-b is-main" data-action="resplit" data-id="${id}">받은 회차 다시 받기</button>`
            : d.fresh.length || d.changed.length ? html`<button type="button" class="dl-b is-main" data-action="update" data-id="${id}">업데이트</button>` : ''}
          <button type="button" class="dl-b" data-action="pick" data-id="${id}">회차 고르기</button>
          ${readSaved.length ? html`<button type="button" class="dl-b" data-action="delread" data-id="${id}">다 읽은 회차 지우기</button>` : ''}
          <button type="button" class="dl-b is-danger" data-action="del" data-id="${id}">지우기</button>
        </div>
      </article>`;
  };

  const columnsTab = () => {
    const saved = savedColumnsNow();
    const server = new Map((cachedColumns() || []).map((c) => [c.id, c]));
    const byCat = new Map();
    for (const c of saved.values()) {
      const cat = c.meta?.category || '기타';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(c);
    }
    if (!byCat.size) return html`<p class="dl-empty">받아 둔 칼럼이 없어요. 칼럼 목록이나 글 위쪽의 ${icon('download', 15)} 버튼으로 받을 수 있어요.</p>`;
    return [...byCat.entries()].map(([cat, list]) => {
      const bytes = list.reduce((s, c) => s + (c.bytes || 0), 0);
      const read = list.filter((c) => statusOf(getReading('column', c.colId)) === 'read');
      return html`
        <section class="dl-grp" aria-label="${cat}">
          <div class="dl-gh"><b>${cat} <small>· ${list.length}개 · ${fmtBytes(bytes)}</small></b>
            ${read.length ? html`<button type="button" class="dl-b" data-action="delcolread" data-cat="${cat}">다 읽은 글 지우기</button>` : ''}</div>
          ${list.sort((a, b) => String(b.meta?.published_at).localeCompare(String(a.meta?.published_at))).map((c) => {
            const s = server.get(c.colId);
            const changed = s && s.content_hash && c.hash && s.content_hash !== c.hash;
            return html`
              <div class="dl-it">
                <a href="#/c/${encodeURIComponent(c.colId)}" class="dl-it-t"><b>${c.meta?.title || c.colId}</b>
                  <small>${fmtBytes(c.bytes)} · ${c.textOnly ? '글만' : '이미지 포함'}${statusOf(getReading('column', c.colId)) === 'read' ? ' · 다 읽음' : ''} · ${fmtDate(c.meta?.published_at)}</small></a>
                ${changed ? html`<span class="dl-badge is-acc">바뀜</span>` : ''}
                <button type="button" class="dl-x" data-action="delcol" data-id="${c.colId}" aria-label="${c.meta?.title || ''} 지우기">${icon('trash', 18)}</button>
              </div>`;
          })}
        </section>`;
    });
  };

  const draw = () => {
    const q = cachedQuota();
    const novels = [...savedNovelsNow().entries()].filter(([, s]) => s.saved.size || s.rec);
    const cols = savedColumnsNow();
    const total = novels.reduce((s, [, x]) => s + x.bytes, 0) + [...cols.values()].reduce((s, c) => s + (c.bytes || 0), 0);
    const upd = novels.filter(([id]) => { const d = novelDiff(id, serverOf(id)); return d.fresh.length || d.changed.length; });
    mount(view, html`
      <header class="h-16 px-2 lg:px-10 lg:pt-6 flex items-center gap-1">
        <a href="#/me" class="w-11 h-11 rounded-full flex items-center justify-center text-ink hover-mouse:bg-chip" aria-label="내 정보">${icon('back', 24)}</a>
        <h1 class="m-0 flex-1 text-[20px] font-bold">다운로드 관리</h1>
        ${checking ? html`<span class="text-xs text-muted pr-3">확인 중…</span>` : ''}
      </header>
      <div class="px-4 lg:px-12 pb-10 max-w-[760px] flex flex-col gap-3">
        ${canN && canC ? html`
          <div role="tablist" aria-label="보관함" class="grid grid-cols-2 gap-1 p-1 rounded-xl bg-chip">
            ${[['novels', `소설 ${novels.length}`], ['columns', `칼럼 ${cols.size}`]].map(([k, l]) => html`
              <button type="button" role="tab" aria-selected="${String(tab === k)}" data-action="tab" data-v="${k}"
                class="h-9 rounded-[10px] border-0 text-sm cursor-pointer ${tab === k ? 'bg-surface text-ink font-bold shadow-sm' : 'bg-transparent text-muted'}">${l}</button>`)}
          </div>` : ''}
        <p class="dl-qline">${q?.unlimited ? '관리자 · 다운로드 한도 없음'
          : q ? html`이번 달 남은 한도 <b>${fmtBytes(Math.max(0, (q.limit || 0) - (q.used || 0)))}</b> / ${fmtBytes(q.limit)} · ${resetText(q)}에 다시 채워짐` : '한도 정보를 불러오는 중…'}</p>
        ${notices.map((x, i) => html`
          <div class="dl-notice" role="status"><span>${x.text}</span><button type="button" data-action="dismiss" data-i="${i}" aria-label="알림 닫기">×</button></div>`)}
        ${!navigator.onLine ? html`<p class="dl-notice">오프라인이라 업데이트를 확인할 수 없어요. 받아 둔 글은 그대로 읽을 수 있어요.</p>` : ''}
        ${tab === 'novels' ? html`
          ${upd.length && navigator.onLine ? html`<button type="button" class="dl-b is-main is-wide" data-action="updall">모두 업데이트 · ${upd.length}편</button>` : ''}
          ${novels.length ? novels.map(([id, s]) => novelCard(id, s)) : html`<p class="dl-empty">받아 둔 소설이 없어요. 소설 상세의 [회차 받기]나 소설 목록의 [여러 편 받기]로 받을 수 있어요.</p>`}`
          : columnsTab()}
        <p class="dl-foot">이 브라우저에 저장됨 · 합계 ${fmtBytes(total)}<br>다른 브라우저(앱)에서는 따로 받아요 · 지워도 이번 달 한도는 그대로예요</p>
      </div>`);
  };

  const run = async (p) => { await p; await refreshIndex(); if (view.isConnected) draw(); };
  const novelOf = (id) => savedNovelsNow().get(id)?.rec.meta || { id, title: id };

  onAction(view, {
    tab(b) { tab = b.dataset.v; try { sessionStorage.setItem('ui:dlTab', tab); } catch {} draw(); },
    dismiss(b) { notices.splice(+b.dataset.i, 1); draw(); },
    star(b) { const s = savedNovelsNow().get(b.dataset.id); run(setStar(b.dataset.id, !s?.rec.star)); },
    update(b) { run(openNovelUpdate([novelOf(b.dataset.id)])); },
    updall() {
      const ids = [...savedNovelsNow().keys()].filter((id) => { const d = novelDiff(id, serverOf(id)); return d.fresh.length || d.changed.length; });
      run(openNovelUpdate(ids.map(novelOf)));
    },
    resplit(b) {
      const id = b.dataset.id; const s = savedNovelsNow().get(id);
      const server = serverOf(id); const old = s.rec.chapters || [];
      const keys = resplitRange({ oldTotal: old.length, oldIdx: [...s.saved.keys()].map((k) => old.findIndex((c) => c.key === k)).filter((x) => x >= 0) }, server);
      run(openNovelUpdate([novelOf(id)], { [id]: keys }));
    },
    pick(b) { run(openNovelDownload([novelOf(b.dataset.id)])); },
    async delread(b) {
      const id = b.dataset.id; const rows = novelReading(id);
      const keys = [...savedNovelsNow().get(id).saved.keys()].filter((k) => statusOf(rows[k]) === 'read');
      if (await confirmBox({ title: `다 읽은 회차 ${keys.length}화를 지울까요?`, body: '지워도 이번 달 한도는 그대로예요.', ok: '지우기' })) { await deleteChapters(id, keys); run(null); toast('지웠어요.'); }
    },
    async del(b) {
      const n = novelOf(b.dataset.id);
      if (await confirmBox({ title: `「${n.title}」 받은 회차를 모두 지울까요?`, body: '지워도 이번 달 한도는 그대로예요. 다시 받으면 또 세요.', ok: '지우기', danger: true })) { await deleteNovel(b.dataset.id); run(null); toast('지웠어요.'); }
    },
    async delcol(b) { await deleteColumns([b.dataset.id]); draw(); toast('지웠어요.'); },
    async delcolread(b) {
      const ids = [...savedColumnsNow().values()].filter((c) => (c.meta?.category || '기타') === b.dataset.cat && statusOf(getReading('column', c.colId)) === 'read').map((c) => c.colId);
      if (await confirmBox({ title: `다 읽은 글 ${ids.length}개를 지울까요?`, body: '지워도 이번 달 한도는 그대로예요.', ok: '지우기' })) { await deleteColumns(ids); draw(); toast('지웠어요.'); }
    },
  });

  const offs = [onSaved(() => { if (view.isConnected) draw(); }), onQuota(() => { if (view.isConnected) draw(); }), onJob(() => { if (!currentJob() && view.isConnected) draw(); })];
  draw();
  (async () => {
    notices = await takeNotices();
    await Promise.all([refreshIndex(), loadReading().catch(() => null)]);
    if (view.isConnected) draw();
    if (navigator.onLine) {
      checking = true; draw();
      loadQuota().catch(() => null);
      // 화면을 열 때는 자동 받기 없이 상태만 맞춤
      await reconcile({ ...ctx, auto: false }).catch(() => null);
      notices = [...notices, ...(await takeNotices())];
      checking = false;
      if (view.isConnected) draw();
    }
  })();
  return () => offs.forEach((f) => f());
}

// 칼럼 목록에서 쓰는 바로 가기
export { openColumnDownload };
