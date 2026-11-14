// 앱으로 설치 (#/install)
//   Chrome·Edge(안드로이드/PC): 설치 창 / iPhone·iPad: 공유 → 홈 화면에 추가 안내
import { html, mount, onAction, toast } from '../lib/dom.js';
import { canPrompt, promptInstall, isStandalone, isIOS, onInstallChange, contentCacheInfo, clearContentCache } from '../lib/pwa.js';
import { icon, logo } from '../components/icons.js';
import { isApp, isAndroid, APK_URL, openExternal } from '../lib/native.js';

const step = (n, body) => html`<li class="flex gap-3 items-start"><span class="w-6 h-6 rounded-full bg-chip text-[13px] font-bold flex items-center justify-center shrink-0">${n}</span><span class="pt-0.5">${body}</span></li>`;

export function renderInstall(view) {
  let info = null;
  const draw = () => {
    const standalone = isStandalone();
    const ios = isIOS();
    mount(view, html`
      <header class="h-16 px-2 lg:px-10 lg:pt-6 flex items-center gap-1">
        <a href="#/me" class="w-11 h-11 rounded-full flex items-center justify-center text-ink hover-mouse:bg-chip" aria-label="내 정보로">${icon('back', 24)}</a>
        <h1 class="m-0 text-[20px] font-bold">앱으로 설치</h1>
      </header>
      <div class="px-5 lg:px-12 pb-10 max-w-[640px] flex flex-col gap-5">
        <div class="bg-surface border border-line rounded-2xl p-5 flex items-center gap-4">
          <span class="w-14 h-14 rounded-[14px] bg-hero text-hero-ink flex items-center justify-center shrink-0">${logo(32)}</span>
          <div class="flex flex-col gap-1 text-sm">
            <strong class="text-base">서재</strong>
            <span class="text-muted leading-relaxed">홈 화면에서 바로 열리고, 주소창 없이 화면을 넓게 써요. 열어 본 글은 인터넷이 없어도 다시 볼 수 있어요.</span>
          </div>
        </div>

        ${isApp() ? html`
          <div class="rounded-2xl bg-ok-soft text-ok-ink p-4 text-sm font-bold flex items-center gap-2">${icon('check', 18, 2.4)}안드로이드 앱으로 실행 중이에요.</div>
          <section class="bg-surface border border-line rounded-2xl p-5 flex flex-col gap-3 text-sm">
            <strong class="text-base">앱 업데이트</strong>
            <span class="text-muted leading-relaxed">화면은 열 때마다 자동으로 새 버전을 받아요. 볼륨키처럼 앱 자체 기능이 바뀌었을 때만 새 앱을 받아 설치하면 돼요(받아 둔 글은 그대로).</span>
            <button type="button" data-action="apk" class="h-11 rounded-xl border border-line bg-transparent text-ink cursor-pointer flex items-center justify-center gap-2">${icon('download', 18)}최신 앱 받기</button>
          </section>`
        : standalone ? html`
          <div class="rounded-2xl bg-ok-soft text-ok-ink p-4 text-sm font-bold flex items-center gap-2">${icon('check', 18, 2.4)}지금 앱으로 실행 중이에요.</div>`
        : canPrompt() ? html`
          <button type="button" data-action="install" class="h-12 rounded-xl border-0 bg-ink text-bg font-bold cursor-pointer flex items-center justify-center gap-2">${icon('install', 20)}설치하기</button>`
        : ios ? html`
          <section class="bg-surface border border-line rounded-2xl p-5 flex flex-col gap-3 text-sm">
            <strong class="text-base">iPhone · iPad</strong>
            <ol class="m-0 p-0 list-none flex flex-col gap-3 leading-relaxed">
              ${step(1, 'Safari 로 이 사이트를 열어요 (iOS 16.4 이상은 Chrome 도 가능)')}
              ${step(2, html`아래(또는 위)의 <b>공유</b> 버튼 <span aria-hidden="true">⬆︎</span> 을 눌러요`)}
              ${step(3, html`<b>홈 화면에 추가</b> → <b>추가</b>`)}
            </ol>
            <span class="text-xs text-muted">설치한 앱에서는 처음 한 번 다시 로그인해야 할 수 있어요.</span>
          </section>`
        : html`
          <section class="bg-surface border border-line rounded-2xl p-5 flex flex-col gap-3 text-sm">
            <strong class="text-base">Android · PC (Chrome · Edge)</strong>
            <ol class="m-0 p-0 list-none flex flex-col gap-3 leading-relaxed">
              ${step(1, html`주소창 오른쪽의 <b>설치</b> 아이콘이나 브라우저 메뉴 <b>⋮</b> 를 눌러요`)}
              ${step(2, html`<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 골라요`)}
            </ol>
            <span class="text-xs text-muted">설치 버튼이 안 보이면 이미 설치돼 있거나, 이 브라우저가 설치를 지원하지 않는 경우예요.</span>
          </section>`}

        ${!isApp() && isAndroid() ? html`
          <section class="bg-surface border border-line rounded-2xl p-5 flex flex-col gap-3 text-sm">
            <strong class="text-base">안드로이드 앱 (APK)</strong>
            <span class="text-muted leading-relaxed">볼륨키로 넘기기 · 앱 전용 저장 공간을 쓰는 안드로이드 앱이에요. 받은 파일을 열어 설치해요(처음 한 번 "출처를 알 수 없는 앱 설치"를 허용해야 해요). 웹에서 받아 둔 글은 앱으로 옮겨지지 않아요.</span>
            <a href="${APK_URL}" class="h-11 rounded-xl bg-ink text-bg font-bold no-underline flex items-center justify-center gap-2">${icon('download', 18)}안드로이드 앱 받기</a>
          </section>` : ''}

        <section class="bg-surface border border-line rounded-2xl p-5 flex flex-col gap-3 text-sm">
          <strong class="text-base">이 기기에 저장된 글</strong>
          <span class="text-muted leading-relaxed">열어 본 칼럼·회차와 이미지를 저장해 두고 오프라인에서 보여줘요. 소설은 읽는 회차의 다음 1회차도 미리 받아요. 로그아웃하면 지워져요.</span>
          <div class="flex items-center gap-3">
            <span class="flex-1">${info ? `${info.count.toLocaleString()}개 저장됨${info.usage ? ` · 앱 전체 약 ${Math.max(1, Math.round(info.usage / 1024 / 1024))}MB` : ''}` : '확인 중…'}</span>
            <button type="button" data-action="clear" class="h-9 px-3 rounded-[10px] border border-line bg-transparent text-[13px] cursor-pointer hover-mouse:bg-chip" ${info?.count ? '' : 'disabled'}>비우기</button>
          </div>
        </section>
      </div>`);
  };

  onAction(view, {
    async install() {
      const r = await promptInstall();
      if (r === 'accepted') toast('설치했어요. 홈 화면에서 열 수 있어요.');
      draw();
    },
    apk() { openExternal(APK_URL); },
    async clear() {
      await clearContentCache();
      info = await contentCacheInfo();
      draw();
      toast('저장된 글을 비웠어요.');
    },
  });
  const off = onInstallChange(draw);
  draw();
  contentCacheInfo().then((i) => { info = i; if (view.isConnected) draw(); });
  return off;
}
