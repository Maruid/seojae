// 소설 회차 본문(.txt) → 문단 목록 (순수 함수: 브라우저·테스트 공용)
//   - 읽던 위치는 "원본 줄 번호"로 기억 → 보기 설정·화면 폭이 바뀌어도 같은 곳
//   - 문단마다 빈 줄을 넣어 쓴 소설(빈 줄 비율 30% 이상)은 빈 줄 1개를 없애고 문단 간격 설정으로 대신,
//     빈 줄 2개 이상(장면 전환)은 빈 칸 하나로
//   - 빈 줄 없이 쓴 소설은 빈 줄을 그대로 빈 칸으로
export function splitParagraphs(text) {
  const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start++;

  const body = lines.slice(start);
  const blanks = body.filter((l) => !l.trim()).length;
  const airy = body.length > 4 && blanks / body.length >= 0.3;

  const out = [];   // { line, text } | { line, gap: true }
  let run = 0;
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].replace(/\s+$/, '');
    if (!t.trim()) { run++; continue; }
    if (run && out.length) {
      if (!airy || run >= 2) out.push({ line: i, gap: true });
      if (!airy && run >= 2) for (let k = 1; k < run; k++) out.push({ line: i, gap: true });
    }
    run = 0;
    out.push({ line: i + 1, text: t });
  }
  return out;
}

// 회차 키 정렬·표시용
export const chapterLabel = (c) => c.display_title || c.title || c.key;

/**
 * 회차 번호
 *   - 프롤로그(intro) → null
 *   - 제목에 번호가 있던 소설(키 n0012) → 그 번호 (빠진 회차가 있어도 실제 번호)
 *   - 번호 소설 끝의 번호 없는 회차(키 x0001: 후기·외전 등) → null
 *   - 번호가 없는 소설(키 s/p) → 등장 순서 (seq 는 프롤로그를 뺀 1부터)
 */
export function chapterNo(c) {
  if (!c || c.key === 'intro') return null;
  const m = /^n(\d+)$/.exec(c.key || '');
  if (m) return +m[1];
  if (/^x\d+$/.test(c.key || '')) return null;
  return Number.isFinite(c.seq) && c.seq > 0 ? c.seq : null;
}

// 번호 칸과 함께 보여 줄 제목: 제목 앞의 "12화."·"제12화 -"·"12편 ·" 는 번호 칸과 겹치니 뗌
export function chapterRest(c) {
  const label = chapterLabel(c);
  const no = chapterNo(c);
  if (no == null) return label;
  const re = new RegExp(`^\\s*(?:제\\s*)?0*${no}\\s*(?:화|편)\\s*[.:·\\-~)\\]]*\\s*`);
  return label.replace(re, '').trim();
}

// 위 바·정보 팝업용 "12화" / "프롤로그" / (번호 없음) 제목
export const chapterNoLabel = (c) => (c?.key === 'intro' ? '프롤로그' : chapterNo(c) != null ? `${chapterNo(c).toLocaleString()}화` : '');

// 한 줄로: "12화 · 돌아왔다(12)" / "12화" / "프롤로그" / "후기"
export function chapterTitleLine(c) {
  const n = chapterNoLabel(c);
  const rest = c?.key === 'intro' ? '' : chapterRest(c);
  return n && rest ? `${n} · ${rest}` : n || rest || chapterLabel(c);
}

// 프롤로그를 뺀 회차 수
export const chapterTotal = (chapters) => (chapters || []).filter((c) => c.key !== 'intro').length;

// 회차 번호로 찾기: 정확히 있으면 그 회차, 없으면 가장 가까운 번호 (같으면 앞 번호)
export function findChapterByNo(chapters, n) {
  let exact = null; let near = null; let best = Infinity;
  for (const c of chapters || []) {
    const no = chapterNo(c);
    if (no == null) continue;
    if (no === n) { exact = c; break; }
    const d = Math.abs(no - n);
    if (d < best) { best = d; near = c; }
  }
  return { exact, near: exact ? null : near };
}

// 마지막으로 읽던 회차 → 이어 읽을 회차 (다 읽었으면 그다음 회차)
export function continueTarget(chapters, readingByKey) {
  let best = null;
  for (const [key, r] of Object.entries(readingByKey)) {
    if (!best || String(r.updated_at) > String(best.r.updated_at)) best = { key, r };
  }
  if (!best) return chapters.length ? { chapter: chapters[0], fresh: true } : null;
  const i = chapters.findIndex((c) => c.key === best.key);
  if (i < 0) return chapters.length ? { chapter: chapters[0], fresh: true } : null;
  if (best.r.finished_at && i < chapters.length - 1) return { chapter: chapters[i + 1], fresh: true };
  return { chapter: chapters[i], fresh: false, row: best.r };
}

// 그 소설을 마지막으로 연 시각 (회차 기록 중 가장 최근)
export function lastOpened(readingByKey) {
  let t = null;
  for (const r of Object.values(readingByKey)) if (!t || String(r.updated_at) > t) t = String(r.updated_at);
  return t;
}

// 태그 정리: '#'·앞뒤 공백 제거, 안쪽 공백 하나로 (서버 admin_update_novel 과 같은 규칙)
export const normalizeTag = (s) => String(s || '').trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ');

/**
 * 소설 목록 거르기: 대표 장르 하나 + 태그 여러 개(모두 포함)
 * 반환: { list, genres: [{name,count}], tags: [{name,count}] }  (개수는 지금 조건 기준)
 */
export function filterNovels(novels, { genre = '', tags = [] } = {}) {
  const inGenre = genre ? novels.filter((n) => n.genre === genre) : novels;
  const list = inGenre.filter((n) => tags.every((t) => (n.tags || []).includes(t)));
  const gc = new Map();
  for (const n of novels) if (n.genre) gc.set(n.genre, (gc.get(n.genre) || 0) + 1);
  const tc = new Map();
  for (const n of list) for (const t of n.tags || []) tc.set(t, (tc.get(t) || 0) + 1);
  for (const t of tags) if (!tc.has(t)) tc.set(t, 0);
  const sort = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).map(([name, count]) => ({ name, count }));
  return { list, genres: sort(gc), tags: sort(tc) };
}
