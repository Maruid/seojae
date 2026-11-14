# 서재 안드로이드 앱 (APK) 안내

> 스토어 없이 GitHub Releases 에서 받아 설치하는 안드로이드 전용 앱입니다.
> 웹 화면을 앱 안에 넣은 구조(Capacitor)라 화면·기능 대부분은 웹과 같고, 앱에서만 되는 것만 더해집니다.
> 웹(크롬·PWA)은 그대로 동작합니다 — 앱 기능은 모두 "앱 안일 때만" 켜집니다.

## 1. 앱에서만 되는 것 (단계 1)
| 기능 | 내용 |
|---|---|
| 볼륨키로 넘기기 | 읽기 화면에서만. 아래 = 다음 화면, 위 = 이전 화면, 회차 끝에서 한 번 더 → 다음 화. 목록에서는 원래대로 소리 크기. 보기 설정 › 고급에서 끄기 |
| 앱 전용 저장 공간 | 받아 둔 글·기록이 크롬과 따로, 앱 안에 저장 (앱 삭제·데이터 지우기 때만 지워짐) |
| 화면 켜짐 유지 | 앱 기능으로 (읽는 동안 화면 켜두기 · 자동 재생) |
| 로그인 | 구글은 앱 안 로그인을 막으므로 **크롬 탭**으로 열고 `io.github.maruid.seojae://login` 으로 앱에 돌아옴 |
| 화면 자동 업데이트 | 웹을 배포하면 앱이 다음에 열릴 때 새 화면 묶음을 받아 "새 버전이 있어요 [새로고침]" (APK 다시 설치 불필요) |
| 앱 업데이트 안내 | 새 화면이 더 새 앱 기능을 필요로 하면 "앱을 업데이트해 주세요 [받기]" |

### 단계 2 (v2.10 · 앱 기능 버전 2, APK 1.0.3~)
| 기능 | 내용 |
|---|---|
| 화면이 꺼져도 받기 | 받기를 앱의 받기 서비스(`DownloadService`, 알림 표시)가 함. 진행 창 [숨기기] → 알림에서 진행·취소. 파일은 앱 저장 공간 `files/dl/` |
| 읽을 때 전체 화면 | 보기 설정 › 고급 (앱에서만, 기본 끔). 읽기 화면에서 시계·배터리 줄과 제스처 바를 숨김. 가장자리에서 쓸면 잠깐 보였다 저절로 들어감. 카메라 구멍 자리는 읽기 화면 색 띠로 남김 |
| 뒤로가기 버튼 | 열린 창·패널·검색 닫기 → 읽기 화면은 들어온 목록으로 → 소설 상세는 소설 목록, 다운로드 관리·앱으로 설치는 내 정보 → 탭은 홈 → 홈에서 "한 번 더 누르면 종료돼요" (2초 안에 다시 누르면 종료). 앱 설치본 기능만 써서 APK 다시 설치 불필요 |
| 오른쪽 스크롤 막대 | 앱에서만 아래 주황 진행선 대신. 회색, 높이 = 보이는 양/글 길이, 위치 = 진행률. 스크롤할 때 보였다 1초 뒤 사라짐. 끌기 없음, 자동 재생 중엔 안 보임. 바가 보일 때 아래 바 위 테두리 진행선은 그대로 |

옛 앱(기능 버전 1)은 새 화면을 받아도 예전처럼: 받기는 화면이 켜져 있을 때만, 전체 화면은 기본 기능으로 숨기고 넘길 때 다시 숨김.

## 2. 처음 한 번 설정
### 2-1. 서명 키 만들기 (내 PC)
```
pip install cryptography
python tools/make_keystore.py        # 비밀번호 두 번 입력
```
- `seojae-release.p12`(키)와 `seojae-release.base64.txt`(Secret 용)가 생깁니다.
- **`.p12` 파일과 비밀번호는 두 곳 이상 백업**(예: PC + 개인 클라우드). 잃어버리면 이미 깐 앱을 업데이트할 수 없어 지우고 다시 깔아야 하고, 그때 받아 둔 글도 지워집니다.
- 저장소(공개)·대화·메신저에는 넣지 않습니다. `.gitignore` 에 `*.p12` 가 들어 있습니다.

### 2-2. GitHub Secrets (Settings → Secrets and variables → Actions → **Secrets**)
| 이름 | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `seojae-release.base64.txt` 내용 전체 |
| `ANDROID_KEYSTORE_PASSWORD` | 정한 비밀번호 |
| `ANDROID_KEY_ALIAS` | `seojae` |
| `ANDROID_KEY_PASSWORD` | 같은 비밀번호 |

