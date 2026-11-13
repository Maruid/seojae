import { html, mount, onAction, toast } from '../lib/dom.js';
import { signOut, updateMyName } from '../lib/auth.js';
import { errorMessage } from '../lib/supabase.js';
import { getPrefs, setPrefs } from '../lib/prefs.js';
import { FONTS, APP_FONTS, loadFont } from '../lib/fonts.js';
import { initial } from '../components/layout.js';
import { canAccess } from '../lib/nav.js';
import { icon } from '../components/icons.js';
import { cachedQuota, loadQuota, quotaMissing, resetText, onQuota } from '../lib/offline/quota.js';
import { fmtBytes, usedRatio } from '../lib/offline/plan.js';
import { refreshIndex, savedNovelsNow, savedColumnsNow, onSaved } from '../lib/offline/index.js';

const MODE_TEXT = { auto: '자동 (나눌 양을 승인된 인원이 똑같이 나눔)', stopped: '자동 · 이번 달 몫을 다 씀', direct: '관리자가 정한 한도', admin: '관리자 · 한도 없음' };

// 이번 달 다운로드 + 다운로드 관리 바로 가기
function quotaCard() {
  const q = cachedQuota();
  const nv = savedNovelsNow(); const cl = savedColumnsNow();
  let total = 0; for (const x of nv.values()) total += x.bytes; for (const c of cl.values()) total += c.bytes || 0;
  const r = usedRatio(q);
  const left = q && !q.unlimited ? Math.max(0, (q.limit || 0) - (q.used || 0)) : 0;
  return html`
    <section class="bg-surface border border-line rounded-2xl p-4 flex flex-col gap-2.5" aria-labelledby="dlq">
      <div class="flex items-center gap-2"><h2 id="dlq" class="m-0 text-[15px] font-bold flex-1">이번 달 다운로드</h2>
        ${q && !q.unlimited ? html`<span class="text-xs text-muted">${resetText(q)}에 다시 채워짐</span>` : ''}</div>
      ${quotaMissing() ? html`<p class="m-0 text-sm text-muted">관리자가 서버 설정(migration_009)을 마치면 쓸 수 있어요.</p>`
        : !q ? html`<p class="m-0 text-sm text-muted">불러오는 중…</p>`
        : q.unlimited ? html`<p class="m-0 text-sm">관리자 · 한도 없음 <span class="text-muted">· 이번 달 ${fmtBytes(q.used)} 받음</span></p>`
        : html`
          <div class="flex items-baseline gap-1.5"><b class="text-[26px]">${fmtBytes(left)}</b><span class="text-[13px] text-muted">남음 · ${fmtBytes(q.limit)} 중 ${fmtBytes(q.used)} 씀</span></div>
          <div class="dl-bar is-lg" role="progressbar" aria-label="이번 달 사용량" aria-valuenow="${Math.round(r * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100, r * 100)}%" class="${r >= 0.8 ? 'is-over' : ''}"></i></div>
          ${r >= 0.8 ? html`<p class="dl-warn">이번 달 한도의 ${Math.round(r * 100)}%를 썼어요. 남은 ${fmtBytes(left)} 안에서 받을 수 있어요.</p>` : ''}
          <small class="text-xs text-muted leading-relaxed">한도: ${MODE_TEXT[q.mode] || '자동'}. 다운로드로 서버에서 받은 양만 세요.</small>`}
      <a href="#/downloads" class="min-h-[44px] flex items-center gap-2 border-t border-line-soft pt-2 text-ink no-underline">
        ${icon('download', 18)}<span class="flex-1">다운로드 관리</span>
        <span class="text-[13px] text-muted">${canAccessAny() ? `소설 ${nv.size} · 칼럼 ${cl.size} · ${fmtBytes(total)}` : ''}</span><span class="text-muted">›</span></a>
      <small class="text-xs text-muted -mt-1">이 브라우저에 저장됨 · 다른 브라우저(앱)에서는 따로 받아요</small>
    </section>`;
}
const canAccessAny = () => true;

const chip = (on) => `h-[38px] px-3 rounded-[10px] text-sm cursor-pointer ${on
  ? 'border border-ink bg-ink text-bg font-bold'
  : 'border border-line bg-transparent text-ink hover-mouse:bg-chip'}`;

