// 보기 설정 (기기별, localStorage)
//   scope: 'column' | 'novel'
//   "칼럼과 소설 따로 설정" 이 꺼져 있으면 두 scope 가 'shared' 값을 같이 씀
import { mix, isDark, contrast } from './color.js';

export const THEMES = {
  light: { label: '밝게',   bg: '#FFFFFF', fg: '#1B1D21' },
  paper: { label: '종이',   bg: '#F3EDE1', fg: '#2B2620' },
  sepia: { label: '세피아', bg: '#EAD9B8', fg: '#4A3622' },
  dark:  { label: '어둡게', bg: '#15171A', fg: '#D9D6CF' },
  black: { label: '검정',   bg: '#000000', fg: '#BDBDBD' },
};

const BASE = {
  fontSize: 16, lh: 1.8, font: 'nanumGothic',
  margin: 20,          // 모바일 좌우 여백 (px)
  width: 700,          // PC 본문 폭 (px)
  theme: null,         // null = 앱 화면 모드를 따름 (밝게/어둡게)
  custom: { bg: '#1E2A24', fg: '#DCE6DA' },
  paraGap: 0,          // 문단 간격 (줄 단위)
  align: 'left', track: 'normal', indent: false,
  tapPaging: true, speed: 4,
  weight: 'normal',     // thin | normal | bold
};

export const DEFAULTS = {
  column: { ...BASE },
  novel:  { ...BASE, fontSize: 18, font: 'notoSerif', paraGap: 0.5 },
};

export const LIMITS = { fontSize: [14, 30], lh: [1.4, 2.4], margin: [12, 40], width: [560, 860], paraGap: [0, 2], speed: [1, 10] };

const store = () => globalThis.localStorage;
const read = (k, d) => { try { return JSON.parse(store().getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { store().setItem(k, JSON.stringify(v)); } catch {} };

export function getMeta() {
  return { separate: true, myThemes: [], ...read('view:meta', {}) };
}

function keyFor(scope, meta = getMeta()) {
  return meta.separate ? `view:${scope}` : 'view:shared';
}

export function getView(scope) {
  const saved = read(keyFor(scope), {});
  return { ...DEFAULTS[scope], ...saved, custom: { ...DEFAULTS[scope].custom, ...(saved.custom || {}) } };
}

export function setView(scope, patch) {
  const next = { ...getView(scope), ...patch };
  write(keyFor(scope), next);
  return next;
}

export function setSeparate(on, scope) {
  const meta = getMeta();
  if (meta.separate === on) return;
  // 공유로 바꿀 땐 지금 보고 있는 화면의 설정을 공유 값으로 시작
  if (!on) write('view:shared', getView(scope));
  write('view:meta', { ...meta, separate: on });
}

export function saveMyTheme(custom) {
  const meta = getMeta();
  const list = [custom, ...meta.myThemes.filter((t) => t.bg !== custom.bg || t.fg !== custom.fg)].slice(0, 3);
  write('view:meta', { ...meta, myThemes: list });
  return list;
}

// 현재 테마의 실제 색 (상단바·설정 창 색까지 배경 밝기에 맞춰 파생)
export function themeColors(v, appDark = false) {
  const t = v.theme === 'custom' ? v.custom : THEMES[v.theme || (appDark ? 'dark' : 'light')];
  const { bg, fg } = t;
  const dark = isDark(bg);
  return {
    bg, fg, dark,
    muted: mix(fg, bg, 0.38),
    line: mix(fg, bg, 0.84),
    chip: mix(fg, bg, 0.91),
    sheet: dark ? mix(bg, '#FFFFFF', 0.07) : mix(bg, '#FFFFFF', 0.6),
    link: dark ? '#E89A6B' : '#9A4422',
    contrast: contrast(bg, fg),
  };
}

// 읽기 화면 루트에 거는 CSS 변수
export function cssVars(v, fontStack, appDark, weight = 400) {
  const c = themeColors(v, appDark);
  const tracks = { narrow: '-0.02em', normal: '0', wide: '0.04em' };
  return {
    '--r-bg': c.bg, '--r-fg': c.fg, '--r-muted': c.muted, '--r-line': c.line, '--r-chip': c.chip,
    '--r-sheet': c.sheet, '--r-link': c.link,
    '--r-size': `${v.fontSize}px`, '--r-lh': String(v.lh), '--r-font': fontStack,
    '--r-pad': `${v.margin}px`, '--r-width': `${v.width}px`,
    '--r-para': `${(v.paraGap * v.lh).toFixed(2)}em`,
    '--r-align': v.align === 'justify' ? 'justify' : 'left',
    '--r-track': tracks[v.track] || '0',
    '--r-indent': v.indent ? '1em' : '0',
    '--r-weight': String(weight || 400),
    '--r-glass': `color-mix(in srgb, ${c.bg} 80%, transparent)`,
  };
}

export const clamp = (k, n) => Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], n));
