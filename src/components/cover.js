// 소설 표지: 올린 이미지가 있으면 그것, 없으면 제목으로 색을 정한 기본 표지
import { html } from '../lib/dom.js';
import { coverUrl, coverHue } from '../lib/covers.js';

export function coverBox(n, { cls = '', ph = true } = {}) {
  const url = coverUrl(n.cover_path);
  return html`
    <span class="nv-cover ${cls}" style="--h:${coverHue(n.title)}">
      ${ph ? html`<span class="nv-cover-ph" aria-hidden="true"><b>${n.title}</b>${n.author ? html`<small>${n.author}</small>` : ''}</span>` : ''}
      ${url ? html`<img src="${url}" alt="" loading="lazy" decoding="async">` : ''}
    </span>`;
}
