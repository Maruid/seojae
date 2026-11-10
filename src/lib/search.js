// 글 안에서 찾기 (지금 보는 글 하나)
//   본문 텍스트 노드에서 찾아 <mark> 로 감싸고, 닫으면 원래대로 되돌림
//   (문단 id·줄 번호 같은 위치 기준은 건드리지 않음)
export function createSearch(body) {
  let marks = [];
  let cur = -1;

  function clear() {
    for (const m of marks) {
      const p = m.parentNode;
      if (!p) continue;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    }
    marks = [];
    cur = -1;
  }

  function run(query) {
    clear();
    const q = String(query || '').trim().toLowerCase();
    if (!q) return 0;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.toLowerCase().includes(q) && !n.parentElement.closest('script,style,mark')
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      let n = node;
      let i;
      while (n && (i = n.nodeValue.toLowerCase().indexOf(q)) >= 0) {
        const hit = n.splitText(i);
        n = hit.splitText(q.length);
        const m = document.createElement('mark');
        m.className = 'r-hit';
        hit.parentNode.replaceChild(m, hit);
        m.appendChild(hit);
        marks.push(m);
        if (marks.length >= 999) return marks.length;
      }
    }
    return marks.length;
  }

  // i 번째 결과로 (위·아래 바를 피해 화면 1/3 지점에)
  function go(i, topEdge = 0) {
    if (!marks.length) return -1;
    cur = ((i % marks.length) + marks.length) % marks.length;
    marks.forEach((m, k) => m.classList.toggle('is-cur', k === cur));
    const r = marks[cur].getBoundingClientRect();
    const target = window.scrollY + r.top - Math.max(topEdge + 24, window.innerHeight / 3);
    window.scrollTo({ top: Math.max(0, target) });
    return cur;
  }

  return {
    run, go, clear,
    next(topEdge) { return go(cur + 1, topEdge); },
    prev(topEdge) { return go(cur - 1, topEdge); },
    get count() { return marks.length; },
    get index() { return cur; },
  };
}
