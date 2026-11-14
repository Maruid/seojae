import { supabase, rpc, isOffline } from './supabase.js';
import { APP_URL } from '../config.js';
import { clearOffline } from './offline/store.js';
import { isApp, appSignIn } from './native.js';

const RETURN_KEY = 'auth:returnTo';
const LAST_ME_KEY = 'me:last';

// 로그아웃·차단 시 지울 기기 저장 데이터 (보기 설정 'ui:' 'view:' 는 기기 설정이라 유지)
const PRIVATE_PREFIXES = ['me:', 'cache:', 'outbox:', 'list:'];

// ---------------------------------------------------------------------
// 세션
// ---------------------------------------------------------------------
// 기기에 저장된 세션 (서버에 묻지 않음)
function storedSession() {
  try { const s = JSON.parse(localStorage.getItem('seojae-auth') || 'null'); return s?.access_token ? s : null; } catch { return null; }
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { timeout: true })), ms))]);

// 오프라인이면 저장된 세션 그대로, 연결이 느리면 3초 뒤 저장된 세션으로 먼저 시작
//   (만료된 토큰을 갱신하느라 라이브러리가 최대 30초 기다리는 동안 화면이 비지 않게)
export async function getSession() {
  if (isOffline()) return storedSession();
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), 3000);
    return data.session ?? null;
  } catch {
    return storedSession();
  }
}

// 로그인 직후/앱 시작 시: 프로필 확인 (없으면 pending 으로 생성)
//   오프라인이면 마지막으로 확인된 프로필로 동작
//   연결이 느려 2.5초 안에 답이 없으면 마지막 프로필로 먼저 열고(offline), 답은 lateMe() 로 받음
let late = null;
export const lateMe = () => late;
function keepMe(me) {
  if (me.status === 'blocked') clearPrivateData();
  else { try { localStorage.setItem(LAST_ME_KEY, JSON.stringify(me)); } catch {} }
  return me;
}
export async function loadMe() {
  late = null;
  const last = lastMe();
  if (isOffline() && last) return { ...last, offline: true };
  const job = rpc('ensure_profile').then(keepMe);
  try {
    return await (last ? withTimeout(job, 2500) : job);
  } catch (err) {
    if (err?.timeout && last) { late = job; job.catch(() => {}); return { ...last, offline: true, slow: true }; }
    if (last && (isOffline() || /Failed to fetch|NetworkError|timeout/i.test(err?.message || ''))) return { ...last, offline: true };
    throw err;
  }
}

export function lastMe() {
  try { return JSON.parse(localStorage.getItem(LAST_ME_KEY) || 'null'); } catch { return null; }
}

// ---------------------------------------------------------------------
// Google 로그인 (OAuth 는 앱 루트로 돌아오고, 보던 해시는 sessionStorage 로 복원)
// ---------------------------------------------------------------------
export async function signInWithGoogle() {
  try {
    const h = location.hash;
    sessionStorage.setItem(RETURN_KEY, h && h !== '#/login' ? h : '#/');
  } catch {}
  // 앱: 앱 안에서는 구글이 로그인을 막으므로 크롬 탭으로 열고 앱으로 돌아옴
  if (isApp()) return appSignIn(supabase);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: APP_URL, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
}

export function consumeReturn() {
  try {
    const v = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return v;
  } catch { return null; }
}

// OAuth 복귀 URL 에 실린 에러 (사용자가 취소 등)
export function readAuthError() {
  const q = new URLSearchParams(location.search);
  const h = location.hash.startsWith('#error') ? new URLSearchParams(location.hash.slice(1)) : null;
  const p = q.get('error') ? q : h;
  if (!p?.get('error')) return null;
  return { code: p.get('error_code') || p.get('error'), description: p.get('error_description') || '' };
}

// ?code= / ?error= 를 주소창에서 지우고 원래 보던 해시로
export function cleanAuthUrl() {
  const hasAuthParams = /[?&](code|error)=/.test(location.search) || location.hash.startsWith('#error');
  if (!hasAuthParams) return false;
  const back = consumeReturn() || '#/';
  history.replaceState(null, '', APP_URL + back);
  return true;
}

// ---------------------------------------------------------------------
// 로그아웃: 공용 PC 에 읽기 기록·목록 캐시가 남지 않게 정리
// ---------------------------------------------------------------------
export function clearPrivateData() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && PRIVATE_PREFIXES.some((p) => k.startsWith(p))) keys.push(k);
  }
  keys.forEach((k) => { try { localStorage.removeItem(k); } catch {} });
  // 열어 본 글 저장 공간 + 다운로드한 글(파일·기록)
  if (window.caches) caches.keys().then((ks) => ks.filter((k) => k.startsWith('seojae-content')).forEach((k) => caches.delete(k)));
  clearOffline();
}

export async function signOut() {
  clearPrivateData();
  await supabase.auth.signOut();
}

export async function updateMyName(name) {
  await rpc('update_my_name', { p_name: name });
}