export function renderMe(view, app, { onNameChanged }) {
  let editing = false;
  APP_FONTS.forEach(loadFont);   // 버튼에 각 글꼴 모양을 보여주기 위해

  const draw = () => {
    const p = getPrefs();
    const prof = app.me.profile || {};
    mount(view, html`
      <header class="h-16 px-5 lg:px-12 lg:pt-6 flex items-center">
        <h1 class="m-0 text-[22px] font-bold">내 정보</h1>
      </header>
      <div class="px-5 lg:px-12 pb-10 max-w-[640px] flex flex-col gap-6">
        <div class="bg-surface border border-line rounded-2xl p-4 flex items-center gap-3.5">
          <div class="w-12 h-12 rounded-full bg-chip text-muted font-bold flex items-center justify-center shrink-0">${initial(app.me)}</div>
          ${editing ? html`
            <form data-name-form class="flex-1 flex gap-2 min-w-0">
              <label class="sr-only" for="name-input">표시 이름</label>
              <input id="name-input" name="name" maxlength="40" required value="${prof.display_name || ''}"
                class="flex-1 min-w-0 h-10 px-3 rounded-[10px] border border-line bg-bg text-ink">
              <button type="submit" class="h-10 px-3 rounded-[10px] border-0 bg-ink text-bg text-sm cursor-pointer">저장</button>
            </form>` : html`
            <div class="flex-1 min-w-0 flex flex-col gap-0.5">
              <span class="text-base font-bold truncate">${prof.display_name || ''}</span>
              <span class="text-[13px] text-muted truncate">${prof.email || ''}</span>
            </div>
            <button type="button" data-action="edit-name" class="h-9 px-3 rounded-[10px] border border-line bg-transparent text-[13px] cursor-pointer shrink-0">이름 변경</button>`}
        </div>

        ${canAccess(app.me, 'novel') || canAccess(app.me, 'column') ? quotaCard() : ''}

        <section class="flex flex-col gap-3.5">
          <h2 class="m-0 text-sm font-bold text-muted">화면 설정 · 이 기기</h2>
          <div class="bg-surface border border-line rounded-2xl p-4 flex flex-col gap-4">
            <div class="flex flex-col gap-2.5">
              <span class="font-bold">앱 글꼴</span>
              <div role="group" aria-label="앱 글꼴" class="flex flex-wrap gap-1.5">
                ${APP_FONTS.map((k) => html`
                  <button type="button" data-action="font" data-v="${k}" aria-pressed="${String(!p.sameAsBody && p.appFont === k)}"
                    class="${chip(!p.sameAsBody && p.appFont === k)} ${p.sameAsBody ? 'opacity-45' : ''}" style="font-family: ${FONTS[k].stack}">${FONTS[k].label}</button>`)}
              </div>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="flex flex-col gap-0.5">본문 글꼴과 같게<span class="text-xs text-muted">켜면 목록·메뉴도 읽기 화면 보기 설정의 글꼴로</span></span>
              <button type="button" role="switch" aria-checked="${String(p.sameAsBody)}" aria-label="본문 글꼴과 같게" data-action="same"
                class="relative w-12 h-7 shrink-0 rounded-full border-0 p-0 cursor-pointer ${p.sameAsBody ? 'bg-accent' : 'bg-line'}">
                <span class="absolute top-[3px] ${p.sameAsBody ? 'left-[23px]' : 'left-[3px]'} w-[22px] h-[22px] rounded-full bg-white shadow"></span>
              </button>
            </div>
            <div class="flex items-center justify-between">
              <span class="font-bold">앱 글자 크기</span>
              <div role="group" aria-label="앱 글자 크기" class="flex gap-1.5">
                ${[['small', '작게'], ['normal', '보통'], ['large', '크게']].map(([k, l]) => html`
                  <button type="button" data-action="size" data-v="${k}" aria-pressed="${String(p.appSize === k)}" class="${chip(p.appSize === k)}">${l}</button>`)}
              </div>
            </div>
            <div class="flex flex-col gap-2.5">
              <span class="font-bold">화면 모드</span>
              <div role="group" aria-label="화면 모드" class="grid grid-cols-3 gap-1.5">
                ${[['light', '밝게'], ['dark', '어둡게'], ['auto', '기기 설정 따름']].map(([k, l]) => html`
                  <button type="button" data-action="mode" data-v="${k}" aria-pressed="${String(p.mode === k)}" class="${chip(p.mode === k)} !px-1.5 !text-[13px]">${l}</button>`)}
              </div>
            </div>
            <span class="text-xs leading-relaxed text-muted">읽기 화면의 글꼴·크기·색은 각 읽기 화면의 "가가" 버튼에서 따로 정해요.</span>
          </div>
        </section>

        <section class="bg-surface border border-line rounded-2xl flex flex-col">
          <a href="#/install" class="min-h-[52px] px-4 flex items-center justify-between text-ink no-underline border-b border-line">앱으로 설치<span class="text-muted">›</span></a>
          <button type="button" data-action="logout" class="min-h-[52px] px-4 border-0 bg-transparent text-accent-ink text-left cursor-pointer">로그아웃 <span class="text-xs text-muted">· 받아 둔 글도 지워져요</span></button>
        </section>
      </div>`);
  };

  draw();
  const offs = [onQuota(() => { if (view.isConnected) draw(); }), onSaved(() => { if (view.isConnected) draw(); })];
  if (navigator.onLine) loadQuota().catch(() => {});
  refreshIndex().catch(() => {});

  onAction(view, {
    'edit-name'() { editing = true; draw(); view.querySelector('#name-input')?.focus(); },
    font(b) { setPrefs({ appFont: b.dataset.v, sameAsBody: false }); draw(); },
    same() { setPrefs({ sameAsBody: !getPrefs().sameAsBody, sameScope: canAccess(app.me, 'column') ? 'column' : 'novel' }); draw(); },
    size(b) { setPrefs({ appSize: b.dataset.v }); draw(); },
    mode(b) { setPrefs({ mode: b.dataset.v }); draw(); },
    async logout() { await signOut(); location.hash = '#/login'; location.reload(); },
  });

  view.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-name-form]')) return;
    e.preventDefault();
    const name = new FormData(e.target).get('name').toString().trim();
    try {
      await updateMyName(name);
      app.me.profile.display_name = name;
      editing = false;
      draw();
      onNameChanged?.();
      toast('이름을 바꿨어요.');
    } catch (err) { toast(errorMessage(err)); }
  });
  return () => offs.forEach((f) => f());
}
