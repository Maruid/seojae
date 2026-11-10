// "읽을 때 전체 화면" (칼럼·소설 공통, 기기별, 기본 끔)
//   - 브라우저 규칙상 화면을 한 번 눌러야 전체 화면이 됨 → 읽기 화면에서 첫 탭 때 적용
//   - 글·회차를 넘겨도 유지, 목록·홈으로 나가면 풂 (main.js)
//   - 다른 앱에 다녀와서 풀렸으면 다음 탭에서 다시 적용
//   - iPhone(웹 전체 화면 미지원)·지원 안 하는 브라우저에서는 설정 자체를 숨김
const KEY = 'ui:fullscreen';
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const fullscreenSupported = () => !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false && !isIOS();
export function fullscreenOn() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
export function setFullscreenOn(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {}
  if (on) enter(); else exitFullscreen();
}

function enter() {
  if (!fullscreenSupported() || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
export function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// 읽기 화면에서 호출: 화면을 누를 때마다(이미 전체 화면이면 무시) 켜져 있으면 적용
export function armFullscreen() {
  const onDown = () => { if (fullscreenOn()) enter(); };
  window.addEventListener('pointerup', onDown, true);
  return () => window.removeEventListener('pointerup', onDown, true);
}