등록한 뒤 `seojae-release.base64.txt` 는 지워도 됩니다(`.p12` 는 백업 보관).

### 2-3. Supabase 로그인 돌아올 주소
Authentication → URL Configuration → Redirect URLs 에 추가:
```
io.github.maruid.seojae://login
```

## 3. APK 만들기 · 올리기
- GitHub → Actions → **Android APK** → Run workflow (또는 `app-v1.2.0` 같은 태그 push)
- 약 5~10분 뒤 Releases 에 `서재 앱 1.0.N` 과 `seojae.apk` 가 올라감
- 받는 주소(항상 최신): `https://github.com/Maruid/seojae/releases/latest/download/seojae.apk`
  - 웹의 내 정보 › 앱으로 설치 화면(안드로이드)에 [안드로이드 앱 받기] 버튼으로 들어 있음
- 버전: 버전 코드 = 빌드 번호(자동 증가), 이름 = 태그 또는 `1.0.<빌드 번호>`

## 4. 휴대폰에 설치
1. 크롬에서 받기 링크를 누름 → 받기 완료 알림을 누름
2. 처음 한 번 "출처를 알 수 없는 앱 설치" → 크롬 허용
3. Play 프로텍트 경고가 뜨면 "무시하고 설치"(스토어에 없는 앱이라 뜨는 것)
4. 앱에서 구글 로그인 → 크롬 탭에서 계정 고르기 → 앱으로 돌아옴
- 앱과 크롬(웹)은 저장소가 따로 → 웹에서 받아 둔 글은 앱에서 다시 받아야 함

## 5. 언제 APK 를 다시 만들어야 하나
| 바꾼 것 | 할 일 |
|---|---|
| 웹 화면(`src/` 등) | 지금처럼 main 에 push → Pages 배포. 앱은 다음에 열 때 자동으로 새 화면 |
| 앱 쪽 코드(`android/`), 앱 플러그인, 앱 이름·아이콘 | Android APK 워크플로 실행 → 새 APK 설치 |
| 새 화면이 새 앱 기능을 씀 | `SeojaePlugin.NATIVE_API` 와 `app-version.json` 의 `min_native_api` 를 올리고, 새 APK 먼저 → 그다음 웹 배포 (옛 앱은 업데이트 안내) |

## 6. 구조 (개발 참고)
- `capacitor.config.json` — 앱 ID `io.github.maruid.seojae`, 화면 파일 `dist-app`(`npm run build:app`, `VITE_BASE=/ VITE_APP=1`)
- `android/` — Capacitor 안드로이드 프로젝트. `MainActivity`(볼륨키), `SeojaePlugin`(볼륨키 켜기 · 화면 켜짐 · 기능 버전), 딥링크 intent-filter, 서명은 환경 변수
- `DownloadService` — 포그라운드 서비스(dataSync). `.job.json`(이름·서명 주소·한도) 을 읽어 3개씩 받고 `.results.jsonl` 에 결과를 남김. 한도(`limit` 바이트)에 닿으면 멈춤
- 웹 쪽 받기(`offline/engine.js` `runNative`): 열어 본 글은 여기서 옮겨 담고, 나머지는 하루짜리 서명 주소로 넘김. 결과는 진행 중·끝·앱 다시 열 때(`syncNative`) 가져와 기록 + 한도에 더함. 끊긴 것은 kv `nativeJob` → `job`(이어 받기)
- 파일 이름 = 주소 키 SHA-256 앞 40자 + 확장자, 읽을 때 `Capacitor.convertFileSrc` (`offline/store.js`, 없으면 Cache API 로)
- `src/lib/native.js` — 웹 쪽 앱 기능 (`isApp()` 일 때만): 로그인 복귀, 볼륨키 → PageDown/PageUp, 화면 묶음 업데이트(`@capgo/capacitor-updater`, 자동 업데이트·통계 끔), 앱 업데이트 안내
- 화면 묶음: Pages 배포 때 `dist/app/bundle-<커밋>.zip` + `dist/app/version.json` 을 함께 올림 (deploy.yml)
- 앱에는 서비스 워커가 없음 → 열어 본 글은 `rememberViewed()` 가 직접 저장
- 화면 가장자리 여백: CSS `--sat` · `--sab` (앱은 Capacitor 가 `--safe-area-inset-*` 를 넣어 줌, 웹은 `env()`)
- 로컬에서 앱 빌드(선택): Android Studio + JDK 21 → `npm run cap:sync` → `android/` 열기
