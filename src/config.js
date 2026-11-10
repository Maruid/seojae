// 공개 설정값 (브라우저에 그대로 노출되는 값만)
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

// OAuth 복귀 주소: 앱 루트 (해시 경로는 sessionStorage 로 따로 복원)
export const APP_URL = new URL(import.meta.env.BASE_URL, location.origin).href;

export const STORAGE_BUCKET = 'content';
