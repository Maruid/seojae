// 글꼴 목록 (앱 글꼴 · 본문 글꼴 공용)
//   선택한 글꼴만 그때 불러옴. 한 번 불러온 건 브라우저 캐시 (4단계에서 Service Worker 캐시 추가)
const GF = 'https://fonts.googleapis.com/css2?display=swap&family=';

export const FONTS = {
  system:        { label: '기기 기본', kind: 'sans',  stack: "system-ui, -apple-system, 'Noto Sans KR', sans-serif", weights: [300, 400, 600] },
  pretendard:    { label: '프리텐다드', kind: 'sans',  stack: "'Pretendard Variable', Pretendard, system-ui, sans-serif",
                   css: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
                   weights: [300, 400, 600] },
  notoSans:      { label: '본고딕',   kind: 'sans',  stack: "'Noto Sans KR', sans-serif", css: GF + 'Noto+Sans+KR:wght@300;400;500;600;700', weights: [300, 400, 600] },
  nanumGothic:   { label: '나눔고딕', kind: 'sans',  stack: "'Nanum Gothic', sans-serif", css: GF + 'Nanum+Gothic:wght@400;700', weights: [400, 700] },
  gowunDodum:    { label: '고운돋움', kind: 'sans',  stack: "'Gowun Dodum', sans-serif", css: GF + 'Gowun+Dodum', weights: [400] },
  notoSerif:     { label: '본명조',   kind: 'serif', stack: "'Noto Serif KR', serif", css: GF + 'Noto+Serif+KR:wght@300;400;600;700', weights: [300, 400, 600] },
  nanumMyeongjo: { label: '나눔명조', kind: 'serif', stack: "'Nanum Myeongjo', serif", css: GF + 'Nanum+Myeongjo:wght@400;700', weights: [400, 700] },
  gowunBatang:   { label: '고운바탕', kind: 'serif', stack: "'Gowun Batang', serif", css: GF + 'Gowun+Batang:wght@400;700', weights: [400, 700] },
  hahmlet:       { label: '함렛',     kind: 'serif', stack: "'Hahmlet', serif", css: GF + 'Hahmlet:wght@300;400;600', weights: [300, 400, 600] },
};

// 앱 글꼴로 고를 수 있는 것 (명조는 작은 UI 글씨에 안 맞아서 제외)
export const APP_FONTS = ['system', 'pretendard', 'nanumGothic', 'gowunDodum'];

const loaded = new Set();
export function loadFont(key) {
  const f = FONTS[key];
  if (!f?.css || loaded.has(key) || typeof document === 'undefined') return;
  loaded.add(key);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = f.css;
  document.head.appendChild(link);
}

// 글자 두께: thin(가늘게) / normal(보통) / bold(굵게) → 그 글꼴에 있는 실제 두께. 없으면 null
export function resolveWeight(fontKey, level = 'normal') {
  const w = (FONTS[fontKey] || FONTS.system).weights || [400];
  if (level === 'thin') return w.includes(300) ? 300 : null;
  if (level === 'bold') return w.find((x) => x >= 500 && x <= 600) || w.find((x) => x > 600) || null;
  return 400;
}
