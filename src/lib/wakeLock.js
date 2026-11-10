// 화면 켜두기 (Screen Wake Lock)
//   - 'read': 읽기 화면에 있는 동안 — "읽는 동안 화면 켜두기" 설정이 켜져 있을 때만
//   - 'auto': 자동 재생 중 — 설정과 상관없이 항상
//   - 다른 앱에 다녀오면 브라우저가 풀어 버리므로 돌아왔을 때 다시 요청
const KEY = 'ui:keepAwake';
const wants = new Set();
let lock = null;
let pending = false;

export const wakeSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;
export function keepAwakeOn() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
export function setKeepAwake(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {}
  sync();
}

const needed = () => wants.has('auto') || (wants.has('read') && keepAwakeOn());

async function sync() {
  if (!wakeSupported()) return;
  if (needed()) {
    if (lock || pending || document.visibilityState !== 'visible') return;
    pending = true;
    try {
      const l = await navigator.wakeLock.request('screen');
      lock = l;
      l.addEventListener('release', () => { if (lock === l) lock = null; });
    } catch {}
    pending = false;
    if (!needed()) sync();
  } else if (lock) {
    const l = lock;
    lock = null;
    l.release().catch(() => {});
  }
}

export function wantAwake(reason, on) {
  if (on) wants.add(reason); else wants.delete(reason);
  sync();
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sync);
