// 보기 설정 ("가가" 버튼)
//   모바일: 아래에서 올라오는 시트 / PC: 오른쪽 위 팝오버
//   기본: 글꼴 · 크기 · 줄 간격 · 테마 · 여백(모바일)/본문 폭(PC)
//   고급(접힘): 문단 간격 · 정렬 · 자간 · 들여쓰기 · 직접 색 · 칼럼/소설 따로
//   넘기기: 탭으로 넘기기(터치 기기) · 자동 스크롤 속도
import { html, mount, onAction } from '../lib/dom.js';
import { FONTS, loadFont, resolveWeight } from '../lib/fonts.js';
import { fullscreenSupported, fullscreenOn, setFullscreenOn } from '../lib/fullscreen.js';
import { THEMES, DEFAULTS, getView, setView, getMeta, setSeparate, saveMyTheme, clamp, themeColors } from '../lib/view.js';
import { contrast } from '../lib/color.js';
import { icon } from './icons.js';

const BODY_FONTS = ['system', 'nanumGothic', 'notoSans', 'pretendard', 'gowunDodum', 'notoSerif', 'nanumMyeongjo', 'gowunBatang', 'hahmlet'];
const isCoarse = () => matchMedia('(pointer: coarse)').matches;
const isWide = () => matchMedia('(min-width: 1024px)').matches;

let open = null;

export function closeViewSettings() { open?.close(); }
export const viewSettingsOpen = () => !!open;

