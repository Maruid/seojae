import { supabase, errorMessage, rpc } from './lib/supabase.js';
import { getSession, loadMe, cleanAuthUrl, readAuthError } from './lib/auth.js';
import { applyPrefs } from './lib/prefs.js';
import { startRouter, navigate } from './router.js';
import { toast } from './lib/dom.js';
import { canAccess } from './lib/nav.js';
import { renderShell, renderBare } from './components/layout.js';
import { renderLogin } from './views/login.js';
import { renderPending } from './views/pending.js';
import { renderHome } from './views/home.js';
import { renderMe } from './views/me.js';
import { renderPlaceholder, renderForbidden } from './views/placeholder.js';
import { renderColumns } from './views/columns.js';
import { renderColumn } from './views/column.js';
import { renderNovels, renderNovel } from './views/novels.js';
import { renderChapter } from './views/chapter.js';
import { startReadingSync } from './lib/progress.js';
import { renderAdmin } from './views/admin.js';
import { renderInstall } from './views/install.js';
import { initPwa } from './lib/pwa.js';
import { exitFullscreen } from './lib/fullscreen.js';

// 앱 전역 상태
const app = {
  session: null,
  me: null,            // ensure_profile() 결과: { status, is_admin, profile, sectors }
  pendingCount: 0,     // 관리자 탭 배지
  route: null,
  cleanup: null,       // 이전 화면 정리 (읽던 위치 저장 등) — 화면을 바꾸기 전에 호출
};

// 화면마다 새 요소를 만들어서 이전 화면의 이벤트 리스너가 남지 않게
function freshView(container) {
  const view = document.createElement('div');
  container.replaceChildren(view);
  window.scrollTo(0, 0);
  return view;
}

const isApproved = () => app.me && (app.me.status === 'approved' || app.me.is_admin);

async function refreshMe() {
  app.me = await loadMe();
  if (app.me.is_admin) {
    rpc('admin_stats').then((s) => { app.pendingCount = s.users_pending || 0; app.redrawShell?.(); }).catch(() => {});
  }
  return app.me.status;
}

async function route(r) {
  if (app.cleanup) { const c = app.cleanup; app.cleanup = null; try { c(); } catch {} }
  app.route = r;

  // 1) 로그인 안 됨 → 로그인 화면
  if (!app.session) {
    if (r.name !== 'login') return navigate('/login', { replace: true });
    app.redrawShell = null;
    return renderLogin(freshView(renderBare()), { authError: app.authError });
  }
  if (r.name === 'login') return navigate('/', { replace: true });

  // 2) 승인 대기 / 차단 → 안내 화면
  if (!isApproved()) {
    app.redrawShell = null;
    return renderPending(freshView(renderBare()), app, {
      onRefresh: async () => {
        try {
          const status = await refreshMe();
          if (isApproved()) route(app.route);
          return status;
        } catch (err) { toast(errorMessage(err)); return null; }
      },
    });
  }

  // 3) 앱 화면
  const reading = r.name === 'column' || r.name === 'chapter';
  // 전체 화면은 글·회차를 넘길 때만 유지하고, 목록·홈으로 나가면 풂
  if (!reading) exitFullscreen();
  const wide = matchMedia('(min-width: 1024px)').matches;
  const shellOpts = { immersive: reading, compact: ['columns', 'column', 'chapter'].includes(r.name) && wide };
  app.redrawShell = () => renderShell(app, r.name, shellOpts);
  const view = freshView(renderShell(app, r.name, shellOpts));
  switch (r.name) {
    case 'home': return renderHome(view, app);
    case 'me': return renderMe(view, app, { onNameChanged: () => renderShell(app, r.name) });
    case 'columns':
      if (!canAccess(app.me, 'column')) return renderForbidden(view);
      app.cleanup = renderColumns(view, app);
      return;
    case 'column':
      if (!canAccess(app.me, 'column')) return renderForbidden(view);
      app.cleanup = renderColumn(view, app, r.params.id);
      return;
    case 'novels':
    case 'novel':
    case 'chapter':
      if (!canAccess(app.me, 'novel')) return renderForbidden(view);
      if (r.name === 'novels') return renderNovels(view);
      if (r.name === 'novel') return renderNovel(view, r.params.id);
      app.cleanup = renderChapter(view, r.params.id, r.params.key);
      return;
    case 'admin':
      if (!app.me.is_admin) return renderForbidden(view);
      app.cleanup = renderAdmin(view, app, {
        onPendingChange: (n) => { if (app.pendingCount !== n) { app.pendingCount = n; app.redrawShell?.(); } },
      });
      return;
    case 'install':
      app.cleanup = renderInstall(view);
      return;
    default:
      return renderPlaceholder(view, r.name);
  }
}

async function boot() {
  applyPrefs();
  document.documentElement.style.background = '';   // 첫 화면 깜빡임 방지용 임시 배경 → 이제 CSS 가 맡음
  initPwa();
  // 뒤로 가기 때 브라우저가 스크롤을 멋대로 옮기면 읽던 위치가 잘못 저장됨 → 직접 관리
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  // OAuth 복귀: getSession() 이 ?code= 교환을 끝낼 때까지 기다린 뒤 주소 정리
  app.authError = readAuthError();
  app.session = await getSession();
  cleanAuthUrl();

  if (app.session) {
    try { await refreshMe(); }
    catch (err) {
      // 세션은 있는데 프로필 확인 실패 (오프라인 + 기록 없음 등)
      toast(errorMessage(err));
      app.me = { status: 'pending', profile: { email: app.session.user.email } };
    }
  }

  // 다른 탭에서 로그아웃하거나 세션이 만료되면 로그인 화면으로
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { app.session = null; app.me = null; navigate('/login', { replace: true }); }
    else if (session) app.session = session;
  });

  if (app.session) startReadingSync();

  // 창 폭이 PC/모바일 경계를 넘으면 화면 구성을 다시 (칼럼 2단 ↔ 1단)
  matchMedia('(min-width: 1024px)').addEventListener('change', () => {
    if (app.route && ['columns', 'column', 'chapter'].includes(app.route.name)) route(app.route);
  });

  startRouter(route);
}

boot();
