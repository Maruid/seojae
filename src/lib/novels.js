// 소설 목록 · 회차 목록 · 회차 본문 불러오기
import { supabase } from './supabase.js';
import { STORAGE_BUCKET } from '../config.js';

const LIST_KEY = 'list:novels';
const chKey = (id) => `list:novel:${id}`;
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let novels = null;
let novelsAt = 0;
export const cachedNovels = () => novels || (novels = read(LIST_KEY));
export const novelById = (id) => (cachedNovels() || []).find((n) => n.id === id) || null;

export async function loadNovels({ force = false } = {}) {
  if (!force && novels && Date.now() - novelsAt < 120_000) return novels;
  const q = (cols) => supabase.from('novels').select(cols).order('last_added_at', { ascending: false, nullsFirst: false });
  // 마이그레이션이 덜 됐으면(칸 없음 42703) 있는 칸만으로라도 목록은 보이게: 006(큰 표지) → 004(장르 목록·표지) → 003(작가·장르·태그) → 기본
  let { data, error } = await q('id,title,author,genre,genres,tags,cover_path,cover_large_path,chapter_count,last_added_at,key_mode,updated_at');
  if (error?.code === '42703') ({ data, error } = await q('id,title,author,genre,genres,tags,cover_path,chapter_count,last_added_at,key_mode,updated_at'));
  if (error?.code === '42703') ({ data, error } = await q('id,title,author,genre,tags,chapter_count,last_added_at,key_mode,updated_at'));
  if (error?.code === '42703') ({ data, error } = await q('id,title,chapter_count,last_added_at,key_mode,updated_at'));
  if (error) { if (cachedNovels()) return novels; throw error; }
  novels = data;
  novelsAt = Date.now();
  write(LIST_KEY, data);
  return novels;
}

// 회차 목록 (seq 순서). 887화 같은 긴 소설도 1,000개씩 나눠 받음
const chapters = new Map();   // id → { at, list }
export const cachedChapters = (id) => chapters.get(id)?.list || read(chKey(id));

export async function loadChapters(id, { force = false } = {}) {
  const c = chapters.get(id);
  if (!force && c && Date.now() - c.at < 120_000) return c.list;
  const list = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('novel_chapters')
      .select('key,seq,title,display_title,char_count,added_at,path')
      .eq('novel_id', id).order('seq').range(from, from + 999);
    if (error) { const old = cachedChapters(id); if (old) return old; throw error; }
    list.push(...data);
    if (data.length < 1000) break;
  }
  chapters.set(id, { at: Date.now(), list });
  write(chKey(id), list);
  return list;
}

// 새 회차 수 (그 소설을 마지막으로 연 뒤 추가된 회차)
export async function countNewSince(id, since) {
  const { count, error } = await supabase.from('novel_chapters')
    .select('key', { count: 'exact', head: true }).eq('novel_id', id).gt('added_at', since);
  if (error) return null;
  return count;
}

// 회차 본문: 메모리 캐시 (다음 회차 미리 받기에도 사용)
const texts = new Map();
const pending = new Map();
export function fetchChapterText(ch) {
  if (texts.has(ch.path)) return Promise.resolve(texts.get(ch.path));
  if (pending.has(ch.path)) return pending.get(ch.path);
  const job = supabase.storage.from(STORAGE_BUCKET).download(ch.path).then(async ({ data, error }) => {
    if (error) throw error;
    const t = await data.text();
    texts.set(ch.path, t);
    if (texts.size > 12) texts.delete(texts.keys().next().value);
    return t;
  }).finally(() => pending.delete(ch.path));
  pending.set(ch.path, job);
  return job;
}
export const prefetchChapter = (ch) => { if (ch) fetchChapterText(ch).catch(() => {}); };

// 회차 정렬 (회차 목록 화면과 읽기 화면의 회차 패널이 같은 설정을 씀, 소설별·기기별)
export function chapterSortDesc(id) { try { return localStorage.getItem(`ui:nvSort:${id}`) === 'desc'; } catch { return false; } }
export function setChapterSortDesc(id, desc) { try { localStorage.setItem(`ui:nvSort:${id}`, desc ? 'desc' : 'asc'); } catch {} }
