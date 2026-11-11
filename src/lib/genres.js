// 장르 목록 (migration_007 의 genre_list · genre_alias)
//   - DB 에서 받아 기기에 기억. 표가 없거나(007 전) 오프라인이면 아래 기본값
//   - 비교는 띄어쓰기·대소문자 무시 ("현대 판타지" = "현대판타지", "sf" = "SF")
//   - 별칭: 현판 → 현대판타지 …

export const DEFAULT_GENRES = ['판타지', '현대판타지', '무협', '로맨스', '로맨스판타지', '라이트노벨', 'SF', '대체역사', '스포츠',
  '공포', '미스터리', '추리', 'BL', 'GL', '현대', '퓨전', '게임', '역사'];
export const DEFAULT_ALIAS = { 현판: '현대판타지', 로판: '로맨스판타지', 호러: '공포' };

const KEY = 'cache:genres';
let state = (() => {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s?.list?.length) return s; } catch {}
  return { list: DEFAULT_GENRES, alias: DEFAULT_ALIAS };
})();

export const genreKey = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
export const genreList = () => state.list;

export async function loadGenreList() {
  try {
    const { supabase } = await import('./supabase.js');
    const [l, a] = await Promise.all([
      supabase.from('genre_list').select('name,ord').order('ord'),
      supabase.from('genre_alias').select('alias,name'),
    ]);
    if (l.error || !l.data?.length) return state.list;
    state = { list: l.data.map((r) => r.name), alias: Object.fromEntries((a.data || []).map((r) => [r.alias, r.name])) };
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  } catch {}
  return state.list;
}

// 목록의 이름으로 (띄어쓰기 무시 + 별칭). 목록에 없으면 null
export function canonGenre(s, st = state) {
  const k = genreKey(s);
  if (!k) return null;
  const hit = st.list.find((g) => genreKey(g) === k);
  if (hit) return hit;
  const al = Object.entries(st.alias).find(([a]) => genreKey(a) === k);
  return al ? al[1] : null;
}

/**
 * 입력 중인 글 → 고를 수 있는 장르
 *   ① 앞부분이 같은 것 ② 중간에 들어 있는 것 ③ 별칭이 맞는 것 → 그다음 contains(입력 안에 들어 있는 장르, "퓨전무협" → 퓨전·무협)
 * 반환: { picks: [이름…], contained: [이름…] }  (exclude 는 이미 고른 것)
 */
export function suggestGenres(s, exclude = [], st = state) {
  const k = genreKey(s);
  if (!k) return { picks: [], contained: [] };
  const out = [];
  const add = (g) => { if (g && !out.includes(g) && !exclude.includes(g)) out.push(g); };
  st.list.filter((g) => genreKey(g).startsWith(k)).forEach(add);
  st.list.filter((g) => genreKey(g).includes(k)).forEach(add);
  Object.entries(st.alias).filter(([a]) => genreKey(a).startsWith(k)).forEach(([, g]) => add(g));
  const contained = st.list.filter((g) => genreKey(g).length >= 2 && k.includes(genreKey(g)) && !out.includes(g) && !exclude.includes(g));
  return { picks: out.slice(0, 6), contained: contained.slice(0, 4) };
}

// 목록 순서대로 (목록에 없는 건 뒤에)
export function sortGenres(arr, st = state) {
  const idx = (g) => { const i = st.list.indexOf(g); return i < 0 ? 999 : i; };
  return [...arr].sort((a, b) => idx(a) - idx(b));
}
