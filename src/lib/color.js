// 색 계산 (순수 함수): 대비, 섞기, 원문 글자색 보정

export function parseColor(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

export const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

export function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const la = luminance(Array.isArray(a) ? a : parseColor(a));
  const lb = luminance(Array.isArray(b) ? b : parseColor(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// a 와 b 를 k 비율로 섞기 (k=0 → a, k=1 → b)
export function mix(a, b, k) {
  const x = Array.isArray(a) ? a : parseColor(a);
  const y = Array.isArray(b) ? b : parseColor(b);
  return toHex(x.map((v, i) => v * (1 - k) + y[i] * k));
}

export const isDark = (hex) => luminance(parseColor(hex)) < 0.35;

// 채도가 거의 없는 색 (검정·회색·흰색)
export function isNeutral(rgb) {
  return Math.max(...rgb) - Math.min(...rgb) < 24;
}

/**
 * 원문 인라인 글자색을 현재 배경에 맞게 보정
 *   - 검정·회색 계열 → null (테마 글자색을 따르게)
 *   - 강조색이 배경에서 잘 안 보이면(대비 3:1 미만) 글자색 쪽으로 조금씩 섞어 보이게
 */
export function adjustTextColor(color, bg, fg) {
  const rgb = parseColor(color);
  if (!rgb) return null;
  if (isNeutral(rgb)) return null;
  const bgRgb = parseColor(bg);
  if (contrast(rgb, bgRgb) >= 3) return toHex(rgb);
  for (let k = 0.15; k <= 1; k += 0.15) {
    const c = mix(rgb, fg, k);
    if (contrast(parseColor(c), bgRgb) >= 3) return c;
  }
  return fg;
}
