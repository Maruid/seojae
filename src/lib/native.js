// 안드로이드 앱(Capacitor) 안에서만 켜지는 기능
//   웹(크롬·PWA)에서는 isApp() 이 false → 여기 기능은 아무것도 하지 않음 (웹 동작은 그대로)
//   - 로그인: 크롬 탭으로 구글 로그인 → io.github.maruid.seojae://login 으로 앱에 돌아옴 → 코드 교환
//   - 볼륨키: 읽기 화면에서만 앱이 가로채 → 아래 = 다음 화면(PageDown), 위 = 이전 화면(PageUp)
//   - 화면 켜짐 유지: 앱 쪽 기능으로
//   - 웹 화면 업데이트: GitHub Pages 의 app/version.json 을 보고 새 묶음을 받아 "새로고침" 때 적용
//   - 앱 업데이트 안내: 새 웹 화면이 필요로 하는 앱 기능 버전(min_native_api)보다 앱이 낮으면 APK 받기 안내
import { registerPlugin } from '@capacitor/core';

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

// ---- 앱 시작 때 (main.js boot) ----
export async function initApp({ supabase, toast, showBar }) {
  if (!isApp()) return;
  document.documentElement.classList.add('is-app');
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
    App.addListener('resume', () => checkBundle({ showBar }));
  } catch {}
  setTimeout(() => checkBundle({ showBar }), 4000);
}
