// 기기별 앱 화면 설정 (내 정보 → 화면 설정)
//   읽기 화면의 보기 설정은 2단계에서 view.js 로 따로 관리
import { loadFont, FONTS } from './fonts.js';

const KEY = 'ui:prefs';
const DEFAULTS = { mode: 'auto', appFont: 'system', sameAsBody: false, appSize: 'normal' };
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

  // "본문 글꼴과 같게" 는 2단계(보기 설정)에서 본문 글꼴을 읽어와 적용
  const font = FONTS[p.appFont] || FONTS.system;
  loadFont(p.appFont);
  root.style.setProperty('--app-font', font.stack);
  root.style.setProperty('--app-size', SIZES[p.appSize] || SIZES.normal);

  const meta = document.querySelectorAll('meta[name="theme-color"]');
  if (p.mode !== 'auto') meta.forEach((m) => m.setAttribute('content', p.mode === 'dark' ? '#15171A' : '#F5F4F0'));
}
