// 관리 탭 › 다운로드 한도 (migration_009)
//   - 설정: 전체 월 전송량 · 남겨 둘 양 · 초기화 일 → 나눌 양
//   - 이번 기간 요약 (앱이 센 다운로드 합계 / 나눌 양, 80% 넘으면 표시)
//   - 사용자별: 자동 / 직접 한도, 사용량, 남은 양
import { html, toast } from '../lib/dom.js';
import { rpc, errorMessage } from '../lib/supabase.js';
import { fmtBytes, MB } from '../lib/offline/plan.js';

const GB = 1024 * MB;
const MODE = { admin: ['관리자', 'is-ink'], auto: ['자동', ''], stopped: ['자동 · 쓴 만큼에서 멈춤', ''], direct: ['직접', ''], blocked: ['차단', 'is-mute'], pending: ['승인 대기', 'is-acc'] };
const kst = (iso) => new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(iso));

export function createDlAdmin(redraw) {
  let settings = null;
  let rows = null;
  let error = null;
  let missing = false;
  let busy = false;

  async function load() {
    try {
      [settings, rows] = await Promise.all([rpc('dl_admin_settings'), rpc('dl_admin_quotas')]);
      error = null; missing = false;
    } catch (err) {
      if (/PGRST202|42883|Could not find the function/i.test(`${err?.code} ${err?.message}`)) missing = true;
      else error = errorMessage(err);
    }
    redraw();
  }

  const row = (r) => {
    const [label, cls] = MODE[r.mode] || [r.mode, ''];
    const name = r.display_name || r.email || '이름 없음';
    if (r.mode === 'admin') {
      return html`<tr><td><b>${name}</b></td><td><span class="dla-st is-ink">관리자</span></td><td>—</td><td>한도 없음</td><td>${fmtBytes(r.used_bytes)}</td><td class="text-muted text-xs">세지 않음</td><td>—</td></tr>`;
    }
    if (r.mode === 'blocked' || r.mode === 'pending') {
      return html`<tr class="is-dim"><td>${name}</td><td><span class="dla-st ${cls}">${label}</span></td><td>—</td>
        <td colspan="3">${r.used_bytes ? `${fmtBytes(r.used_bytes)} 사용 · 인원에서 빠짐, 쓴 양은 나눌 양에서 계속 뺌` : r.mode === 'pending' ? '승인되면 인원에 들어가고 모두 다시 계산' : '인원에서 빠짐'}</td><td>—</td></tr>`;
    }
    const lim = r.limit_bytes || 0;
    const pct = lim ? Math.min(100, (r.used_bytes / lim) * 100) : 100;
    const left = Math.max(0, lim - r.used_bytes);
    return html`
      <tr>
        <td>${name}${r.approved_at ? html` <small class="text-muted">${kst(r.approved_at)} 승인</small>` : ''}</td>
        <td><span class="dla-st is-ok">승인</span></td>
        <td><select class="dla-sel" data-dla-mode data-id="${r.user_id}" aria-label="${name} 한도 방식">
          <option value="auto" ${r.override_bytes == null ? 'selected' : ''}>자동</option>
          <option value="direct" ${r.override_bytes != null ? 'selected' : ''}>직접</option></select></td>
        <td>${r.override_bytes != null ? html`
          <form data-dla-limit data-id="${r.user_id}" class="flex items-center gap-1">
            <input name="mb" inputmode="numeric" value="${Math.round(r.override_bytes / MB)}" aria-label="${name} 한도 MB" class="dla-in"> MB
            <button type="submit" class="dla-b">저장</button></form>`
          : html`${fmtBytes(lim)}${r.mode === 'stopped' ? html` <small class="text-muted">쓴 만큼에서 멈춤</small>` : ''}`}</td>
        <td>${fmtBytes(r.used_bytes)}</td>
        <td><span class="dl-bar is-sm"><i style="width:${pct}%" class="${pct >= 100 ? 'is-over' : ''}"></i></span></td>
        <td class="${left === 0 ? 'text-accent-ink font-bold' : ''}">${fmtBytes(left)}</td>
      </tr>`;
  };

  function render() {
    if (missing) return html`<p class="text-sm text-muted">서버에 다운로드 한도 기능이 아직 없어요. Supabase SQL Editor 에서 <code>supabase/migration_009_downloads.sql</code> 을 실행해 주세요.</p>`;
    if (!settings || !rows) return html`<p class="text-sm text-muted">${error || '불러오는 중…'}</p>`;
    const s = settings;
    const pct = s.pool ? Math.round((s.used / s.pool) * 100) : 0;
    return html`
      <div class="flex flex-wrap gap-4">
        <form class="dla-card flex-[1_1_380px]" data-dla-settings aria-labelledby="dla-s">
          <h2 id="dla-s">한도 설정</h2>
          <div class="flex flex-wrap gap-3">
            <label class="dla-fld">전체 월 전송량 (GB)<input name="total" inputmode="decimal" value="${+(s.total / GB).toFixed(2)}"></label>
            <label class="dla-fld">남겨 둘 양 (관리자·여유, GB)<input name="reserve" inputmode="decimal" value="${+(s.reserve / GB).toFixed(2)}"></label>
            <label class="dla-fld">초기화 일 (한국 시간 오전 9시)
              <select name="day">${Array.from({ length: 28 }, (_, i) => i + 1).map((d) => html`<option value="${d}" ${d === s.reset_day ? 'selected' : ''}>매달 ${d}일</option>`)}</select></label>
          </div>
          <p class="dla-note">나눌 양 <b>${fmtBytes(s.pool)}</b> · 인원 <b>${s.members}명</b> (관리자·차단·승인 대기 제외)<br>
            <span class="text-muted">직접 정한 한도와 차단·대기된 사람이 이미 쓴 양을 먼저 빼고, 이미 많이 쓴 사람은 쓴 만큼에서 멈춘 뒤 남은 양을 나머지가 똑같이 나눠요.</span></p>
          <div class="flex justify-end"><button type="submit" class="dla-b is-main" ${busy ? 'disabled' : ''}>저장</button></div>
        </form>
        <section class="dla-card flex-[1_1_300px]" aria-labelledby="dla-p">
          <h2 id="dla-p">이번 기간 (${kst(s.period_start)} ~ ${kst(s.period_end)})</h2>
          <div class="flex items-baseline gap-2"><b class="text-[28px]">${fmtBytes(s.used)}</b><span class="text-sm text-muted">/ ${fmtBytes(s.pool)} 다운로드 (${pct}%)</span></div>
          <span class="dl-bar is-lg"><i style="width:${Math.min(100, pct)}%" class="${pct >= 80 ? 'is-over' : ''}"></i></span>
          ${pct >= 80 ? html`<p class="dl-warn">나눌 양의 ${pct}%를 썼어요. Supabase 대시보드 Usage 에서 전체 전송량도 확인해 주세요.</p>` : ''}
          <p class="dla-note text-muted">앱이 센 다운로드 양이에요. 평소 읽기·로그인까지 합친 실제 전송량은 Supabase 대시보드 Usage 에서 확인하세요.</p>
        </section>
      </div>
      <section class="dla-card" aria-labelledby="dla-u">
        <h2 id="dla-u">사용자별 한도</h2>
        <div class="overflow-x-auto">
          <table class="dla-t">
            <thead><tr><th>사용자</th><th>상태</th><th>한도 방식</th><th>한도</th><th>이번 기간 사용</th><th></th><th>남음</th></tr></thead>
            <tbody>${rows.map(row)}</tbody>
          </table>
        </div>
      </section>`;
  }

  async function save(fn, msg) {
    busy = true; redraw();
    try { await fn(); if (msg) toast(msg); await load(); }
    catch (err) { toast(errorMessage(err)); }
    finally { busy = false; redraw(); }
  }

  function onSubmit(e) {
    const f = e.target;
    if (f.matches('[data-dla-settings]')) {
      e.preventDefault();
      const d = new FormData(f);
      const total = Math.round(parseFloat(d.get('total')) * GB);
      const reserve = Math.round(parseFloat(d.get('reserve')) * GB);
      const day = parseInt(d.get('day'), 10);
      if (!(total >= 0) || !(reserve >= 0) || reserve > total) { toast('남겨 둘 양은 전체보다 작아야 해요.'); return; }
      save(() => rpc('dl_admin_set_settings', { p_total: total, p_reserve: reserve, p_reset_day: day }), '한도 설정을 저장했어요.');
    } else if (f.matches('[data-dla-limit]')) {
      e.preventDefault();
      const mb = parseFloat(new FormData(f).get('mb'));
      if (!(mb >= 0)) { toast('숫자로 넣어 주세요.'); return; }
      save(() => rpc('dl_admin_set_override', { p_user: f.dataset.id, p_bytes: Math.round(mb * MB) }), '한도를 저장했어요.');
    }
  }
  function onChange(e) {
    const t = e.target;
    if (!t.matches('[data-dla-mode]')) return;
    const r = rows.find((x) => x.user_id === t.dataset.id);
    if (t.value === 'auto') save(() => rpc('dl_admin_set_override', { p_user: r.user_id, p_bytes: null }), '자동 한도로 바꿨어요.');
    else save(() => rpc('dl_admin_set_override', { p_user: r.user_id, p_bytes: r.limit_bytes || 0 }), '직접 한도로 바꿨어요. 숫자를 고쳐 저장하세요.');
  }

  return { load, render, onSubmit, onChange, get loaded() { return !!settings || missing; } };
}
