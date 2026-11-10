// 관리 (#/admin) — 관리자만
//   - 위: 사용량 (승인 대기 · 이용 중 · 7일 접속 · DB/Storage 무료 한도 대비)
//   - 검색(이름·이메일, 화면에서 바로 거름) + 상태 필터(전체/대기/이용 중/차단)
//   - 대기: [승인] [차단] / 이용 중: 섹터 권한 켜고 끄기 + ⋯ 메뉴로 차단 / 차단: ⋯ 메뉴로 차단 해제
//   - 섹터 권한은 승인 전에도 미리 줄 수 있음 (승인되는 순간 바로 보임)
import { html, mount, onAction, toast } from '../lib/dom.js';
import { rpc, errorMessage } from '../lib/supabase.js';
import { fmtDate } from '../lib/columns.js';
import { icon } from '../components/icons.js';
import { createNovelAdmin } from './adminNovels.js';

const FILTERS = [['all', '전체'], ['pending', '대기'], ['approved', '이용 중'], ['blocked', '차단']];
const LIMIT = { db: 500 * 1024 * 1024, storage: 1024 * 1024 * 1024 };
const mb = (b) => (b >= 1024 * 1024 * 1024 ? `${(b / 1024 ** 3).toFixed(2)}GB` : `${Math.round(b / 1024 / 1024)}MB`);

function ago(iso) {
  if (!iso) return '접속 기록 없음';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return '방금 전 접속';
  if (m < 60 * 24) return `${Math.round(m / 60)}시간 전 접속`;
  if (m < 60 * 24 * 30) return `${Math.round(m / 1440)}일 전 접속`;
  return `${fmtDate(iso)} 접속`;
}

// 확인 창 (window.confirm 대신 화면 안에서)
export function confirmBox({ title, body, ok = '확인', danger = false }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'cf-root';
    mount(root, html`
      <div class="cf-back" data-action="no"></div>
      <div class="cf-box" role="alertdialog" aria-modal="true" aria-label="${title}">
        <strong>${title}</strong>
        ${body ? html`<p>${body}</p>` : ''}
        <div class="cf-btns">
          <button type="button" data-action="no">취소</button>
          <button type="button" data-action="yes" class="${danger ? 'is-danger' : 'is-main'}">${ok}</button>
        </div>
      </div>`);
    document.body.appendChild(root);
    const done = (v) => { off(); document.removeEventListener('keydown', key, true); root.remove(); resolve(v); };
    const off = onAction(root, { yes: () => done(true), no: () => done(false) });
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    document.addEventListener('keydown', key, true);
    root.querySelector('[data-action="yes"]').focus();
  });
}

