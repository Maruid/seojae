// 읽기 화면 조작 (칼럼·소설 공용)
//   - 읽는 위치 추적: 화면 맨 위에 걸린 문단 id + 진행률
//   - 끝까지 오면 onEnd (자동 읽음 처리)
//   - 키보드: Space/PageDown/→ 다음(끝에서 한 번 더 → onKey.endNext), Shift+Space/PageUp/← 이전, Home/End, J/K 다음·이전 글
//   - 터치 기기만: 화면 위 30% 이전 / 아래 30% 다음 / 가운데 메뉴 숨김·보임
//   - 자동 스크롤: 화면을 건드리면 멈춤
const coarse = () => matchMedia('(pointer: coarse)').matches;
const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function attachReader({
  body,                 // 문단이 들어 있는 요소
  tapArea = body,       // 탭 넘기기를 받는 영역 (본문 + 끝의 버튼 영역까지)
  anchorSelector = 'p[id], [data-anchor]',
  getView,              // () => 현재 보기 설정 (tapPaging, speed)
  topOffset = () => 0,  // 상단바 높이
  onPosition,           // (anchor, progress) — 읽는 위치가 바뀔 때 (자주 불리지 않게 묶어서)
  onEnd,                // 끝까지 읽음
  onChrome,             // (visible) 메뉴 보임/숨김
  onKey = {},           // { next, prev, back }
  onAutoChange,         // (running)
}) {
  const doc = document.scrollingElement || document.documentElement;
  const page = () => Math.max(120, window.innerHeight - topOffset() - 48);
  const maxScroll = () => Math.max(1, doc.scrollHeight - window.innerHeight);
  const progress = () => Math.min(1, window.scrollY / maxScroll());

  // ---------- 위치 추적 ----------
  let anchors = [];
  const collect = () => { anchors = [...body.querySelectorAll(anchorSelector)]; };
  collect();
  const currentAnchor = () => {
    const top = topOffset() + 8;
    // 이분 탐색: 아래끝이 top 보다 아래인 첫 문단
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
  const setChrome = (v) => { if (chrome !== v) { chrome = v; onChrome?.(v); } };

  const onScroll = () => {
    const y = window.scrollY;
    // 내려가면 메뉴 숨김, 올라가면 보임 (맨 위 근처는 항상 보임)
    if (!auto.running) {
      if (y < 80) setChrome(true);
      else if (y > lastY + 6) setChrome(false);
      else if (y < lastY - 6) setChrome(true);
    }
    lastY = y;
    clearTimeout(posTimer);
    posTimer = setTimeout(() => {
      posTimer = null;
      const p = progress();
      onPosition?.(currentAnchor(), p);
      if (!ended && lastVisible()) { ended = true; onEnd?.(); }
    }, 700);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  // 글이 화면보다 짧으면 열자마자 끝
  const checkShort = () => {
    if (!ended && lastVisible()) { ended = true; onEnd?.(); }
  };

  // ---------- 넘기기 ----------
  const atBottom = () => window.scrollY >= maxScroll() - 4;
  const go = (dir, smooth = true) => {
    stopAuto();
    // 끝에서 한 번 더 넘기면 다음 회차 (소설)
    if (dir > 0 && atBottom() && onKey.endNext) { onKey.endNext(); return; }
    window.scrollBy({ top: dir * page(), behavior: smooth ? 'smooth' : 'auto' });
  };

  const key = (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(document.activeElement)) return;
    const k = e.key;
    if (k === ' ' || k === 'Spacebar') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
    else if (k === 'PageDown' || k === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (k === 'PageUp' || k === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (k === 'Home') { e.preventDefault(); stopAuto(); window.scrollTo({ top: 0 }); }
    else if (k === 'End') { e.preventDefault(); stopAuto(); window.scrollTo({ top: maxScroll() }); }
    else if ((k === 'j' || k === 'J') && onKey.next) { e.preventDefault(); onKey.next(); }
    else if ((k === 'k' || k === 'K') && onKey.prev) { e.preventDefault(); onKey.prev(); }
    else if (k === 'Escape' && onKey.back) { onKey.back(); }
  };
  document.addEventListener('keydown', key);

  const tap = (e) => {
    if (!coarse()) return;
    if (e.target.closest('a, button, input, label, img, summary, [data-no-tap]')) return;
    if (String(window.getSelection?.() || '').length) return;
    if (auto.running) { stopAuto(); return; }
    const y = e.clientY / window.innerHeight;
    const tp = getView().tapPaging;
    if (tp && y < 0.3) go(-1, false);
    else if (tp && y > 0.7) go(1, false);
    else setChrome(!chrome);
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
    toggleAuto() { auto.running ? stopAuto() : startAuto(); },
    stopAuto,
    get autoRunning() { return auto.running; },
    restore(anchor, prog) {
      collect();
      const el = anchor && anchors.find((a) => (a.id || a.dataset.anchor) === anchor);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - topOffset() - 8 });
      else if (prog) window.scrollTo({ top: prog * maxScroll() });
      lastY = window.scrollY;
      checkShort();
    },
    setEnded(v) { ended = v; },
    destroy() {
      stopAuto();
      // 아직 저장 안 된 위치가 있으면 화면이 바뀌기 전에 저장
      if (posTimer && body.isConnected) onPosition?.(currentAnchor(), progress());
      clearTimeout(posTimer);
      posTimer = null;
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', key);
      tapArea.removeEventListener('click', tap);
    },
  };
}
