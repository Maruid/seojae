// 안드로이드 앱(Capacitor) 안에서만 켜지는 기능
//   웹(크롬·PWA)에서는 isApp() 이 false → 여기 기능은 아무것도 하지 않음 (웹 동작은 그대로)
//   - 로그인: 크롬 탭으로 구글 로그인 → io.github.maruid.seojae://login 으로 앱에 돌아옴 → 코드 교환
//   - 볼륨키: 읽기 화면에서만 앱이 가로채 → 아래 = 다음 화면(PageDown), 위 = 이전 화면(PageUp)
//   - 화면 켜짐 유지: 앱 쪽 기능으로
//   - 웹 화면 업데이트: GitHub Pages 의 app/version.json 을 보고 새 묶음을 받아 "새로고침" 때 적용
//   - 앱 업데이트 안내: 새 웹 화면이 필요로 하는 앱 기능 버전(min_native_api)보다 앱이 낮으면 APK 받기 안내
import { registerPlugin, SystemBars, Capacitor } from '@capacitor/core';

export const APP_SCHEME = 'io.github.maruid.seojae';
export const APP_LOGIN_URL = `${APP_SCHEME}://login`;
export const APK_URL = 'https://github.com/Maruid/seojae/releases/latest/download/seojae.apk';
const PAGES_URL = 'https://maruid.github.io/seojae/';
const BUNDLE = import.meta.env.VITE_APP_BUNDLE || 'dev';   // 이 웹 묶음의 버전 (빌드 때 커밋 해시)

export const isApp = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

let seojae = null;
const plugin = () => (seojae ||= registerPlugin('Seojae'));

// ---- 앱 쪽 기능 버전 ----
let nativeApi = null;
export async function nativeApiLevel() {
  if (!isApp()) return 0;
  if (nativeApi != null) return nativeApi;
  try { nativeApi = (await plugin().info()).api || 0; } catch { nativeApi = 0; }
  return nativeApi;
}

// ---- 볼륨키 ----
const VOL_KEY = 'ui:volumeKeys';
export const volumeKeysOn = () => { try { return localStorage.getItem(VOL_KEY) !== '0'; } catch { return true; } };
let volWanted = false;
export function setVolumeKeysPref(on) {
  try { localStorage.setItem(VOL_KEY, on ? '1' : '0'); } catch {}
  applyVolumeKeys();
}
// 읽기 화면에 들어가고 나갈 때 main.js 가 부름
export function wantVolumeKeys(on) { volWanted = on; applyVolumeKeys(); }
function applyVolumeKeys() {
  if (!isApp()) return;
  plugin().setVolumeKeys({ on: volWanted && volumeKeysOn() }).catch(() => {});
}

// ---- 전체 화면 (앱, 읽기 화면에서만, 기본 끔) ----
//   앱 2(API 2)+: 상태 바·제스처 바를 숨기고, 가장자리에서 쓸면 잠깐 보였다 저절로 들어감
//   옛 앱(API 1): 기본 기능으로 숨기고, 쓸어 꺼낸 바는 넘기거나 스크롤할 때 다시 숨김
const IMM_KEY = 'ui:appImmersive';
export const appImmersiveOn = () => { try { return localStorage.getItem(IMM_KEY) === '1'; } catch { return false; } };
let immWanted = false;
let immOn = null;
export function setAppImmersivePref(on) {
  try { localStorage.setItem(IMM_KEY, on ? '1' : '0'); } catch {}
  applyImmersive(true);
}
export function wantImmersive(reading) { immWanted = reading; applyImmersive(); }
async function applyImmersive(force = false) {
  if (!isApp()) return;
  const on = immWanted && appImmersiveOn();
  if (on === immOn && !force) return;
  immOn = on;
  // 바를 숨겨도 카메라 구멍 띠는 그대로: 숨기기 전 상태 바 높이를 붙잡아 둠 (읽기 화면 색 띠)
  const root = document.documentElement;
  if (on) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;height:var(--sat)';
    document.body.append(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    if (h > 0) root.style.setProperty('--sat', `${h}px`);
    root.classList.add('is-imm');
  } else {
    root.style.removeProperty('--sat');
    root.classList.remove('is-imm');
  }
  if ((await nativeApiLevel()) >= 2) { plugin().setImmersive({ on }).catch(() => {}); return; }
  (on ? SystemBars.hide({}) : SystemBars.show({})).catch(() => {});
}
// 옛 앱: 쓸어서 꺼낸 바를 넘길 때 다시 숨김 (읽기 화면이 스크롤·넘길 때 부름)
let rehideAt = 0;
export function rehideBars() {
  if (!isApp() || !immOn || nativeApi == null || nativeApi >= 2) return;
  const now = Date.now();
  if (now - rehideAt < 1500) return;
  rehideAt = now;
  SystemBars.hide({}).catch(() => {});
}

// ---- 화면이 꺼져도 받기 (앱 2+) ----
export async function nativeDlReady() { return isApp() && (await nativeApiLevel()) >= 2; }
export const nativeDl = {
  info: () => plugin().dlInfo(),
  list: () => plugin().dlList(),
  start: (o) => plugin().dlStart(o),
  status: () => plugin().dlStatus(),
  take: () => plugin().dlTakeResults(),
  cancel: () => plugin().dlCancel(),
  remove: (names) => plugin().dlDelete({ names }),
  clear: () => plugin().dlClear(),
  on: (ev, fn) => plugin().addListener(ev, fn),
};
export const fileSrc = (absPath) => Capacitor.convertFileSrc(`file://${absPath}`);

