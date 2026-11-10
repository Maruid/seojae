import { html, mount, onAction, toast } from '../lib/dom.js';
import { signOut } from '../lib/auth.js';
import { icon } from '../components/icons.js';
import { initial } from '../components/layout.js';

// 승인 대기 / 차단 화면 (메뉴 없음)
export function renderPending(root, app, { onRefresh }) {
  const blocked = app.me?.status === 'blocked';
  const p = app.me?.profile || {};

  mount(root, html`
    <div class="min-h-dvh flex justify-center bg-bg">
      <div class="w-full max-w-[420px] flex flex-col px-6 pb-9">
        <div class="h-16 flex items-center justify-between">
          <span class="font-serif text-xl font-bold">서재</span>
          <button type="button" data-action="logout" class="h-11 px-3.5 bg-transparent border-0 text-muted text-sm cursor-pointer">로그아웃</button>
        </div>
        <div class="flex-1 flex flex-col justify-center gap-7">
          <div class="flex flex-col gap-3">
            <h1 class="m-0 text-[28px] font-bold leading-snug">${blocked ? '이용이 제한된 계정이에요' : '승인을 기다리고 있어요'}</h1>
            <p class="m-0 text-[15px] leading-7 text-muted">${blocked
              ? '관리자에게 문의해 주세요. 이 기기에 저장된 읽기 기록은 정리했어요.'
              : '관리자가 확인하면 읽을 수 있는 서재가 열려요. 승인되면 아래 버튼을 눌러 주세요.'}</p>
          </div>
          <div class="bg-surface border border-line rounded-2xl p-[18px] flex items-center gap-3.5">
            <div class="w-11 h-11 rounded-full bg-chip flex items-center justify-center font-bold text-muted">${initial(app.me)}</div>
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-[15px] font-medium truncate">${p.display_name || ''}</span>
              <span class="text-[13px] text-muted truncate">${p.email || ''}</span>
            </div>
          </div>
          ${blocked ? '' : html`
          <ol class="m-0 p-0 list-none flex flex-col">
            <li class="flex gap-3.5 items-start">
              <div class="flex flex-col items-center">
                <span class="w-6 h-6 rounded-full bg-ok text-white flex items-center justify-center">${icon('check', 14, 3)}</span>
                <span class="w-0.5 h-7 bg-line"></span>
              </div>
              <span class="text-[15px] pt-px">Google 로그인 완료</span>
            </li>
            <li class="flex gap-3.5 items-start">
              <div class="flex flex-col items-center">
                <span class="w-6 h-6 rounded-full border-2 border-accent flex items-center justify-center"><span class="w-2 h-2 rounded-full bg-accent"></span></span>
                <span class="w-0.5 h-7 bg-line"></span>
              </div>
              <span class="text-[15px] font-bold pt-px">관리자 승인 대기 중</span>
            </li>
            <li class="flex gap-3.5 items-start">
              <span class="w-6 h-6 rounded-full border-2 border-line"></span>
              <span class="text-[15px] text-muted pt-px">칼럼 · 소설 열람 권한 받기</span>
            </li>
          </ol>`}
        </div>
        ${blocked ? '' : html`<button type="button" data-action="refresh" class="h-[54px] rounded-[14px] border-0 bg-hero text-hero-ink text-base font-medium cursor-pointer">승인됐는지 확인</button>`}
      </div>
    </div>`);

  onAction(root, {
    async refresh(btn) {
      btn.disabled = true;
      const status = await onRefresh();
      btn.disabled = false;
      if (status === 'pending') toast('아직 승인 전이에요.');
    },
    async logout() { await signOut(); location.hash = '#/login'; location.reload(); },
  });
}
