# 서재 (seojae)

구독 칼럼과 소설을 읽던 자리부터 이어 읽는 개인 서재.
GitHub Pages(정적 호스팅) + Supabase(DB, Google 로그인, Storage) 무료 구성.

> 구조·규칙·결정 사항은 `docs/PROJECT_GUIDE.md` (작업 전 먼저 읽기)

## 구조

```
src/
  main.js              부팅, OAuth 복귀 처리, 라우팅 + 접근 제어(로그인 → 승인 → 섹터 권한)
  router.js            해시 라우터 (#/c/:id, #/n/:id/:key ...)
  config.js            공개 설정값 (Supabase URL / publishable key)
  lib/
    supabase.js        클라이언트(PKCE), rpc(), 에러 문구
    auth.js            Google 로그인, ensure_profile, 로그아웃 시 기기 데이터 정리
    nav.js             권한별 탭 구성 (순수 함수, 테스트 있음)
    prefs.js           앱 화면 설정 (화면 모드, 앱 글꼴, 앱 글자 크기)
    fonts.js           글꼴 목록, 필요할 때만 불러오기
    dom.js             html`` 자동 escape 템플릿, data-action 이벤트 위임, toast
  components/          layout(하단 탭바 ↔ PC 사이드바), icons
  views/               login, pending, home, me, placeholder
  styles/app.css       디자인 토큰 + Tailwind v4
supabase/
  schema.sql           테이블, RLS, RPC, Storage 정책 (최초 1회)
  migration_00N_*.sql  이후 변경 (번호 순서대로)
.github/workflows/
  deploy.yml           main push → 테스트 → 빌드 → Pages 배포
  keepalive.yml        3일마다 Supabase ping + 저장소 활동 유지
```

## 설정 순서

### 1. Supabase (`dnihkxmecdyuplzvuemu`)
1. SQL Editor 에서 `supabase/schema.sql` → `migration_001_service_role_grants.sql` 실행 (완료)
2. **Authentication → Sign In / Providers**: Google **ON** (여행앱과 같은 OAuth 클라이언트), Anonymous **OFF**
3. **Authentication → URL Configuration**
   - Site URL: `https://maruid.github.io/seojae/`
   - Redirect URLs: `https://maruid.github.io/seojae/`, `http://localhost:5173/`
4. Google Cloud OAuth 클라이언트 → 승인된 리디렉션 URI: `https://dnihkxmecdyuplzvuemu.supabase.co/auth/v1/callback`

### 2. GitHub (`Maruid/seojae`, public)
1. **Settings → Pages → Source: GitHub Actions**
2. **Settings → Secrets and variables → Actions → Variables**
   - `SUPABASE_URL` = `https://dnihkxmecdyuplzvuemu.supabase.co`
   - `SUPABASE_KEY` = Publishable key (`sb_publishable_...`)
   - 둘 다 브라우저에 공개되는 값. **secret / service_role key 는 절대 넣지 않기**
3. **Settings → Actions → General → Workflow permissions: Read and write** (keepalive 커밋용)
4. main 에 push → Actions 의 `Deploy to GitHub Pages` 확인
5. Actions → `Supabase keepalive` → Run workflow 로 한 번 수동 실행해서 성공 확인

### 3. 관리자 등록 (최초 1회)
1. 배포된 사이트에서 Google 로그인 → "승인을 기다리고 있어요" 화면
2. Supabase **Authentication → Users** 에서 내 uid 확인 → SQL Editor:
   ```sql
   insert into public.admins(user_id) values ('<uid>');
   update public.profiles set status = 'approved', approved_at = now() where user_id = '<uid>';
   ```
3. 사이트에서 "승인됐는지 확인" → 홈이 열리면 완료 (관리자는 모든 섹터 열람)

친구 승인은 4단계 관리자 화면 전까지 SQL 로:
```sql
-- SQL Editor 에선 로그인 사용자가 없어 admin_* RPC 대신 직접 수정
update public.profiles set status = 'approved', approved_at = now() where email = 'friend@gmail.com';
insert into public.grants(user_id, sector)
  select user_id, 'columns' from public.profiles where email = 'friend@gmail.com';   -- 'novels' 도 필요하면 한 줄 더
```

## 콘텐츠 업로드

이 저장소가 아니라 로컬 `seojae-sync` 폴더의 `upload.py` 로 올립니다 (secret key 는 그 폴더 `.env` 에만).

## 로컬 개발

```bash
npm install
cp .env.example .env.local   # publishable key 입력
npm run dev                  # http://localhost:5173
npm test                     # escape / 라우터 / 권한별 탭 테스트
```

## 진행 상황

- [x] 1단계 골격: 로그인 → 승인 대기/차단 → 홈, 내 정보(화면 설정), 권한별 탭, 반응형 레이아웃, 배포
- [ ] 2단계 칼럼: 목록 · 읽기 · 보기 설정 · 읽음 처리 · 자기 글 링크
- [ ] 3단계 소설: 목록 · 회차 목록 · 읽기 · 다음 회차 미리 받기
- [ ] 4단계 관리자 + PWA: 승인/권한 화면, 앱 설치, 오프라인 캐시