// ---- 화면 켜짐 유지 ----
export function setNativeKeepAwake(on) {
  if (!isApp()) return Promise.resolve(false);
  return plugin().setKeepAwake({ on }).then(() => true, () => false);
}

// ---- 로그인 (크롬 탭) ----
export async function appSignIn(supabase) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: APP_LOGIN_URL, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: data.url });
}

// 크롬 탭에서 앱으로 돌아온 주소 처리 → 성공하면 true
async function handleAuthUrl(url, supabase, toast) {
  if (!url?.startsWith(APP_LOGIN_URL)) return false;
  try { const { Browser } = await import('@capacitor/browser'); await Browser.close(); } catch {}
  let u;
  try { u = new URL(url.replace(`${APP_SCHEME}://`, 'https://app/')); } catch { return false; }
  const q = u.searchParams;
  const h = new URLSearchParams(u.hash.slice(1));
  const err = q.get('error_description') || h.get('error_description') || q.get('error') || h.get('error');
  if (err) { toast(`로그인하지 못했어요. ${err}`); return true; }
  const code = q.get('code');
  if (!code) return true;
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) { toast('로그인하지 못했어요. 다시 시도해 주세요.'); return true; }
  let back = '#/';
  try { back = sessionStorage.getItem('auth:returnTo') || '#/'; sessionStorage.removeItem('auth:returnTo'); } catch {}
  location.hash = back;
  location.reload();
  return true;
}

// ---- 웹 화면 묶음 업데이트 ----
async function checkBundle({ showBar }) {
  if (!navigator.onLine) return;
  let info;
  try {
    const r = await fetch(`${PAGES_URL}app/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    info = await r.json();
  } catch { return; }
  const api = await nativeApiLevel();
  // 새 웹 화면이 이 앱보다 새 앱 기능을 필요로 하면 묶음은 바꾸지 않고 앱 업데이트 안내
  if ((info.min_native_api || 0) > api) {
    showBar({ text: '앱을 업데이트해 주세요', action: '받기', run: () => openExternal(info.apk || APK_URL) });
    return;
  }
  if (!info.version || !info.url || info.version === BUNDLE) return;
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    const cur = await CapacitorUpdater.current();
    if (cur?.bundle?.version === info.version) return;
    const listed = await CapacitorUpdater.list().catch(() => ({ bundles: [] }));
    let b = (listed.bundles || []).find((x) => x.version === info.version && x.status !== 'error');
    if (!b) b = await CapacitorUpdater.download({ url: info.url, version: info.version });
    await CapacitorUpdater.next({ id: b.id });   // 다음에 앱을 열 때 적용
    showBar({ text: '새 버전이 있어요', action: '새로고침', run: () => CapacitorUpdater.set({ id: b.id }) });
  } catch {}
}

export async function openExternal(url) {
  try { const { Browser } = await import('@capacitor/browser'); await Browser.open({ url }); } catch { location.href = url; }
}

// ---- 상태 바 글자색: 화면 배경이 밝으면 어두운 글자, 어두우면 밝은 글자 ----
//   html 배경(앱 화면 모드 · 읽기 화면 테마)이 바뀔 때마다 맞춤
let barStyle = null;
function syncBarStyle() {
  const m = getComputedStyle(document.documentElement).backgroundColor.match(/\d+(\.\d+)?/g);
  if (!m) return;
  const [r, g, b] = m.map(Number);
  const style = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5 ? 'DARK' : 'LIGHT';
  if (style === barStyle) return;
  barStyle = style;
  SystemBars.setStyle({ style }).catch(() => {});
}
function watchBarStyle() {
  let t = null;
  const later = () => { clearTimeout(t); t = setTimeout(syncBarStyle, 30); };
  new MutationObserver(later).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', later);
  syncBarStyle();
}

// ---- 앱 시작 때 (main.js boot) ----
export async function initApp({ supabase, toast, showBar, onResume = null }) {
  if (!isApp()) return;
  document.documentElement.classList.add('is-app');
  watchBarStyle();
  // 새 묶음이 제대로 열렸다고 알림 (안 하면 15초 뒤 예전 묶음으로 되돌림)
  import('@capgo/capacitor-updater').then(({ CapacitorUpdater }) => CapacitorUpdater.notifyAppReady()).catch(() => {});

  // 볼륨키 → 읽기 화면의 PageDown / PageUp
  window.addEventListener('seojaeVolumeKey', (e) => {
    if (e.repeat > 0) return;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: e.dir === 'prev' ? 'PageUp' : 'PageDown', bubbles: true, cancelable: true }));
  });

  // 로그인 복귀 (앱이 떠 있을 때 · 꺼져 있다가 열렸을 때)
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('appUrlOpen', ({ url }) => { handleAuthUrl(url, supabase, toast); });
    const launch = await App.getLaunchUrl().catch(() => null);
    if (launch?.url) await handleAuthUrl(launch.url, supabase, toast);
    // 다시 앱으로 돌아올 때마다 업데이트 확인
    App.addListener('resume', () => { checkBundle({ showBar }); onResume?.(); if (immOn) applyImmersive(true); });
  } catch {}
  setTimeout(() => checkBundle({ showBar }), 4000);
}
