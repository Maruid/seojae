// 읽기 화면 조작 (칼럼·소설 공용)
//   - 읽는 위치 추적: 화면 맨 위에 걸린 문단 id(칼럼) / 줄 번호(소설) + 진행률
//   - 끝까지 오면 onEnd (자동 읽음 처리)
//   - 넘기기: 미끄러지지 않고 바로 이동. 줄 단위로 맞춰서 이전 화면의 마지막 줄이 새 화면 맨 위에 한 줄만 겹침
//       키보드: Space/PageDown/→ 다음(끝에서 한 번 더 → onKey.endNext), Shift+Space/PageUp/← 이전,
//               Home/End, J/K 다음·이전 글, / 검색
//   - 터치: 화면 위 30% 이전 / 아래 30% 다음 / 가운데 위·아래 바 보임·숨김
//     마우스: 본문 가운데를 클릭하면 바 보임·숨김 (바 고정이 꺼져 있을 때)
//   - 바 고정(isPinned)이 켜져 있으면 스크롤해도 바가 숨지 않음
//   - 자동 스크롤: 화면을 건드리면 멈춤
const coarse = () => matchMedia('(pointer: coarse)').matches;
const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// (x, y) 지점에 있는 글자 한 줄의 화면 위치
function lineRectAt(root, x, y) {
  let node = null; let off = 0;
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; off = r.startOffset; }
  } else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { node = p.offsetNode; off = p.offset; }
  }
  if (!node || node.nodeType !== 3 || !root.contains(node) || !node.length) return null;
  const i = Math.min(off, node.length - 1);
  const range = document.createRange();
  range.setStart(node, i);
  range.setEnd(node, i + 1);
  const rect = range.getClientRects()[0] || range.getBoundingClientRect();
  return rect && rect.height ? rect : null;
}

