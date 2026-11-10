// 보기 설정 (⚙ 버튼) — 화면 가운데보다 조금 위에 뜨는 작은 창
//   - 뒤 배경은 어둡게 하지 않음 (바꾼 설정이 본문에 바로 보이게). 바깥을 누르면 닫힘
//   - 탭 두 개 (마지막에 연 탭 기억)
//       일반: 글꼴(미리보기 목록) · 테마(+ 내 색 바로 편집) · 글자 크기 · 두께 · 줄 간격 · 좌우 여백(PC 본문 폭) · 문단 간격
//       고급: 전체 화면 · 화면 켜두기 · 정렬 · 자간 · 첫 줄 들여쓰기 · 칼럼/소설 따로 · 화면 눌러 넘기기 · 기본값으로
//   - 다시 그려도 스크롤 위치와 누른 버튼의 포커스를 그대로 유지
//   - 자동 스크롤 속도는 자동 재생 창으로 옮김
import { html, mount, onAction } from '../lib/dom.js';
import { FONTS, loadFont, resolveWeight } from '../lib/fonts.js';
import { fullscreenSupported, fullscreenOn, setFullscreenOn } from '../lib/fullscreen.js';
import { wakeSupported, keepAwakeOn, setKeepAwake } from '../lib/wakeLock.js';
import { THEMES, DEFAULTS, getView, setView, getMeta, setSeparate, saveMyTheme, clamp, themeColors } from '../lib/view.js';
import { contrast } from '../lib/color.js';
import { icon } from './icons.js';

const BODY_FONTS = ['system', 'nanumGothic', 'notoSans', 'pretendard', 'gowunDodum', 'notoSerif', 'nanumMyeongjo', 'gowunBatang', 'hahmlet'];
const SAMPLE = '가나다 Aa 123';
const isCoarse = () => matchMedia('(pointer: coarse)').matches;
const isWide = () => matchMedia('(min-width: 1024px)').matches;
const TAB_KEY = 'ui:vsTab';

// 글꼴 미리보기: 예문 글자만 담은 작은 글꼴 조각을 다른 이름('pv-글꼴')으로 받음
//   → 목록을 열어도 9개 글꼴 전체를 받지 않음. 실제 본문 글꼴은 골랐을 때만 받음
const previewed = new Set();
function loadPreview(key) {
  const f = FONTS[key];
  if (!f?.css || previewed.has(key)) return;
  previewed.add(key);
  if (!f.css.includes('fonts.googleapis.com')) { loadFont(key); return; }   // 프리텐다드는 원래 글자별로 나눠 받음
  const url = `${f.css.replace(/:wght@[^&]*/, '')}&text=${encodeURIComponent(SAMPLE + f.label)}`;
  fetch(url).then((r) => (r.ok ? r.text() : '')).then((css) => {
    if (!css) return;
    const st = document.createElement('style');
    st.textContent = css.replace(/font-family:\s*'[^']+'/g, `font-family: 'pv-${key}'`);
    document.head.appendChild(st);
  }).catch(() => {});
}
const previewStack = (key) => (FONTS[key].css?.includes('fonts.googleapis.com') ? `'pv-${key}', ${FONTS[key].stack}` : FONTS[key].stack);

let open = null;

export function closeViewSettings() { open?.close(); }
export const viewSettingsOpen = () => !!open;

