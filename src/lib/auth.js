import { supabase, rpc } from './supabase.js';
import { APP_URL } from '../config.js';
import { clearOffline } from './offline/store.js';

const RETURN_KEY = 'auth:returnTo';
const LAST_ME_KEY = 'me:last';

// 로그아웃·차단 시 지울 기기 저장 데이터 (보기 설정 'ui:' 'view:' 는 기기 설정이라 유지)
const PRIVATE_PREFIXES = ['me:', 'cache:', 'outbox:', 'list:'];

// ---------------------------------------------------------------------
// 세션
// ---------------------------------------------------------------------
export async function getSession() {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session ?? null;
  } catch {
    return null;
  }
}

// 로그인 직후/앱 시작 시: 프로필 확인 (없으면 pending 으로 생성)
//   오프라인이면 마지막으로 확인된 프로필로 동작
export async function loadMe() {
  try {
    const me = await rpc('ensure_profile');
    if (me.status === 'blocked') {
      clearPrivateData();
    } else {
      try { localStorage.setItem(LAST_ME_KEY, JSON.stringify(me)); } catch {}
    }
    return me;
  } catch (err) {
    const last = lastMe();
    if (last && !navigator.onLine) return { ...last, offline: true };
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
