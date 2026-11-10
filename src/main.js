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

// 앱 전역 상태
const app = {
  session: null,
  me: null,            // ensure_profile() 결과: { status, is_admin, profile, sectors }
  pendingCount: 0,     // 관리자 탭 배지
  route: null,
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
    rpc('admin_stats').then((s) => { app.pendingCount = s.users_pending || 0; if (app.route) route(app.route); }).catch(() => {});
  }
  return app.me.status;
}

async function route(r) {
  app.route = r;

  // 1) 로그인 안 됨 → 로그인 화면
  if (!app.session) {
    if (r.name !== 'login') return navigate('/login', { replace: true });
    return renderLogin(freshView(renderBare()), { authError: app.authError });
  }
  if (r.name === 'login') return navigate('/', { replace: true });

  // 2) 승인 대기 / 차단 → 안내 화면
  if (!isApproved()) {
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
  const view = freshView(renderShell(app, r.name));
  switch (r.name) {
    case 'home': return renderHome(view, app);
    case 'me': return renderMe(view, app, { onNameChanged: () => renderShell(app, r.name) });
    case 'columns':
    case 'column':
      return canAccess(app.me, 'column') ? renderPlaceholder(view, r.name) : renderForbidden(view);
    case 'novels':
    case 'novel':
    case 'chapter':
      return canAccess(app.me, 'novel') ? renderPlaceholder(view, r.name) : renderForbidden(view);
    case 'admin':
      return app.me.is_admin ? renderPlaceholder(view, r.name) : renderForbidden(view);
    default:
      return renderPlaceholder(view, r.name);
  }
}

async function boot() {
  applyPrefs();

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

  startRouter(route);
}

boot();
