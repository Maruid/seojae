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

친구 승인은 앱의 **관리** 탭에서 합니다 (검색 · 승인 · 섹터 권한 · 차단). 앱이 안 될 때 비상용 SQL:
```sql
-- SQL Editor 에선 로그인 사용자가 없어 admin_* RPC 대신 직접 수정
update public.profiles set status = 'approved', approved_at = now() where email = 'friend@gmail.com';
insert into public.grants(user_id, sector)
  select user_id, 'columns' from public.profiles where email = 'friend@gmail.com';   -- 'novels' 도 필요하면 한 줄 더
```

## 2단계 적용 순서 (한 번만)

1. Supabase SQL Editor 에서 `supabase/migration_002_links_admin_guard.sql` 실행 (`columns.links` 추가, 관리자 자기 차단 방지)
2. `seojae-sync` 폴더에서 새 `upload.py` 로 `python upload.py --dry-run` → `python upload.py`
   (본문의 naver.me 단축 링크를 펼쳐 `links` 를 채움. 내용이 같은 글은 파일을 다시 올리지 않고 정보만 갱신)
3. 이 저장소 push → Actions 배포

## 읽기 화면 v2 · 소설 정보 적용 순서 (한 번만)

1. Supabase SQL Editor 에서 `supabase/migration_003_novel_meta.sql` 실행 (소설 작가·대표 장르·태그 + 관리자 저장 함수)
1. Supabase SQL Editor 에서 `supabase/migration_004_genres_cover.sql` 실행 (장르 여러 개 + 표지 칸, 다시 실행해도 안전)
1. 표지를 쓰려면 동기화 폴더에서 `pip install pillow` 한 번
1. Supabase SQL Editor 에서 `supabase/migration_006_cover_large.sql` 실행 (표지 크게 보기용 칸)
1. Supabase SQL Editor 에서 `supabase/migration_008_download_sizes.sql` · `supabase/migration_009_downloads.sql` 실행 (오프라인 다운로드: 크기 칸 · 사용자별 월 한도)
1. Supabase SQL Editor 에서 `supabase/migration_007_genre_list.sql` 실행 (장르 목록 고정 + 자동 정리) → `supabase/tools/genre_cleanup_1_preview.sql` 로 확인 → `genre_cleanup_2_apply.sql` 로 기존 소설 정리
2. 이 저장소 push → 배포
3. 앱 **관리 › 소설 정보** 에서 소설마다 작가·장르·태그 입력
4. 안드로이드 설치 앱은 하단 바 색(manifest)이 바뀌었으니 **앱을 지우고 다시 설치**해야 바로 반영됨

## 안드로이드 앱 (APK)

설정 · 빌드 · 설치 순서는 `docs/APP_GUIDE.md`. 요약: `python tools/make_keystore.py` → GitHub Secrets 4개 → Supabase Redirect URLs 에 `io.github.maruid.seojae://login` → Actions › Android APK → 휴대폰에서 `releases/latest/download/seojae.apk`.

## 콘텐츠 업로드

이 저장소가 아니라 로컬 `seojae-sync` 폴더의 `upload.py` 로 올립니다 (secret key 는 그 폴더 `.env` 에만).

```bash
python upload.py --dry-run                          # 무엇이 올라갈지 확인
python upload.py                                    # 칼럼 + 소설 (바뀐 것만)
python upload.py --replace "바바.txt" --dry-run     # 소설 하나를 지우고 새로 올릴 때: 먼저 확인
python upload.py --replace "바바.txt"               # 회차·회차 파일·그 소설 읽기 기록 삭제 후 전부 다시 (y 확인)
python inspect_novels.py                            # 분할 규칙이 바뀌었을 때: 소설별로 어떻게 나뉘는지 먼저 확인
python upload.py --replace-all --dry-run            # 모든 소설을 지우고 새로 올릴 때: 먼저 확인
python upload.py --replace-all                      # "모두 지움" 입력해야 진행 (칼럼은 그대로)
```
- 소설은 **파일 이름**으로 구분 (`novels_map.json`: 파일 이름 → 소설 ID). 제목이 같아도 파일 이름이 다르면 다른 소설
- 일반 업로드는 원본에서 사라진 회차를 DB 에 남겨 둠 → 회차를 정리하려면 `--replace`
- `--replace` 해도 소설 ID·작가·장르·태그는 유지

## 로컬 개발

```bash
npm install
cp .env.example .env.local   # publishable key 입력
npm run dev                  # http://localhost:5173
npm test                     # escape · 라우터 · 권한별 탭 · 본문 변환 · 보기 설정 · 소설 문단 테스트
```

## 진행 상황

- [x] 1단계 골격: 로그인 → 승인 대기/차단 → 홈, 내 정보(화면 설정), 권한별 탭, 반응형 레이아웃, 배포
- [x] 2단계 칼럼: 목록 · 읽기 · 보기 설정 · 읽음 처리 · 자기 글 링크 (migration_002 필요)
- [x] 3단계 소설: 목록 · 회차 목록 · 읽기 · 다음 회차 미리 받기 (DB 변경 없음)
- [x] 4단계 관리자 + PWA: 승인/권한 화면, 앱 설치, 오프라인 캐시, 새 버전 배너
- [x] 읽기 화면 v2: 반투명 위·아래 바, 고정, 진행 막대 + % 입력, 정보 팝업, 글 안 검색, 줄 단위 즉시 넘기기, 전체 화면, 글자 두께 / 소설 작가·장르·태그 + 목록 필터 (migration_003)
- [x] 소설 표지(같은 이름 이미지 → upload.py) + 바둑판형 목록, 장르 여러 개 (migration_004) / 섞인 회차 제목 형식 인식 · 보류 · --force / --split
- [x] v2.6: 홈 이어 읽기(소설 표지 줄 + 칼럼 5개), 소설 탭 보기 3종 · 검색 · 필터 창 · 바로 가기 · 표지 크게 보기, 칼럼 분류 선택 상자 (migration_006)
- [x] v2.10: 앱 2단계 (화면 꺼져도 받기 · 읽을 때 전체 화면 · 오른쪽 스크롤 막대)
- [x] v2.9: 안드로이드 앱 1단계 (볼륨키 넘기기 · 앱 전용 저장 공간 · 크롬 탭 로그인 · 화면 자동 업데이트, `docs/APP_GUIDE.md`)
- [x] v2.8: 오프라인 다운로드 (소설·칼럼 받기 창 · 여러 편 · 카드 메뉴 · 다운로드 관리 · 사용자별 월 한도 · 30일 잠금, migration_008·009)
- [x] v2.7: 장르 18개 목록 고정 · 별칭 · 목록에 없는 장르는 태그로 (migration_007 + 정리 SQL), 관리 편집 장르 고르기 + 자동완성