export function openViewSettings({ scope, appDark, onChange, advanced = false }) {
  if (open) { open.close(); return null; }
  BODY_FONTS.forEach(loadFont);
  let showAdv = advanced;

  const root = document.createElement('div');
  root.className = 'vs-root';
  document.body.appendChild(root);

  const chip = (on) => `vs-chip ${on ? 'is-on' : ''}`;
  const step = (key, label, val, unit = '') => html`
    <div class="vs-row">
      <span>${label}</span>
      <div class="vs-step">
        <button type="button" data-action="dec" data-k="${key}" aria-label="${label} 줄이기">−</button>
        <output>${val}${unit}</output>
        <button type="button" data-action="inc" data-k="${key}" aria-label="${label} 늘리기">+</button>
      </div>
    </div>`;

  const draw = () => {
    const v = getView(scope);
    const meta = getMeta();
    const c = themeColors(v, appDark());
    const customLow = contrast(v.custom.bg, v.custom.fg) < 4.5;
    const fw = FONTS[v.font]?.weights || [400];
    const wNote = fw.length === 1 ? `${FONTS[v.font].label}는 두께가 한 가지예요` : !fw.includes(300) ? `${FONTS[v.font].label}는 가늘게가 없어요` : '';
    // 고른 두께가 이 글꼴에 없으면 보통으로 보임 (설정값은 그대로 둬서 다른 글꼴로 바꾸면 다시 적용)
    mount(root, html`
      <div class="vs-backdrop" data-action="close"></div>
      <section class="vs-panel" role="dialog" aria-label="보기 설정">
        <header class="vs-head">
          <strong>보기 설정</strong>
          <span class="vs-scope">${meta.separate ? (scope === 'column' ? '칼럼' : '소설') : '칼럼·소설 공통'} · 이 기기</span>
          <button type="button" class="vs-x" data-action="close" aria-label="닫기">${icon('close', 20)}</button>
        </header>
        <div class="vs-body">
          <div class="vs-fonts" role="group" aria-label="글꼴">
            ${BODY_FONTS.map((k) => html`<button type="button" class="${chip(v.font === k)}" data-action="font" data-v="${k}" aria-pressed="${String(v.font === k)}" style="font-family:${FONTS[k].stack}">${FONTS[k].label}</button>`)}
          </div>
          ${step('fontSize', '글자 크기', v.fontSize)}
          <div class="vs-row"><span class="vs-col">글자 두께${wNote ? html`<small>${wNote}</small>` : ''}</span><div class="vs-seg">
            ${[['thin', '가늘게'], ['normal', '보통'], ['bold', '굵게']].map(([k, l]) => {
              const ok = resolveWeight(v.font, k) != null;
              const on = ok && (v.weight || 'normal') === k;
              return html`<button type="button" class="${chip(on)}" data-action="set" data-k="weight" data-v="${k}" aria-pressed="${String(on)}" ${ok ? '' : 'disabled'}>${l}</button>`;
            })}
          </div></div>
          ${step('lh', '줄 간격', v.lh.toFixed(1))}
          ${isWide() ? step('width', '본문 폭', v.width, 'px') : step('margin', '좌우 여백', v.margin, 'px')}
          <div class="vs-themes" role="group" aria-label="테마">
            <button type="button" class="vs-sw ${v.theme == null ? 'is-on' : ''}" data-action="theme" data-v="" title="앱 화면 모드 따름"
              style="background:linear-gradient(135deg,#FFFFFF 50%,#15171A 50%);color:#888">자동</button>
            ${Object.entries(THEMES).map(([k, t]) => html`
              <button type="button" class="vs-sw ${v.theme === k ? 'is-on' : ''}" data-action="theme" data-v="${k}" style="background:${t.bg};color:${t.fg}">${t.label}</button>`)}
            <button type="button" class="vs-sw ${v.theme === 'custom' ? 'is-on' : ''}" data-action="theme" data-v="custom" style="background:${v.custom.bg};color:${v.custom.fg}">내 색</button>
          </div>

          ${fullscreenSupported() ? html`
            <div class="vs-row"><span class="vs-col">읽을 때 전체 화면<small>상태바·하단 바 숨김 · 칼럼·소설 공통 · 목록으로 나가면 풀림</small></span>
              <button type="button" role="switch" aria-checked="${String(fullscreenOn())}" class="vs-switch" data-action="fullscreen" aria-label="읽을 때 전체 화면"><i></i></button></div>` : ''}

          <button type="button" class="vs-fold" data-action="adv" aria-expanded="${String(showAdv)}">고급 설정 <span>${showAdv ? '접기' : '펼치기'}</span></button>
          ${showAdv ? html`
            <div class="vs-adv">
              ${step('paraGap', '문단 간격', v.paraGap.toFixed(1))}
              <div class="vs-row"><span>정렬</span><div class="vs-seg">
                ${[['left', '왼쪽'], ['justify', '양쪽']].map(([k, l]) => html`<button type="button" class="${chip(v.align === k)}" data-action="set" data-k="align" data-v="${k}">${l}</button>`)}
              </div></div>
              <div class="vs-row"><span>자간</span><div class="vs-seg">
                ${[['narrow', '좁게'], ['normal', '보통'], ['wide', '넓게']].map(([k, l]) => html`<button type="button" class="${chip(v.track === k)}" data-action="set" data-k="track" data-v="${k}">${l}</button>`)}
              </div></div>
              <div class="vs-row"><span>첫 줄 들여쓰기</span>
                <button type="button" role="switch" aria-checked="${String(v.indent)}" class="vs-switch" data-action="toggle" data-k="indent"><i></i></button></div>

              <div class="vs-custom">
                <span>내 색</span>
                <label>배경 <input type="color" data-input="bg" value="${v.custom.bg}"></label>
                <label>글자 <input type="color" data-input="fg" value="${v.custom.fg}"></label>
                <button type="button" class="vs-chip" data-action="save-theme">저장</button>
              </div>
              ${customLow ? html`<p class="vs-warn">배경과 글자색 차이가 작아서 읽기 어려울 수 있어요.</p>` : ''}
              ${meta.myThemes.length ? html`<div class="vs-themes">
                ${meta.myThemes.map((t, i) => html`<button type="button" class="vs-sw" data-action="my-theme" data-i="${i}" style="background:${t.bg};color:${t.fg}">저장 ${i + 1}</button>`)}
              </div>` : ''}

              <div class="vs-row"><span class="vs-col">칼럼·소설 따로 설정<small>끄면 두 곳이 같은 설정을 써요</small></span>
                <button type="button" role="switch" aria-checked="${String(meta.separate)}" class="vs-switch" data-action="separate"><i></i></button></div>
              <button type="button" class="vs-reset" data-action="reset">이 설정 기본값으로</button>
            </div>` : ''}

          <div class="vs-sec">넘기기</div>
          ${isCoarse() ? html`
            <div class="vs-row"><span class="vs-col">화면 위·아래 눌러 넘기기<small>가운데를 누르면 메뉴를 숨겨요</small></span>
              <button type="button" role="switch" aria-checked="${String(v.tapPaging)}" class="vs-switch" data-action="toggle" data-k="tapPaging"><i></i></button></div>` : html`
            <p class="vs-note">키보드: Space·PageDown·→ 다음 화면, Shift+Space·PageUp·← 이전 화면</p>`}
          ${step('speed', '자동 스크롤 속도', v.speed)}
        </div>
      </section>`);
    root.style.setProperty('--vs-bg', c.sheet);
    root.style.setProperty('--vs-fg', c.fg);
    root.style.setProperty('--vs-muted', c.muted);
    root.style.setProperty('--vs-line', c.line);
    root.style.setProperty('--vs-chip', c.chip);
    root.dataset.dark = c.dark ? '1' : '';
  };

  const STEP = { fontSize: 1, lh: 0.1, margin: 4, width: 40, paraGap: 0.25, speed: 1 };
  const apply = (patch) => {
    const v = setView(scope, patch);
    if (patch.font) loadFont(patch.font);
    draw();
    onChange?.(v);
  };

  const off = onAction(root, {
    close() { close(); },
    font(b) { apply({ font: b.dataset.v }); },
    inc(b) { const k = b.dataset.k; apply({ [k]: clamp(k, +(getView(scope)[k] + STEP[k]).toFixed(2)) }); },
    dec(b) { const k = b.dataset.k; apply({ [k]: clamp(k, +(getView(scope)[k] - STEP[k]).toFixed(2)) }); },
    theme(b) { apply({ theme: b.dataset.v || null }); },
    set(b) { apply({ [b.dataset.k]: b.dataset.v }); },
    toggle(b) { const k = b.dataset.k; apply({ [k]: !getView(scope)[k] }); },
    adv() { showAdv = !showAdv; draw(); },
    fullscreen() { setFullscreenOn(!fullscreenOn()); draw(); },
    'save-theme'() { saveMyTheme(getView(scope).custom); apply({ theme: 'custom' }); },
    'my-theme'(b) { const t = getMeta().myThemes[+b.dataset.i]; if (t) apply({ custom: { ...t }, theme: 'custom' }); },
    separate() { setSeparate(!getMeta().separate, scope); apply({}); },
    reset() { const { tapPaging, speed } = getView(scope); setView(scope, { ...DEFAULTS[scope], tapPaging, speed }); apply({}); },
  });
  const onInput = (e) => {
    const k = e.target.dataset?.input;
    if (!k) return;
    const v = getView(scope);
    const next = setView(scope, { custom: { ...v.custom, [k]: e.target.value }, theme: 'custom' });
    onChange?.(next);
  };
  const onCommit = (e) => { if (e.target.dataset?.input) draw(); };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onCommit);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  function close() {
    off();
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    open = null;
  }
  draw();
  root.querySelector('.vs-panel')?.focus?.();
  open = { close };
  return open;
}
