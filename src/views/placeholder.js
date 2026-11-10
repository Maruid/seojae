import { html, mount } from '../lib/dom.js';

const STAGES = {
  columns: ['칼럼 목록', 2], column: ['칼럼 읽기', 2],
  novels: ['소설 목록', 3], novel: ['회차 목록', 3], chapter: ['소설 읽기', 3],
  admin: ['관리자 화면', 4], install: ['앱 설치', 4],
};

export function renderPlaceholder(view, routeName) {
  const [title, stage] = STAGES[routeName] || ['페이지를 찾을 수 없어요', null];
  mount(view, html`
    <div class="px-5 lg:px-12 py-16 max-w-[640px] flex flex-col gap-3">
      <h1 class="m-0 text-2xl font-bold">${title}</h1>
      <p class="m-0 text-muted">${stage ? `${stage}단계에서 만들 화면이에요.` : '주소를 다시 확인해 주세요.'}</p>
      <a href="#/" class="self-start mt-2 text-sm">홈으로</a>
    </div>`);
}

export function renderForbidden(view) {
  mount(view, html`
    <div class="px-5 lg:px-12 py-16 max-w-[640px] flex flex-col gap-3">
      <h1 class="m-0 text-2xl font-bold">열람 권한이 없어요</h1>
      <p class="m-0 text-muted">관리자에게 권한을 요청해 주세요.</p>
      <a href="#/" class="self-start mt-2 text-sm">홈으로</a>
    </div>`);
}
