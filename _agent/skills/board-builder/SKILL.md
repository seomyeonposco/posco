---
name: board-builder
description: GitHub API & Vercel zero-config 기반 정적 부동산 게시판 홈페이지 구축 및 유지보수 스킬
---

# Board Builder Skill (GitHub API + Vercel Serverless)

## 1. 아키텍처 개요
- **프론트엔드**: 순수 HTML + Tailwind CSS (CDN) + Vanilla JS (`db.js`)
- **데이터 저장소**: `data/posts.json` (GitHub Contents API를 통한 커밋 기반 CRUD + `localStorage` 즉시 반영 캐시)
- **서버리스 설정 API**: `api/config.js` (Vercel 환경변수 `GITHUB_TOKEN`, `ADMIN_PASSWORD`를 안전하게 반환)
- **정적 설정**: `config/git_config.json` (`github_owner`, `github_repo`, `data_file_path` 보관, 토큰은 `"YOUR_GITHUB_TOKEN"` 플레이스홀더 유지)

## 2. 핵심 규칙 및 주의사항
1. **`public/` 폴더 금지**: Vercel의 `Other` 프리셋에서 `public/` 폴더가 존재하면 루트의 `index.html`, `admin.html` 등이 404가 되므로 데이터는 반드시 `data/`에 둔다.
2. **`vercel.json` zero-config 유지**: `builds` 배열을 사용하지 않고 `cleanUrls: true`, `trailingSlash: false`만 유지하여 `/api/config` 서버리스 함수가 정상 라우팅되도록 한다.
3. **이중 소스 `loadConfig()`**: `/api/config`와 `config/git_config.json`을 항상 병렬 조회하여 병합한다. 토큰은 `/api/config` 우선(`.trim()` 적용), 저장소 정보(`github_owner`, `github_repo`, `data_file_path`)는 `config/git_config.json`에서 읽는다.
4. **마크다운 보안 렌더링**: `renderMarkdown()`은 입력을 먼저 HTML-escape한 후 마크다운 서식을 적용하며, 백틱 기준 분할로 인라인 코드를 처리해 일반 숫자가 코드로 오인되지 않도록 한다.

## 3. 페이지 구성
- `index.html`: 메인 랜딩 페이지 + `id="board-preview"` 최신 소식 3건 미리보기 + `agent.jpg` 중개사 소개 + `admin.html` 로그인 링크
- `news.html`: 전체 게시글 목록 + 카테고리 필터 + `#search-input` 검색 + 데스크톱 사이드바(`agent.jpg`)
- `news-detail.html`: 마크다운 상세 렌더링 + 관리자 전용 수정/삭제 버튼
- `news-write.html`: 관리자 전용 글쓰기/수정 폼 (`requireAdmin()`)
- `admin.html`: 관리자 로그인 및 게시글 관리 대시보드
