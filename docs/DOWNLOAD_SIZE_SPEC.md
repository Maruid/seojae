# 다운로드 용량 칸 채우기 사양 — 업로더 구현용

> 웹에 오프라인 다운로드 기능이 들어갑니다. 사용자마다 월 다운로드 한도가 있어서,
> 받기 전에 **"128화 · 약 2.1MB"** 처럼 정확한 용량을 보여 주고 한도를 확인해야 합니다.
> 지금 DB 에는 글자 수만 있어서 어림밖에 못 합니다 → 업로더가 올릴 때 **파일 크기(bytes)** 를 같이 기록해 주세요.

## 1. DB
- `supabase/migration_008_download_sizes.sql` 실행 (칸만 추가, 다시 실행해도 안전)

| 표 | 칸 | 값 |
|---|---|---|
| `novel_chapters` | `size_bytes int` | 그 회차 `.txt` 파일을 Storage 에 올린 **바이트 수 그대로** (UTF-8 인코딩 후 길이) |
| `novels` | `cover_bytes int` | 목록용 표지 `cover-<해시>.webp` 바이트 수 (표지 없으면 null) |
| `columns` | `size_bytes int` (이미 있음) | `.md` 바이트 수 — 지금처럼 |
| `columns` | `image_bytes bigint` | 그 칼럼 `.md` 가 참조하는 이미지(`columns/images/<name>`) 파일 크기 합 |
| `columns` | `image_count int` | 참조하는 이미지 개수 (같은 이미지를 두 번 참조하면 1개) |

- 크기는 **실제로 올린 파일**(압축·변환 후) 기준. 원본 크기가 아님
- 이미지를 여러 칼럼이 같이 쓰면 칼럼마다 각각 더함 (웹은 받기 전에 겹치는 걸 다시 빼서 계산)
- 큰 표지(`cover_large_path`)는 다운로드에 안 쓰므로 크기 칸 없음

## 2. 언제 채우나
| 상황 | 할 일 |
|---|---|
| 회차 새로 올림 · 내용 바뀜(`content_hash` 바뀜) | `size_bytes` 같이 넣음 (회차 upsert 할 때 한 번에) |
| `--replace` · 다시 나누기 | 새 회차 행마다 `size_bytes` |
| 표지 새로 올림 · 바뀜 | 표지 PATCH 에 `cover_bytes` 같이 (`cover_path`, `cover_hash` 와 한 번에) |
| 칼럼 새로 올림 · md 나 이미지 바뀜 | `size_bytes`, `image_bytes`, `image_count` 같이 |
| **이미 올라간 것 (채워 넣기)** | 크기 칸이 null 인 행 → 파일을 다시 올리지 말고 로컬 파일(또는 Storage 목록의 `metadata.size`)로 크기만 PATCH. 계획 화면에는 "크기 기록 N개" 로 표시, 회차 변경 없음 |

- 008 전 DB(칸 없음, PostgREST `42703`/`PGRST204`) → 크기 칸만 빼고 나머지는 정상으로 올리고 "migration_008 전" 안내
- 내용이 안 바뀌었으면 크기도 그대로 → 다시 쓰지 않음 (두 번 실행해도 변경 없음)

## 3. 채워 넣기 방법 (참고)
- Storage 목록 API 로 한 번에 크기를 얻을 수 있음:
  `POST /storage/v1/object/list/content` `{ "prefix": "novels/<소설ID>/", "limit": 1000 }` → 각 항목 `metadata.size`
- 회차 행의 `path` 와 맞춰서 `size_bytes` 를 PATCH (`/rest/v1/novel_chapters?novel_id=eq.<ID>&key=eq.<키>`)
- 칼럼은 `columns/md/<ID>.md` 크기 + md 에서 찾은 이미지 경로들의 크기 합

## 4. 웹 쪽 동작 (참고)
- 받기 창: `size_bytes` 가 있으면 그 합, 없으면 `char_count × 3` 바이트로 어림하고 "약" 을 붙임
- 칼럼: `size_bytes + image_bytes`, 없으면 "이미지 포함 · 용량은 받은 뒤 기록"
- 한도에는 **실제로 받은 바이트**를 기록 (이 칸은 미리 보여 주기·한도 확인용)

## 5. 확인할 것
- [ ] 008 실행 후 소설 하나 올림 → 회차마다 `size_bytes`, 소설 `cover_bytes` 채워짐
- [ ] 같은 폴더로 다시 실행 → 변경 없음
- [ ] 회차 하나 내용 바꿈 → 그 회차 `content_hash` 와 `size_bytes` 만 바뀜
- [ ] 이미 올라간 소설 · 칼럼 → 채워 넣기로 크기만 기록, 파일은 다시 안 올림
- [ ] 칼럼 이미지 개수·합계가 md 참조와 맞음
- [ ] 008 전 DB → 크기만 건너뛰고 안내
