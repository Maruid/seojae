import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  // 로컬: .env.local / 배포: GitHub Variables 가 비어 있으면 바로 알 수 있게
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_KEY 가 설정되지 않았습니다.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    flowType: 'pkce',          // OAuth 복귀 시 ?code= 로 돌아옴 → 클라이언트가 자동 교환
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'seojae-auth',
  },
});

// RPC 에서 raise 하는 코드 → 화면 문구
const MESSAGES = {
  AUTH_REQUIRED: '로그인이 필요해요.',
  ADMIN_ONLY: '관리자만 할 수 있어요.',
  NOT_FOUND: '대상을 찾을 수 없어요.',
  INVALID_STATUS: '잘못된 상태 값이에요.',
  INVALID_NAME: '이름은 1~40자로 입력해 주세요.',
  CANNOT_CHANGE_SELF: '내 계정은 차단하거나 대기로 바꿀 수 없어요.',
};

export function errorMessage(err) {
  const raw = err?.message || String(err || '');
  for (const [code, msg] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return msg;
  }
  if (!navigator.onLine || /Failed to fetch|NetworkError/i.test(raw)) {
    return '인터넷 연결을 확인해 주세요.';
  }
  return '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}

export async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}
