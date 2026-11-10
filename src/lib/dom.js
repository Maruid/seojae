// html`` 템플릿: 넣는 값은 기본으로 escape. 미리 만든 조각(html``의 결과)은 그대로 들어감.
// innerHTML 에 사용자 데이터가 섞여 들어가는 걸 막는 유일한 통로로 씁니다.

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}

function part(v) {
  if (v == null || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return escapeHtml(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Safe(out);
}

// 이미 정제된 HTML (DOMPurify 결과 등) 을 그대로 넣을 때만
export const trusted = (s) => new Safe(String(s));

// 다시 그려도 data-keep-scroll="이름" 인 요소의 스크롤 위치를 유지 (가로로 넘기는 칩 줄 등).
// 고른 칩(aria-pressed=true)이 화면 밖이면 보이는 곳까지만 살짝 옮김
export function mount(el, safe) {
  const keep = {};
  el.querySelectorAll?.('[data-keep-scroll]').forEach((n) => { keep[n.dataset.keepScroll] = [n.scrollLeft, n.scrollTop]; });
  el.innerHTML = part(safe);
  for (const [k, [x, y]] of Object.entries(keep)) {
    const n = el.querySelector(`[data-keep-scroll="${k}"]`);
    if (!n) continue;
    n.scrollLeft = x;
    n.scrollTop = y;
    const on = n.querySelector('[aria-pressed="true"]');
    if (on && n.scrollWidth > n.clientWidth) {
      const a = on.offsetLeft - n.scrollLeft;
      if (a < 0) n.scrollLeft = on.offsetLeft - 16;
      else if (a + on.offsetWidth > n.clientWidth) n.scrollLeft = on.offsetLeft + on.offsetWidth - n.clientWidth + 16;
    }
  }
}

// data-action 이벤트 위임. 반환값으로 해제
export function onAction(root, handlers, type = 'click') {
  const fn = (e) => {
    const t = e.target.closest('[data-action]');
    if (!t || !root.contains(t)) return;
    const h = handlers[t.dataset.action];
    if (!h) return;
    if (type === 'click' && t.tagName !== 'INPUT') e.preventDefault();
    h(t, e);
  };
  root.addEventListener(type, fn);
  return () => root.removeEventListener(type, fn);
}

export function toast(msg, ms = 2600) {
  const box = document.getElementById('toast');
  if (!box) return;
  const el = document.createElement('div');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
