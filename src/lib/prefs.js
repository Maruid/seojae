// 기기별 앱 화면 설정 (내 정보 → 화면 설정)
//   읽기 화면의 보기 설정은 2단계에서 view.js 로 따로 관리
import { loadFont, FONTS } from './fonts.js';
import { getView } from './view.js';

const KEY = 'ui:prefs';
const DEFAULTS = { mode: 'auto', appFont: 'system', sameAsBody: false, sameScope: 'column', appSize: 'normal' };
const SIZES = { small: '14px', normal: '15px', large: '17px' };

export function getPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    localStorage.setItem('ui:mode', next.mode);   // index.html 의 깜빡임 방지 스크립트용
  } catch {}
  applyPrefs(next);
  return next;
}

export function applyPrefs(p = getPrefs()) {
  const root = document.documentElement;
  if (p.mode === 'auto') delete root.dataset.theme;
  else root.dataset.theme = p.mode;

  // "본문 글꼴과 같게": 읽기 화면 보기 설정의 글꼴을 앱 전체에
  const key = p.sameAsBody ? getView(p.sameScope === 'novel' ? 'novel' : 'column').font : p.appFont;
  const font = FONTS[key] || FONTS.system;
  loadFont(key);
  root.style.setProperty('--app-font', font.stack);
  root.style.setProperty('--app-size', SIZES[p.appSize] || SIZES.normal);

  const meta = document.querySelectorAll('meta[name="theme-color"]');
  if (p.mode !== 'auto') meta.forEach((m) => m.setAttribute('content', p.mode === 'dark' ? '#15171A' : '#F5F4F0'));
  else meta.forEach((m) => m.setAttribute('content', m.media?.includes('dark') ? '#15171A' : '#F5F4F0'));
}
