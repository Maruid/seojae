import { html, mount, onAction, toast } from '../lib/dom.js';
import { signInWithGoogle } from '../lib/auth.js';
import { errorMessage } from '../lib/supabase.js';
import { logo } from '../components/icons.js';

export function renderLogin(root, { authError } = {}) {
  mount(root, html`
    <div class="min-h-dvh flex justify-center bg-bg">
      <div class="w-full max-w-[420px] flex flex-col px-7 pb-10">
        <div class="flex-1 flex flex-col justify-center gap-7">
          <div class="w-16 h-16 rounded-[18px] bg-hero text-hero-ink flex items-center justify-center">${logo(30)}</div>
          <div class="flex flex-col gap-2.5">
            <h1 class="m-0 font-serif text-[40px] font-bold tracking-tight">서재</h1>
            <p class="m-0 text-base leading-relaxed text-muted">구독 칼럼과 소설을 읽던 자리부터<br>이어서 읽는 개인 서재예요.</p>
          </div>
          ${authError ? html`<p class="m-0 text-sm text-accent-ink bg-accent-soft rounded-xl px-4 py-3">로그인을 완료하지 못했어요. 다시 시도해 주세요.</p>` : ''}
        </div>
        <div class="flex flex-col gap-4">
          <button type="button" data-action="google"
            class="h-[54px] rounded-[14px] border border-line bg-surface text-ink text-base font-medium flex items-center justify-center gap-3 cursor-pointer hover-mouse:bg-chip">
            <span class="w-6 h-6 rounded-full border-[1.5px] border-ink flex items-center justify-center text-[13px] font-bold">G</span>
            Google로 계속하기
          </button>
          <p class="m-0 text-[13px] leading-relaxed text-muted text-center">처음 로그인하면 관리자 승인 후 이용할 수 있어요.</p>
        </div>
      </div>
    </div>`);

  onAction(root, {
    async google(btn) {
      btn.disabled = true;
      try { await signInWithGoogle(); }
      catch (err) { btn.disabled = false; toast(errorMessage(err)); }
    },
  });
}
