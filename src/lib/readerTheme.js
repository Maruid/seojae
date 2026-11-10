// 읽기 화면 색·글꼴 적용 (칼럼·소설 공용)
//   보기 설정 → CSS 변수, 상태바(theme-color)·페이지 배경까지 읽기 테마 색으로
import { FONTS, loadFont, resolveWeight } from './fonts.js';
import { getView, cssVars, themeColors } from './view.js';
import { getPrefs, applyPrefs } from './prefs.js';

export const appDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

export function applyReaderTheme(els, scope) {
  const v = getView(scope);
  loadFont(v.font);
  const font = FONTS[v.font] || FONTS.system;
  const vars = cssVars(v, font.stack, appDark(), resolveWeight(v.font, v.weight) || 400);
  for (const el of els) if (el) for (const [k, val] of Object.entries(vars)) el.style.setProperty(k, val);
  const c = themeColors(v, appDark());
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', c.bg));
  // 끝에서 당겨 튕길 때 등 본문 밖으로 보이는 배경도 같은 색
  document.documentElement.style.background = c.bg;
  document.documentElement.style.colorScheme = c.dark ? 'dark' : 'light';
  if (getPrefs().sameAsBody) applyPrefs();
  return c;
}

export function resetReaderTheme() {
  document.documentElement.style.background = '';
  document.documentElement.style.colorScheme = '';
  applyPrefs();
}
