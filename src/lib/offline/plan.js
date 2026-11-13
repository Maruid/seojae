// 다운로드 계획 (순수 함수 — 테스트에서 바로 씀)
//   - 회차 고르기 추천(전체 / 안 읽은 회차부터 / 다음 N화), 다 읽은 회차 빼기
//   - 용량 맞추기(전부 들어가는 것만 / ★ + 이어 읽는 회차부터 / 골고루)
//   - 서버와 받은 것 비교(새 회차 · 바뀐 회차 · 사라진 회차 · 다시 나뉨)

export const MB = 1048576;

export function fmtBytes(b) {
  const n = Math.max(0, Number(b) || 0);
  if (n >= 1024 * MB) return `${(n / 1024 / MB).toFixed(n >= 10 * 1024 * MB ? 0 : 1)}GB`;
  if (n >= MB) return `${(n / MB).toFixed(n >= 100 * MB ? 0 : 1)}MB`;
  if (n === 0) return '0KB';
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

// 회차 크기: 업로더가 기록한 size_bytes, 없으면 글자 수 × 3 (한글 UTF-8) 으로 어림
export function chapterBytes(ch) {
  if (Number.isFinite(ch?.size_bytes) && ch.size_bytes >= 0) return { bytes: ch.size_bytes, exact: true };
  if (Number.isFinite(ch?.char_count)) return { bytes: Math.round(ch.char_count * 3) + 200, exact: false };
  return { bytes: 16000, exact: false };
}
export function columnBytes(col, textOnly = false) {
  const md = Number.isFinite(col?.size_bytes) ? col.size_bytes : 12000;
  if (textOnly) return { bytes: md, exact: Number.isFinite(col?.size_bytes) };
  const img = Number.isFinite(col?.image_bytes) ? col.image_bytes : null;
  return { bytes: md + (img ?? 0), exact: img != null && Number.isFinite(col?.size_bytes), images: col?.image_count ?? null };
}

/**
 * 소설 하나의 추천 선택
 *   chapters: 서버 회차 목록(seq 순), start: 이어 읽을 회차 위치(index)
 *   have: 이미 받은 key Set, changed: 바뀐 key Set, read: 다 읽은 key Set
 *   mode: 'all' | 'unread' | 'next'(start 부터 n 화)
 *   받은 회차는 빼고(바뀐 건 넣음), skipRead 면 다 읽은 회차도 뺌
 */
export function presetKeys({ chapters, start = 0, have = new Set(), changed = new Set(), read = new Set(), mode = 'unread', n = 50, skipRead = true }) {
  const out = new Set();
  chapters.forEach((c, i) => {
    if (changed.has(c.key)) { out.add(c.key); return; }
    if (have.has(c.key)) return;
    if (skipRead && read.has(c.key)) return;
    if (mode === 'all') out.add(c.key);
    else if (mode === 'unread' && i >= start) out.add(c.key);
    else if (mode === 'next' && i >= start && i < start + n) out.add(c.key);
  });
  return out;
}

/**
 * 용량 맞추기
 *   groups: [{ id, star, items: [{ key, bytes, zero }] }]  items 는 받을 순서(읽던 회차부터)
 *   sel: Map(groupId → Set(key))  지금 고른 것
 *   room: 남은 한도(바이트)
 *   how: 'whole' 전부 들어가는 묶음만 | 'star' ★ 묶음 먼저, 그다음 이어 읽는 순서대로 | 'even' 묶음마다 골고루
 *   기기에 이미 있는 것(zero)은 한도를 안 쓰므로 늘 넣음
 */
export function fitSelection(groups, sel, room, how) {
  const picked = new Map(groups.map((g) => [g.id, new Set()]));
  const chosen = (g) => g.items.filter((it) => sel.get(g.id)?.has(it.key));
  let left = room;
  for (const g of groups) for (const it of chosen(g)) if (it.zero) picked.get(g.id).add(it.key);

  if (how === 'whole') {
    for (const g of groups) {
      const items = chosen(g).filter((it) => !it.zero);
      const sum = items.reduce((s, it) => s + it.bytes, 0);
      if (sum <= left) { items.forEach((it) => picked.get(g.id).add(it.key)); left -= sum; }
    }
    return picked;
  }
  if (how === 'star') {
    const order = [...groups.filter((g) => g.star), ...groups.filter((g) => !g.star)];
    for (const g of order) {
      for (const it of chosen(g)) {
        if (it.zero) continue;
        if (it.bytes > left) break;   // 이어 읽는 순서가 끊기지 않게 거기서 멈춤
        picked.get(g.id).add(it.key); left -= it.bytes;
      }
    }
    return picked;
  }
  // even: 묶음을 돌아가며 한 개씩
  const queues = groups.map((g) => ({ g, q: chosen(g).filter((it) => !it.zero) }));
  let moved = true;
  while (moved) {
    moved = false;
    for (const x of queues) {
      const it = x.q[0];
      if (!it) continue;
      if (it.bytes > left) { x.q.length = 0; continue; }
      picked.get(x.g.id).add(it.key); left -= it.bytes; x.q.shift(); moved = true;
    }
  }
  return picked;
}

/**
 * 서버 회차 목록과 받은 회차 비교
 *   saved: Map(key → { hash })  받은 회차, known: 지난번 확인 때 서버에 있던 key Set
 *   fresh: 새로 생긴 회차(받지 않은 것), changed: 해시가 달라진 받은 회차, gone: 서버에서 사라진 받은 회차
 *   resplit: 받은 회차의 절반 이상이 바뀌거나 사라짐 (업로드 구조가 바뀌어 다시 나뉜 경우)
 */
export function diffChapters(server, saved, known = null) {
  const byKey = new Map(server.map((c) => [c.key, c]));
  const fresh = []; const changed = []; const gone = [];
  for (const c of server) {
    if (saved.has(c.key)) {
      const h = saved.get(c.key).hash;
      if (c.content_hash && h && c.content_hash !== h) changed.push(c.key);
    } else if (known && !known.has(c.key)) fresh.push(c.key);
  }
  for (const k of saved.keys()) if (!byKey.has(k)) gone.push(k);
  const n = saved.size;
  const resplit = n >= 5 && (changed.length + gone.length) / n >= 0.5;
  return { fresh, changed, gone, resplit };
}

// 다시 나뉜 소설: 예전에 받은 범위를 새 목록에서 비슷한 비율로
export function resplitRange({ oldTotal, oldIdx }, server) {
  if (!oldIdx.length || !oldTotal || !server.length) return [];
  const lo = Math.min(...oldIdx) / oldTotal;
  const hi = (Math.max(...oldIdx) + 1) / oldTotal;
  const a = Math.floor(lo * server.length);
  const b = Math.max(a + 1, Math.ceil(hi * server.length));
  return server.slice(a, b).map((c) => c.key);
}

// 내 한도 → 남은 바이트 (무제한이면 Infinity)
export const roomOf = (q) => (!q ? 0 : q.unlimited ? Infinity : Math.max(0, (q.limit ?? 0) - (q.used ?? 0)));
export const usedRatio = (q) => (!q || q.unlimited || !q.limit ? 0 : q.used / q.limit);

// 30일 잠금
export const LOCK_MS = 30 * 24 * 3600 * 1000;
export const isLockedAt = (lastOnline, now = Date.now()) => !!lastOnline && now - lastOnline > LOCK_MS;
