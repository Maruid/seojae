import { html, mount, onAction, toast } from '../lib/dom.js';
import { signOut, updateMyName } from '../lib/auth.js';
import { errorMessage } from '../lib/supabase.js';
import { getPrefs, setPrefs } from '../lib/prefs.js';
import { FONTS, APP_FONTS, loadFont } from '../lib/fonts.js';
import { initial } from '../components/layout.js';

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
        <h1 class="m-0 font-serif text-[22px] font-bold">내 정보</h1>
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

        <section class="flex flex-col gap-3.5">
          <h2 class="m-0 text-sm font-bold text-muted">화면 설정 · 이 기기</h2>
          <div class="bg-surface border border-line rounded-2xl p-4 flex flex-col gap-4">
            <div class="flex flex-col gap-2.5">
              <span class="font-bold">앱 글꼴</span>
              <div role="group" aria-label="앱 글꼴" class="flex flex-wrap gap-1.5">
                ${APP_FONTS.map((k) => html`
                  <button type="button" data-action="font" data-v="${k}" aria-pressed="${!p.sameAsBody && p.appFont === k}"
                    class="${chip(!p.sameAsBody && p.appFont === k)} ${p.sameAsBody ? 'opacity-45' : ''}" style="font-family: ${FONTS[k].stack}">${FONTS[k].label}</button>`)}
              </div>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="flex flex-col gap-0.5">본문 글꼴과 같게<span class="text-xs text-muted">켜면 목록·메뉴도 읽기 화면에서 고른 글꼴로 (2단계에서 적용)</span></span>
              <button type="button" role="switch" aria-checked="${p.sameAsBody}" aria-label="본문 글꼴과 같게" data-action="same"
                class="relative w-12 h-7 shrink-0 rounded-full border-0 p-0 cursor-pointer ${p.sameAsBody ? 'bg-accent' : 'bg-line'}">
                <span class="absolute top-[3px] ${p.sameAsBody ? 'left-[23px]' : 'left-[3px]'} w-[22px] h-[22px] rounded-full bg-white shadow"></span>
              </button>
            </div>
            <div class="flex items-center justify-between">
              <span class="font-bold">앱 글자 크기</span>
              <div role="group" aria-label="앱 글자 크기" class="flex gap-1.5">
                ${[['small', '작게'], ['normal', '보통'], ['large', '크게']].map(([k, l]) => html`
                  <button type="button" data-action="size" data-v="${k}" aria-pressed="${p.appSize === k}" class="${chip(p.appSize === k)}">${l}</button>`)}
              </div>
            </div>
            <div class="flex flex-col gap-2.5">
              <span class="font-bold">화면 모드</span>
              <div role="group" aria-label="화면 모드" class="grid grid-cols-3 gap-1.5">
                ${[['light', '밝게'], ['dark', '어둡게'], ['auto', '기기 설정 따름']].map(([k, l]) => html`
                  <button type="button" data-action="mode" data-v="${k}" aria-pressed="${p.mode === k}" class="${chip(p.mode === k)} !px-1.5 !text-[13px]">${l}</button>`)}
              </div>
            </div>
            <span class="text-xs leading-relaxed text-muted">읽기 화면의 글꼴·크기·색은 각 읽기 화면의 "가가" 버튼에서 따로 정해요.</span>
          </div>
        </section>

        <section class="bg-surface border border-line rounded-2xl flex flex-col">
          <a href="#/install" class="min-h-[52px] px-4 flex items-center justify-between text-ink no-underline border-b border-line">앱으로 설치<span class="text-muted">›</span></a>
          <button type="button" data-action="logout" class="min-h-[52px] px-4 border-0 bg-transparent text-accent-ink text-left cursor-pointer">로그아웃</button>
        </section>
      </div>`);
  };

  draw();

  onAction(view, {
    'edit-name'() { editing = true; draw(); view.querySelector('#name-input')?.focus(); },
    font(b) { setPrefs({ appFont: b.dataset.v, sameAsBody: false }); draw(); },
    same() { setPrefs({ sameAsBody: !getPrefs().sameAsBody }); draw(); },
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
}
