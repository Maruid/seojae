// PWA: Service Worker 등록 · 새 버전 배너 · 설치 창
import { html, mount, onAction } from './dom.js';

let deferred = null;               // Chrome 설치 창 (beforeinstallprompt)
const listeners = new Set();
export const onInstallChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(); } catch {} });

export const canPrompt = () => !!deferred;
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function promptInstall() {
  if (!deferred) return null;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  emit();
  return outcome;   // 'accepted' | 'dismissed'
}

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;

  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).then((reg) => {
    const ask = () => { if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting); };
    ask();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') ask(); });
    });
    // 앱을 오래 켜 두는 경우: 다시 볼 때마다 새 버전 확인
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});

  // 첫 설치 때도 controllerchange 가 오므로, 사용자가 "새로고침"을 눌렀을 때만 다시 읽음
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!applying || reloaded) return;
    reloaded = true;
    location.reload();
  });
}
let applying = false;
let reloaded = false;

function showUpdate(worker) {
  if (document.querySelector('.upd-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'upd-bar';
  bar.setAttribute('role', 'status');
  mount(bar, html`<span>새 버전이 있어요</span>
    <button type="button" data-action="apply">새로고침</button>
    <button type="button" class="upd-x" data-action="later" aria-label="나중에">나중에</button>`);
  onAction(bar, {
    apply() { applying = true; worker.postMessage({ type: 'SKIP_WAITING' }); bar.remove(); },
    later() { bar.remove(); },
  });
  document.body.appendChild(bar);
}

// 열어 본 글 저장 공간 (오프라인용)
export async function contentCacheInfo() {
  let count = 0;
  if (window.caches) {
    for (const k of await caches.keys()) if (k.startsWith('seojae-content')) count += (await (await caches.open(k)).keys()).length;
  }
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  return { count, usage: est?.usage || 0 };
}
export async function clearContentCache() {
  if (!window.caches) return;
  for (const k of await caches.keys()) if (k.startsWith('seojae-content')) await caches.delete(k);
}
