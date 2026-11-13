// 30일 넘게 온라인 확인을 못 해서 받아 둔 글이 잠긴 화면
import { html, mount, onAction } from '../lib/dom.js';
import { lastOnlineAt } from '../lib/offline/index.js';
import { fmtDate } from '../lib/columns.js';

export function renderLocked(view, app, { retry }) {
  let last = null;
  const draw = () => mount(view, html`
    <div class="min-h-[70dvh] flex items-center justify-center px-6">
      <section class="dl-lock" role="alert">
        <span class="dl-lock-ic" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>
        </span>
        <h1>받아 둔 글이 잠겼어요</h1>
        <p>마지막으로 확인한 지 30일이 지났어요.<br>인터넷에 한 번 연결하면 권한을 확인하고 바로 다시 열려요.<br>받아 둔 글은 지우지 않았어요.</p>
        <button type="button" data-action="retry" class="dl-main">다시 확인</button>
        ${last ? html`<small>마지막 확인 ${fmtDate(new Date(last).toISOString())}</small>` : ''}
      </section>
    </div>`);
  onAction(view, { retry() { retry?.(); } });
  draw();
  lastOnlineAt().then((t) => { last = t; if (view.isConnected) draw(); });
}