export function openViewSettings({ scope, appDark, onChange }) {
  if (open) { open.close(); return null; }
  let tab = 'basic';
  try { tab = localStorage.getItem(TAB_KEY) || 'basic'; } catch {}
  let fontsOpen = false;
  let customOpen = getView(scope).theme === 'custom';

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
  const sw = (on, label, action, extra = '', small = '') => html`
    <div class="vs-row"><span class="vs-col">${label}${small ? html`<small>${small}</small>` : ''}</span>
      <button type="button" role="switch" aria-checked="${String(on)}" class="vs-switch" data-action="${action}" ${extra} aria-label="${label}"><i></i></button></div>`;

  const basic = (v, meta) => {
    const fw = FONTS[v.font]?.weights || [400];
    const wNote = fw.length === 1 ? '이 글꼴은 두께가 한 가지예요' : !fw.includes(300) ? '이 글꼴은 가늘게가 없어요' : '';
    const customLow = contrast(v.custom.bg, v.custom.fg) < 4.5;
    return html`
      <div class="vs-row vs-font-row">
        <span>글꼴</span>
        <button type="button" class="vs-font-btn" data-action="fonts" aria-expanded="${String(fontsOpen)}" style="font-family:${FONTS[v.font].stack}">
          <span>${FONTS[v.font].label}</span>${icon(fontsOpen ? 'up' : 'down', 16)}</button>
      </div>
      ${fontsOpen ? html`
        <div class="vs-fontlist" role="listbox" aria-label="글꼴">
          ${BODY_FONTS.map((k) => html`
            <button type="button" role="option" aria-selected="${String(v.font === k)}" class="vs-font-opt ${v.font === k ? 'is-on' : ''}" data-action="font" data-v="${k}">
              <span class="vs-fo-name">${v.font === k ? icon('check', 14, 2.4) : ''}${FONTS[k].label}</span>
              <span class="vs-fo-sample" style="font-family:${previewStack(k)}">${SAMPLE}</span>
            </button>`)}
        </div>` : ''}

      <div class="vs-themes" role="group" aria-label="테마">
        <button type="button" class="vs-sw ${v.theme == null ? 'is-on' : ''}" data-action="theme" data-v="" title="앱 화면 모드 따름"
          style="background:linear-gradient(135deg,#FFFFFF 50%,#15171A 50%);color:#888">자동</button>
        ${Object.entries(THEMES).map(([k, t]) => html`
          <button type="button" class="vs-sw ${v.theme === k ? 'is-on' : ''}" data-action="theme" data-v="${k}" style="background:${t.bg};color:${t.fg}">${t.label}</button>`)}
        <button type="button" class="vs-sw ${v.theme === 'custom' ? 'is-on' : ''}" data-action="custom" aria-expanded="${String(customOpen)}" style="background:${v.custom.bg};color:${v.custom.fg}">내 색</button>
      </div>
      ${customOpen ? html`
        <div class="vs-custom">
          <label>배경 <input type="color" data-input="bg" value="${v.custom.bg}"></label>
          <label>글자 <input type="color" data-input="fg" value="${v.custom.fg}"></label>
          <button type="button" class="vs-chip" data-action="save-theme">저장</button>
          ${meta.myThemes.map((t, i) => html`<button type="button" class="vs-mini" data-action="my-theme" data-i="${i}" style="background:${t.bg};color:${t.fg}" aria-label="저장한 색 ${i + 1}">${i + 1}</button>`)}
        </div>
        ${customLow ? html`<p class="vs-warn">배경과 글자색 차이가 작아서 읽기 어려울 수 있어요.</p>` : ''}` : ''}

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
      ${step('paraGap', '문단 간격', v.paraGap.toFixed(1))}`;
  };

  const advanced = (v, meta) => html`
    ${fullscreenSupported() ? sw(fullscreenOn(), '읽을 때 전체 화면', 'fullscreen', '', '상태바·하단 바 숨김 · 칼럼·소설 공통') : ''}
    ${wakeSupported() ? sw(keepAwakeOn(), '읽는 동안 화면 켜두기', 'awake', '', '자동 재생 중에는 항상 켜져요 · 칼럼·소설 공통') : ''}
    <div class="vs-row"><span>정렬</span><div class="vs-seg">
      ${[['left', '왼쪽'], ['justify', '양쪽']].map(([k, l]) => html`<button type="button" class="${chip(v.align === k)}" data-action="set" data-k="align" data-v="${k}" aria-pressed="${String(v.align === k)}">${l}</button>`)}
    </div></div>
    <div class="vs-row"><span>자간</span><div class="vs-seg">
      ${[['narrow', '좁게'], ['normal', '보통'], ['wide', '넓게']].map(([k, l]) => html`<button type="button" class="${chip(v.track === k)}" data-action="set" data-k="track" data-v="${k}" aria-pressed="${String(v.track === k)}">${l}</button>`)}
    </div></div>
    ${sw(v.indent, '첫 줄 들여쓰기', 'toggle', 'data-k="indent"')}
    ${sw(meta.separate, '칼럼·소설 따로 설정', 'separate', '', '끄면 두 곳이 같은 설정을 써요')}
    ${isCoarse()
      ? sw(v.tapPaging, '화면 위·아래 눌러 넘기기', 'toggle', 'data-k="tapPaging"', '가운데를 누르면 메뉴가 나와요')
      : html`<p class="vs-note">키보드: Space·PageDown·→ 다음 화면, Shift+Space·PageUp·← 이전 화면, J·K 다음·이전 글, / 찾기</p>`}
    <button type="button" class="vs-reset" data-action="reset">이 설정 기본값으로</button>`;

  const draw = () => {
    const v = getView(scope);
    const meta = getMeta();
    const c = themeColors(v, appDark());
    // 다시 그려도 스크롤 위치·포커스 유지
    const oldBody = root.querySelector('.vs-body');
    const keepScroll = oldBody ? oldBody.scrollTop : 0;
    const a = document.activeElement;
    const focusKey = a && root.contains(a) ? [a.dataset.action, a.dataset.k, a.dataset.v, a.dataset.i].join('|') : null;

    // 창 틀은 처음 한 번만 만들고, 바꿀 때는 안쪽만 다시 그림 (떠오르는 애니메이션이 다시 돌며 깜빡이지 않게)
    if (!root.querySelector('.vs-panel')) {
      mount(root, html`
        <div class="vs-backdrop" data-action="close"></div>
        <section class="vs-panel" role="dialog" aria-label="보기 설정" tabindex="-1">
          <header class="vs-head"></header>
          <p class="vs-scope"></p>
          <div class="vs-body"></div>
        </section>`);
    }
    mount(root.querySelector('.vs-head'), html`
      <div class="vs-tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${String(tab === 'basic')}" data-action="tab" data-v="basic">일반 설정</button>
        <button type="button" role="tab" aria-selected="${String(tab === 'adv')}" data-action="tab" data-v="adv">고급 설정</button>
      </div>
      <button type="button" class="vs-x" data-action="close" aria-label="닫기">${icon('close', 18)}</button>`);
    root.querySelector('.vs-scope').textContent = `${meta.separate ? (scope === 'column' ? '칼럼' : '소설') : '칼럼·소설 공통'} · 이 기기`;
    mount(root.querySelector('.vs-body'), tab === 'adv' ? advanced(v, meta) : basic(v, meta));
    root.style.setProperty('--vs-bg', c.sheet);
    root.style.setProperty('--vs-fg', c.fg);
    root.style.setProperty('--vs-muted', c.muted);
    root.style.setProperty('--vs-line', c.line);
    root.style.setProperty('--vs-chip', c.chip);
    root.dataset.dark = c.dark ? '1' : '';

    const body = root.querySelector('.vs-body');
    if (body) body.scrollTop = keepScroll;
    if (focusKey) {
      const el = [...root.querySelectorAll('[data-action]')].find((b) => [b.dataset.action, b.dataset.k, b.dataset.v, b.dataset.i].join('|') === focusKey);
      el?.focus({ preventScroll: true });
    }
  };

  // 펼친 부분이 창 안에 보이게
  const reveal = (sel) => requestAnimationFrame(() => {
    const body = root.querySelector('.vs-body');
    const el = root.querySelector(sel);
    if (!body || !el) return;
    const b = body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.bottom > b.bottom) body.scrollTop += Math.min(r.bottom - b.bottom + 8, r.top - b.top);
  });

  const STEP = { fontSize: 1, lh: 0.1, margin: 4, width: 40, paraGap: 0.25 };
  const apply = (patch) => {
    const v = setView(scope, patch);
    if (patch.font) loadFont(patch.font);
    draw();
    onChange?.(v);
  };

  const off = onAction(root, {
    close() { close(); },
    tab(b) {
      tab = b.dataset.v; fontsOpen = false;
      try { localStorage.setItem(TAB_KEY, tab); } catch {}
      draw();
      const body = root.querySelector('.vs-body');
      if (body) body.scrollTop = 0;
    },
    fonts() {
      fontsOpen = !fontsOpen;
      if (fontsOpen) BODY_FONTS.forEach(loadPreview);
      draw();
      if (fontsOpen) reveal('.vs-fontlist');
    },
    font(b) { fontsOpen = false; apply({ font: b.dataset.v }); },
    inc(b) { const k = b.dataset.k; apply({ [k]: clamp(k, +(getView(scope)[k] + STEP[k]).toFixed(2)) }); },
    dec(b) { const k = b.dataset.k; apply({ [k]: clamp(k, +(getView(scope)[k] - STEP[k]).toFixed(2)) }); },
    theme(b) { customOpen = false; apply({ theme: b.dataset.v || null }); },
    custom() {
      const on = getView(scope).theme === 'custom';
      customOpen = on ? !customOpen : true;
      if (!on) apply({ theme: 'custom' }); else draw();
      if (customOpen) reveal('.vs-custom');
    },
    set(b) { apply({ [b.dataset.k]: b.dataset.v }); },
    toggle(b) { const k = b.dataset.k; apply({ [k]: !getView(scope)[k] }); },
    fullscreen() { setFullscreenOn(!fullscreenOn()); draw(); },
    awake() { setKeepAwake(!keepAwakeOn()); draw(); },
    'save-theme'() { saveMyTheme(getView(scope).custom); apply({ theme: 'custom' }); },
    'my-theme'(b) { const t = getMeta().myThemes[+b.dataset.i]; if (t) apply({ custom: { ...t }, theme: 'custom' }); },
    separate() { setSeparate(!getMeta().separate, scope); apply({}); },
    reset() { const { tapPaging, speed } = getView(scope); setView(scope, { ...DEFAULTS[scope], tapPaging, speed }); customOpen = false; apply({}); },
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
  root.querySelector('.vs-panel')?.focus?.({ preventScroll: true });
  open = { close };
  return open;
}
