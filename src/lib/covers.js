// 소설 표지 (upload.py 가 올린 novels/<id>/cover-<해시>.webp)
//   - 비공개 저장소라 서명 주소가 필요 → 7일짜리로 받아 이 기기에 기억
//   - 서비스 워커가 주소 뒤 토큰을 빼고 저장하므로, 기한이 지난 주소라도 한 번 본 표지는 오프라인에서 보임
//   - 표지가 바뀌면 파일 이름(해시)이 바뀌어 새로 받음
import { supabase } from './supabase.js';
import { STORAGE_BUCKET } from '../config.js';

const KEY = 'cover:urls';
const TTL = 7 * 24 * 3600;
let urls = null;
const load = () => { if (!urls) { try { urls = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { urls = {}; } } return urls; };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(urls)); } catch {} };

// 지금 바로 쓸 수 있는 주소 (기한 지난 것도 돌려줌 → 오프라인 캐시용)
export const coverUrl = (path) => (path ? load()[path]?.url || null : null);

// 필요한 표지 주소를 받아 둠. 새로 받은 게 있으면 true
export async function signCovers(paths) {
  const m = load();
  const now = Date.now();
  const need = [...new Set(paths.filter(Boolean))].filter((p) => !(m[p]?.exp > now + 3600_000));
  if (!need.length) return false;
  for (let i = 0; i < need.length; i += 100) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(need.slice(i, i + 100), TTL);
    if (error) throw error;
    for (const d of data || []) if (d.signedUrl) m[d.path] = { url: d.signedUrl, exp: now + TTL * 1000 };
  }
  // 목록에 없는 옛 표지 주소는 정리
  const keep = new Set(paths);
  for (const k of Object.keys(m)) if (!keep.has(k) && m[k].exp < now) delete m[k];
  save();
  return true;
}

// 표지가 없을 때: 제목으로 색을 정해 만든 기본 표지
export function coverHue(title) {
  let h = 0;
  for (const ch of String(title || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
