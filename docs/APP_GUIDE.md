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

단계 2(예정): 화면이 꺼져도 받기(안드로이드 쪽 받기 + 알림).

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
- `src/lib/native.js` — 웹 쪽 앱 기능 (`isApp()` 일 때만): 로그인 복귀, 볼륨키 → PageDown/PageUp, 화면 묶음 업데이트(`@capgo/capacitor-updater`, 자동 업데이트·통계 끔), 앱 업데이트 안내
- 화면 묶음: Pages 배포 때 `dist/app/bundle-<커밋>.zip` + `dist/app/version.json` 을 함께 올림 (deploy.yml)
- 앱에는 서비스 워커가 없음 → 열어 본 글은 `rememberViewed()` 가 직접 저장
- 화면 가장자리 여백: CSS `--sat` · `--sab` (앱은 Capacitor 가 `--safe-area-inset-*` 를 넣어 줌, 웹은 `env()`)
- 로컬에서 앱 빌드(선택): Android Studio + JDK 21 → `npm run cap:sync` → `android/` 열기