export function renderAdmin(view, app, { onPendingChange } = {}) {
  let users = null;
  let stats = null;
  let error = null;
  let q = '';
  let filter = sessionStorage.getItem('ui:adminFilter') || 'all';
  let menuFor = null;          // ⋯ 메뉴가 열린 user_id
  let tab = sessionStorage.getItem('ui:adminTab') || 'users';   // users | novels
  const nv = createNovelAdmin(() => { if (view.isConnected) draw(); });
  const busy = new Set();      // 저장 중인 user_id
  const sectors = (app.me.sectors || []).filter((s) => s.key);
  const myId = app.session?.user?.id;

  const counts = () => {
    const c = { all: 0, pending: 0, approved: 0, blocked: 0 };
    for (const u of users || []) { c.all++; c[u.status]++; }
    return c;
  };
  const visible = () => {
    const k = q.trim().toLowerCase();
    return (users || []).filter((u) => (filter === 'all' || u.status === filter)
      && (!k || (u.display_name || '').toLowerCase().includes(k) || (u.email || '').toLowerCase().includes(k)));
  };

  const statusBadge = (u) => ({
    pending: html`<span class="ad-badge is-pending">대기</span>`,
    approved: html`<span class="ad-badge is-ok">이용 중</span>`,
    blocked: html`<span class="ad-badge is-blocked">차단</span>`,
  }[u.status]);

  const card = (u) => {
    const self = u.user_id === myId;
    const isBusy = busy.has(u.user_id);
    return html`
      <li class="ad-card ${isBusy ? 'is-busy' : ''}" data-id="${u.user_id}">
        <div class="ad-top">
          <span class="ad-avatar">${(u.display_name || u.email || '?').trim().charAt(0).toUpperCase()}</span>
          <div class="ad-who">
            <span class="ad-name">${u.display_name || '(이름 없음)'} ${self ? html`<em>나</em>` : ''}</span>
            <span class="ad-mail">${u.email || ''}</span>
            <span class="ad-meta">${fmtDate(u.created_at)} 가입 · ${ago(u.last_seen_at)}</span>
          </div>
          ${u.is_admin ? html`<span class="ad-badge is-admin">관리자</span>` : statusBadge(u)}
          ${!self && !u.is_admin && u.status !== 'pending' ? html`
            <div class="ad-more">
              <button type="button" class="ad-dots" data-action="menu" data-id="${u.user_id}" aria-label="더보기" aria-expanded="${String(menuFor === u.user_id)}">⋯</button>
              ${menuFor === u.user_id ? html`
                <div class="ad-menu" role="menu">
                  ${u.status === 'approved'
                    ? html`<button type="button" role="menuitem" class="is-danger" data-action="block" data-id="${u.user_id}">차단하기</button>
                           <button type="button" role="menuitem" data-action="pend" data-id="${u.user_id}">대기로 되돌리기</button>`
                    : html`<button type="button" role="menuitem" data-action="unblock" data-id="${u.user_id}">차단 해제</button>`}
                </div>` : ''}
            </div>` : ''}
        </div>
        ${u.is_admin ? html`<p class="ad-note">관리자는 모든 섹터를 볼 수 있어요.</p>` : html`
          <div class="ad-grants" role="group" aria-label="열람 권한">
            <span>열람 권한</span>
            ${sectors.map((s) => {
              const on = (u.sectors || []).includes(s.key);
              return html`<button type="button" class="ad-chip ${on ? 'is-on' : ''}" aria-pressed="${String(on)}" data-action="grant" data-id="${u.user_id}" data-sector="${s.key}" ${u.status === 'blocked' ? 'disabled' : ''}>
                ${on ? icon('check', 14, 2.6) : ''}${s.name}</button>`;
            })}
          </div>
          ${u.status === 'pending' ? html`
            <div class="ad-actions">
              <button type="button" class="ad-btn is-main" data-action="approve" data-id="${u.user_id}">승인</button>
              <button type="button" class="ad-btn" data-action="block" data-id="${u.user_id}">차단</button>
              ${!(u.sectors || []).length ? html`<span class="ad-hint">권한을 먼저 켜 두면 승인과 동시에 볼 수 있어요</span>` : ''}
            </div>` : ''}
          ${u.status === 'blocked' ? html`<p class="ad-note">차단을 풀면 지금 권한 그대로 다시 볼 수 있어요.</p>` : ''}`}
      </li>`;
  };

  const usage = () => {
    if (!stats) return '';
    const dbp = Math.min(100, (stats.db_size_bytes / LIMIT.db) * 100);
    const stp = Math.min(100, (stats.storage_bytes / LIMIT.storage) * 100);
    return html`
      <section class="ad-stats" aria-label="사용 현황">
        <div><b>${stats.users_pending}</b><span>승인 대기</span></div>
        <div><b>${stats.users_approved}</b><span>이용 중</span></div>
        <div><b>${stats.active_7d}</b><span>7일 내 접속</span></div>
        <div><b>${stats.columns}</b><span>칼럼</span></div>
        <div><b>${stats.novels}<small> · ${Number(stats.chapters).toLocaleString()}화</small></b><span>소설</span></div>
        <div class="ad-bar"><span>DB ${mb(stats.db_size_bytes)} / 500MB</span><i><em style="width:${dbp}%" class="${dbp > 80 ? 'is-warn' : ''}"></em></i></div>
        <div class="ad-bar"><span>파일 ${mb(stats.storage_bytes)} / 1GB</span><i><em style="width:${stp}%" class="${stp > 80 ? 'is-warn' : ''}"></em></i></div>
      </section>`;
  };

  const draw = () => {
    const c = counts();
    const list = visible();
    const head = html`
      <header class="h-16 px-5 lg:px-12 lg:pt-6 flex items-center gap-2">
        <h1 class="m-0 flex-1 text-[22px] font-bold">관리</h1>
        <button type="button" data-action="reload" class="h-9 px-3 rounded-[10px] border border-line bg-transparent text-[13px] cursor-pointer hover-mouse:bg-chip">새로고침</button>
      </header>
      <div class="px-5 lg:px-12 pb-3 max-w-[880px]">
        <div role="tablist" aria-label="관리 항목" class="grid grid-cols-2 gap-1 p-1 rounded-xl bg-chip">
          ${[['users', `사용자${c.pending ? ` · 대기 ${c.pending}` : ''}`], ['novels', '소설 정보']].map(([k, l]) => html`
            <button type="button" role="tab" aria-selected="${String(tab === k)}" data-action="tab" data-v="${k}"
              class="h-9 rounded-[10px] border-0 text-sm cursor-pointer ${tab === k ? 'bg-surface text-ink font-bold shadow-sm' : 'bg-transparent text-muted'}">${l}</button>`)}
        </div>
      </div>`;
    if (tab === 'novels') {
      mount(view, html`${head}<div class="px-5 lg:px-12 pb-10 max-w-[880px] flex flex-col gap-4">${nv.render()}</div>`);
      return;
    }
    mount(view, html`${head}
      <div class="px-5 lg:px-12 pb-10 max-w-[880px] flex flex-col gap-4">
        ${usage()}
        <div class="flex flex-col gap-2.5 sticky top-0 z-10 bg-bg pt-1 pb-2">
          <label class="relative block">
            <span class="sr-only">이름·이메일 검색</span>
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted">${icon('search', 18)}</span>
            <input type="search" data-input="q" value="${q}" placeholder="이름·이메일 검색"
              class="w-full h-11 pl-10 pr-3 rounded-xl border border-line bg-surface text-ink outline-none focus:border-muted">
          </label>
          <div class="relative flex gap-1.5 overflow-x-auto [scrollbar-width:none]" data-keep-scroll="status" role="group" aria-label="상태">
            ${FILTERS.map(([k, l]) => html`
              <button type="button" data-action="filter" data-v="${k}" aria-pressed="${String(filter === k)}"
                class="shrink-0 h-9 px-3 rounded-full text-[13px] cursor-pointer ${filter === k ? 'bg-ink text-bg border border-ink font-bold' : 'bg-transparent text-ink border border-line hover-mouse:bg-chip'}">
                ${l} <span class="${filter === k ? 'opacity-70' : 'text-muted'}">${c[k]}</span></button>`)}
          </div>
        </div>
        ${!users ? html`<p class="text-sm text-muted">${error || '불러오는 중…'}</p>` : ''}
        ${users && !list.length ? html`<p class="text-sm text-muted py-4">${q ? '검색 결과가 없어요.' : '해당하는 사용자가 없어요.'}</p>` : ''}
        <ul class="ad-list">${list.map(card)}</ul>
      </div>`);
  };

  const load = async () => {
    try {
      const [u, s] = await Promise.all([rpc('admin_list_users'), rpc('admin_stats')]);
      users = u; stats = s; error = null;
      onPendingChange?.(s.users_pending || 0);
    } catch (err) { error = errorMessage(err); toast(error); }
    if (view.isConnected) draw();
  };

  const find = (id) => users.find((u) => u.user_id === id);

  // 낙관적 반영 → 실패하면 되돌림
  async function change(id, mutate, call, okMsg) {
    const u = find(id);
    const before = JSON.parse(JSON.stringify(u));
    mutate(u);
    busy.add(id); menuFor = null; draw();
    try {
      await call();
      if (okMsg) toast(okMsg);
      const pend = users.filter((x) => x.status === 'pending').length;
      if (stats) stats.users_pending = pend;
      stats && (stats.users_approved = users.filter((x) => x.status === 'approved').length);
      onPendingChange?.(pend);
    } catch (err) {
      Object.assign(u, before);
      toast(errorMessage(err));
    } finally { busy.delete(id); if (view.isConnected) draw(); }
  }
  const setStatus = (id, status, msg) => change(id, (u) => { u.status = status; },
    () => rpc('admin_set_status', { p_user: id, p_status: status }), msg);

  onAction(view, {
    reload() { if (tab === 'novels') nv.load(true); else load(); },
    tab(b) {
      tab = b.dataset.v;
      try { sessionStorage.setItem('ui:adminTab', tab); } catch {}
      if (tab === 'novels' && !nv.loaded) nv.load();
      draw();
    },
    ...nv.handlers,
    filter(b) { filter = b.dataset.v; try { sessionStorage.setItem('ui:adminFilter', filter); } catch {} draw(); },
    menu(b) { menuFor = menuFor === b.dataset.id ? null : b.dataset.id; draw(); },
    approve(b) { setStatus(b.dataset.id, 'approved', `${find(b.dataset.id).display_name || '사용자'} 님을 승인했어요.`); },
    async block(b) {
      const u = find(b.dataset.id);
      menuFor = null; draw();
      const yes = await confirmBox({
        title: `${u.display_name || u.email} 님을 차단할까요?`,
        body: '바로 열람할 수 없게 되고, 다음에 앱을 열면 그 기기에 남은 읽기 기록·캐시도 지워져요. 권한 설정은 남아 있어서 차단을 풀면 그대로 돌아와요.',
        ok: '차단', danger: true,
      });
      if (yes) setStatus(u.user_id, 'blocked', '차단했어요.');
    },
    unblock(b) { setStatus(b.dataset.id, 'approved', '차단을 풀었어요.'); },
    async pend(b) {
      const u = find(b.dataset.id);
      menuFor = null; draw();
      if (await confirmBox({ title: `${u.display_name || u.email} 님을 대기로 되돌릴까요?`, body: '승인 전 상태가 되어 다시 승인할 때까지 볼 수 없어요.', ok: '대기로' })) {
        setStatus(u.user_id, 'pending', '대기로 되돌렸어요.');
      }
    },
    grant(b) {
      const id = b.dataset.id; const sector = b.dataset.sector;
      const on = !(find(id).sectors || []).includes(sector);
      change(id, (u) => { u.sectors = on ? [...(u.sectors || []), sector].sort() : u.sectors.filter((s) => s !== sector); },
        () => rpc('admin_set_grant', { p_user: id, p_sector: sector, p_on: on }));
    },
  });
  let t = null;
  view.addEventListener('input', (e) => {
    if (e.target.dataset.input !== 'q') return;
    clearTimeout(t);
    t = setTimeout(() => {
      q = e.target.value;
      draw();
      const inp = view.querySelector('[data-input="q"]');
      inp.focus(); inp.setSelectionRange(q.length, q.length);
    }, 120);
  });
  // 메뉴 바깥 누르면 닫기
  const outside = (e) => { if (menuFor && !e.target.closest('.ad-more')) { menuFor = null; draw(); } };
  document.addEventListener('click', outside, true);

  view.addEventListener('keydown', (e) => nv.onKeydown(e, view));
  view.addEventListener('input', (e) => nv.onInput(e, view));
  view.addEventListener('submit', (e) => nv.onSubmit(e, view));

  draw();
  load();
  if (tab === 'novels') nv.load();
  return () => document.removeEventListener('click', outside, true);
}