export function attachReader({
  body,                 // 문단이 들어 있는 요소
  tapArea = body,       // 탭 넘기기를 받는 영역 (본문 + 끝의 버튼 영역까지)
  anchorSelector = 'p[id], [data-anchor]',
  getView,              // () => 현재 보기 설정 (tapPaging, speed)
  edges = () => ({ top: 0, bottom: window.innerHeight }),   // 바를 뺀 실제 읽는 영역
  isPinned = () => false,
  onPosition,           // (anchor, progress) — 읽는 위치가 바뀔 때 (자주 불리지 않게 묶어서)
  onScrollNow,          // (progress) — 스크롤할 때마다 (진행 막대용)
  onEnd,                // 끝까지 읽음
  onChrome,             // (visible) 위·아래 바 보임/숨김
  onKey = {},           // { next, prev, back, endNext, search }
  onAutoChange,         // (running)
}) {
  const doc = document.scrollingElement || document.documentElement;
  const maxScroll = () => Math.max(1, doc.scrollHeight - window.innerHeight);
  const progress = () => Math.min(1, Math.max(0, window.scrollY / maxScroll()));
  const lineHeight = () => parseFloat(getComputedStyle(body).lineHeight) || 28;

  // ---------- 위치 추적 ----------
  let anchors = [];
  const collect = () => { anchors = [...body.querySelectorAll(anchorSelector)]; };
  collect();
  const currentAnchor = () => {
    const top = edges().top + 8;
    let lo = 0; let hi = anchors.length - 1; let ans = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = anchors[mid].getBoundingClientRect();
      if (r.bottom > top) { ans = anchors[mid]; hi = mid - 1; } else lo = mid + 1;
    }
    return ans ? (ans.id || ans.dataset.anchor) : null;
  };

  // 마지막 문단이 화면에 들어왔나 (이후의 버튼·다음 글 영역은 제외)
  const lastVisible = () => {
    const last = anchors[anchors.length - 1];
    if (!last) return progress() > 0.985;
    return last.getBoundingClientRect().bottom <= window.innerHeight - 8;
  };

  let posTimer = null;
  let ended = false;
  let lastY = window.scrollY;
  let chrome = true;
  const setChrome = (v) => {
    if (!v && isPinned()) v = true;
    if (chrome !== v) { chrome = v; onChrome?.(v); }
  };

  const onScroll = () => {
    const y = window.scrollY;
    // 내려가면 바 숨김, 올라가면 보임 (맨 위 근처는 항상 보임). 고정이면 그대로
    if (!auto.running && !isPinned()) {
      if (y < 40) setChrome(true);
      else if (y > lastY + 6) setChrome(false);
      else if (y < lastY - 6 && !paging) setChrome(true);
    }
    lastY = y;
    onScrollNow?.(progress());
    clearTimeout(posTimer);
    posTimer = setTimeout(() => {
      posTimer = null;
      onPosition?.(currentAnchor(), progress());
      if (!ended && lastVisible()) { ended = true; onEnd?.(); }
    }, 700);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  const checkShort = () => {
    if (!ended && lastVisible()) { ended = true; onEnd?.(); }
  };

  // ---------- 넘기기 (즉시, 줄 단위) ----------
  let paging = false;
  const atBottom = () => window.scrollY >= maxScroll() - 4;
  const atTop = () => window.scrollY <= 1;
  const jump = (y) => {
    paging = true;
    window.scrollTo({ top: Math.max(0, Math.min(maxScroll(), y)), behavior: 'instant' });
    setTimeout(() => { paging = false; }, 80);
  };

  function go(dir) {
    stopAuto();
    // 본문 끝까지 다 보이는 상태에서 한 번 더 넘기면 다음 회차 (소설)
    const textDone = body.getBoundingClientRect().bottom <= edges().bottom + 1;
    if (dir > 0 && onKey.endNext && (atBottom() || textDone)) { onKey.endNext(); return; }
    if (dir > 0 && atBottom()) return;
    if (dir < 0 && atTop()) return;
    const { top, bottom } = edges();
    const lh = lineHeight();
    const x = body.getBoundingClientRect().left + 6;
    const fallback = Math.max(120, bottom - top - lh);
    if (dir > 0) {
      // 아래 끝에 걸린(또는 마지막으로 보이는) 줄 → 새 화면 맨 위로
      let rect = null;
      for (let dy = 2; dy < lh * 2 && !rect; dy += lh / 4) {
        const r = lineRectAt(body, x, bottom - dy);
        if (r && r.top < bottom - 2 && r.bottom > top) rect = r;   // 실제로 화면에 걸친 줄만
      }
      const delta = rect ? rect.top - top : fallback;
      jump(window.scrollY + (delta >= lh && delta <= bottom - top ? delta : fallback));
    } else {
      // 위 끝에 걸린(또는 첫 번째로 보이는) 줄 → 새 화면 맨 아래로
      let rect = null;
      for (let dy = 2; dy < lh * 2 && !rect; dy += lh / 4) {
        const r = lineRectAt(body, x, top + dy);
        if (r && r.bottom > top + 2 && r.top < bottom) rect = r;
      }
      const delta = rect ? bottom - rect.bottom : fallback;
      jump(window.scrollY - (delta >= lh && delta <= bottom - top ? delta : fallback));
    }
  }

  const key = (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(document.activeElement)) return;
    const k = e.key;
    if (k === ' ' || k === 'Spacebar') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
    else if (k === 'PageDown' || k === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (k === 'PageUp' || k === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (k === 'Home') { e.preventDefault(); stopAuto(); jump(0); }
    else if (k === 'End') { e.preventDefault(); stopAuto(); jump(maxScroll()); }
    else if ((k === 'j' || k === 'J') && onKey.next) { e.preventDefault(); onKey.next(); }
    else if ((k === 'k' || k === 'K') && onKey.prev) { e.preventDefault(); onKey.prev(); }
    else if (k === '/' && onKey.search) { e.preventDefault(); onKey.search(); }
    else if (k === 'Escape' && onKey.back) { onKey.back(); }
  };
  document.addEventListener('keydown', key);

  const tap = (e) => {
    if (e.target.closest('a, button, input, label, img, summary, mark, form, .reader-bar, .reader-foot, .rd-pop-wrap, [data-no-tap]')) return;
    if (String(window.getSelection?.() || '').length) return;
    if (auto.running) { stopAuto(); return; }
    const y = e.clientY / window.innerHeight;
    if (coarse()) {
      const tp = getView().tapPaging;
      if (tp && y < 0.3) go(-1);
      else if (tp && y > 0.7) go(1);
      else if (!isPinned()) setChrome(!chrome);
    } else if (!isPinned() && y > 0.25 && y < 0.75) {
      setChrome(!chrome);
    }
  };
  tapArea.addEventListener('click', tap);

  // ---------- 자동 스크롤 ----------
  const auto = { running: false, raf: 0, last: 0, acc: 0 };
  const frame = (t) => {
    if (!auto.running) return;
    const dt = auto.last ? Math.min(100, t - auto.last) : 16;
    auto.last = t;
    auto.acc += (getView().speed * 12 * dt) / 1000;   // 속도 1 = 12px/초
    if (auto.acc >= 1) {
      const n = Math.floor(auto.acc);
      auto.acc -= n;
      window.scrollBy(0, n);
      if (window.scrollY >= maxScroll() - 1) { stopAuto(); return; }
    }
    auto.raf = requestAnimationFrame(frame);
  };
  function startAuto() {
    if (auto.running) return;
    auto.running = true; auto.last = 0; auto.acc = 0;
    setChrome(false);
    auto.raf = requestAnimationFrame(frame);
    onAutoChange?.(true);
    setTimeout(() => window.addEventListener('wheel', stopAuto, { passive: true, once: true }), 0);
    setTimeout(() => window.addEventListener('touchstart', stopAuto, { passive: true, once: true }), 0);
  }
  function stopAuto() {
    if (!auto.running) return;
    auto.running = false;
    cancelAnimationFrame(auto.raf);
    window.removeEventListener('wheel', stopAuto);
    window.removeEventListener('touchstart', stopAuto);
    setChrome(true);
    onAutoChange?.(false);
  }

  return {
    refresh() { collect(); checkShort(); },
    progress,
    go,
    seek(p) { stopAuto(); jump(p * maxScroll()); },
    setChrome,
    get chromeVisible() { return chrome; },
    toggleAuto() { auto.running ? stopAuto() : startAuto(); },
    stopAuto,
    get autoRunning() { return auto.running; },
    restore(anchor, prog) {
      collect();
      const el = anchor && anchors.find((a) => (a.id || a.dataset.anchor) === anchor);
      if (el) jump(el.getBoundingClientRect().top + window.scrollY - edges().top - 8);
      else if (prog) jump(prog * maxScroll());
      lastY = window.scrollY;
      checkShort();
    },
    setEnded(v) { ended = v; },
    destroy() {
      stopAuto();
      if (posTimer && body.isConnected) onPosition?.(currentAnchor(), progress());
      clearTimeout(posTimer);
      posTimer = null;
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', key);
      tapArea.removeEventListener('click', tap);
    },
  };
}
