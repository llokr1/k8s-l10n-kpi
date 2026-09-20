# 내부 PR 관리 편집

Reviewer와 Review 완료 셀의 드롭다운에서 쿠버네티스·오픈스택 명단을 체크하고 적용합니다.
기한은 표의 달력 입력으로, 비고는 해당 셀의 입력창으로 수정합니다.
GitHub 리뷰 기록과 운영자 확인 기록을 구분하며 자동 수집이 수동 체크를 덮어쓰지 않습니다.
충돌이 발생하면 입력을 유지하며 오류를 표시합니다. 내용을 복사해 둔 뒤 새로 불러와 다시 편집하세요.

## 현재 Mac에서 실행

별도 터미널에서 저장 서버를 실행합니다. 이 명령에는 토큰이 없습니다.

```sh
REVIEW_GIT_DIRECTORY=/path/to/private-review-repository npm run review:server
```

기존 사이트는 `npm run dev`로 실행하고 localhost:3000의 PR 관리 메뉴를 엽니다.
서버는 127.0.0.1:3101에만 연결됩니다. Private 저장소의 기존 Git 인증을 사용합니다.
저장 전 원격 main을 확인하고 변경을 커밋·푸시합니다. 미커밋 파일이나 병합 충돌이 있으면 중단합니다.
다른 PR이 동시에 수정돼도 파일 revision이 다르면 덮어쓰지 않습니다.
로컬 변경 백업은 저장소의 .git/review-history 안에 남습니다.

## 집 PC와 GitHub Pages 연결

집 PC에서는 편집 서버를 127.0.0.1:3101로 실행하고 Caddy가 공개 HTTPS 주소를 3101로 전달합니다.
공유기는 외부 TCP 443을 집 PC의 TCP 443으로 포트포워딩합니다. GitHub Pages가 HTTPS이므로 API도 HTTPS여야 하며, 공인 IP가 바뀌면 DDNS 도메인을 사용합니다.

`deploy/review-api.env.example`을 비공개 환경 파일로 복사하고 다음 값을 실제 환경에 맞게 변경합니다.

- `REVIEW_ALLOWED_ORIGINS`: GitHub Pages의 origin. 현재 프로젝트 경로를 제외한 `https://llokr1.github.io`
- `REVIEW_ALLOWED_HOSTS`: Caddy에서 사용할 공개 API 호스트명
- `REVIEW_PUBLIC_SNAPSHOT_URL`: 배포된 `data/pr-management.json`의 전체 주소
- `REVIEW_GIT_DIRECTORY`: 집 PC에 clone한 Private 저장소의 절대경로
- `REVIEW_ACTIONS_TOKEN`: 사이트 저장소에만 접근하며 Actions 읽기·쓰기 권한을 가진 Fine-grained PAT
- `REVIEW_ACTIONS_TRIGGER_KEY`: 최신 데이터 수집 버튼에서 입력할 충분히 긴 임의 문자열
- `REVIEW_ACTIONS_REPOSITORY`: Actions를 실행할 공개 사이트 저장소. 현재 `llokr1/k8s-l10n-kpi`
- `REVIEW_ACTIONS_WORKFLOW`: 실행할 workflow 파일. 현재 `pr-management.yml`
- `REVIEW_ACTIONS_REF`: workflow를 실행할 브랜치. 현재 `main`

Private 저장소 clone은 main 브랜치와 깨끗한 작업 트리를 유지해야 합니다. 편집 서버를 실행하는 OS 계정에서 `git fetch`, `git commit`, `git push`가 비대화식으로 성공하도록 Git 인증과 사용자 이름·이메일을 설정합니다.

`deploy/Caddyfile.example`의 호스트명을 실제 DDNS/도메인으로 바꾸고 Caddy를 실행합니다. 공유기와 PC 방화벽에서는 443만 열고 3101은 외부에 직접 노출하지 않습니다. ISP가 CGNAT를 사용하면 일반 포트포워딩으로는 외부 접속이 되지 않습니다.

사이트 저장소의 **Settings → Secrets and variables → Actions → Variables**에 `REVIEW_API_URL`을 만들고 값을 `https://공개-API-호스트/api/reviews`로 설정합니다. 이후 Pages 워크플로를 다시 실행하면 이 주소가 정적 사이트에 반영됩니다. API 주소는 비밀값이 아니므로 Actions Secret이 아니라 Variable을 사용합니다.

이 구성에는 사용자별 로그인이나 공유 비밀번호가 없습니다. URL을 아는 외부인이 요청을 만들 수 있으므로 링크 유출은 곧 편집 권한 유출로 봐야 합니다. CORS와 Host 검사는 브라우저 오동작을 줄이는 장치이지 인증 수단은 아닙니다.

서버에 Git 체크아웃 대신 토큰을 둘 수도 있습니다. 이 경우 REVIEW_GIT_DIRECTORY를 비우고
PR_ASSIGNMENTS_REPOSITORY와 PR_ASSIGNMENTS_WRITE_TOKEN을 서버 환경에만 설정합니다.
토큰은 Private 저장소 하나의 Contents 읽기·쓰기 권한만 필요하며 브라우저/빌드 변수에 넣지 않습니다.
Actions에서 사용하는 PR_ASSIGNMENTS_TOKEN은 기존 읽기 전용 권한을 유지합니다.
화면의 **최신 데이터 수집** 버튼은 편집 서버의 `POST /api/reviews/refresh`를 호출합니다. 최초 실행 시 `REVIEW_ACTIONS_TRIGGER_KEY` 값을 한 번 입력하며 해당 브라우저에 보관되어 이후부터는 버튼만 누르면 바로 실행됩니다. 편집 서버가 `workflow_dispatch`를 요청하므로 `REVIEW_ACTIONS_TOKEN`은 브라우저나 Pages 빌드 변수에 넣지 않습니다. 버튼과 서버 모두 실행 후 5분 동안 재실행을 막습니다. 수집과 Pages 배포에는 일반적으로 약 4~5분이 걸리며, 화면의 5분 자동 불러오기가 완료된 배포 JSON을 반영합니다.

## 시트 이관

PR wrangler 탭의 모든 행과 13개 열을 sourceSheet.rows에 원문 보존합니다.
구조화된 assignments에는 reviewer, 완료 명단, 기한, Approver, 비고, 제외 여부를 저장하고 pullRequests에는 기존 PR 정보를 보존합니다.
기존 배정 중 현재 두 팀에 없거나 작성자 본인인 기록은 legacyReviewers에 감사 이력으로 남깁니다.
sourceSheet는 이관 당시의 기록이며 화면 편집은 assignments에 반영됩니다.
원본 Google 시트에는 쓰지 않습니다. 원본·이름·기한·비고는 공개 수집 JSON에 포함하지 않습니다.

수동 완료와 비고는 저장 직후 내부 화면에서 반영됩니다. 공개 Pages의 새 배정 반영은 기존 Actions 예약 수집 후 이뤄집니다.
## 셀 드롭다운과 리뷰 현황

Reviewer / Review 완료 셀의 ▾ 버튼에서 쿠버네티스·오픈스택 명단을 체크하고 **적용**합니다. 적용에 성공하면 내부 서버가 Private 저장소 JSON을 커밋·푸시합니다. 체크만 바꾸거나 취소하면 저장하지 않습니다. 본인 PR에는 본인을 배정할 수 없습니다. 동시 편집으로 revision이 달라지면 덮어쓰지 않고 저장을 거부합니다.

완료 선택은 변경한 사람에게만 수동 확인/해제를 기록합니다. 다른 사람의 GitHub 자동 판정은 유지합니다. 과거 시트의 두 팀 배정은 집계에 포함하고, 편집 시 현재 배정으로 정규화합니다. 원본 시트 기록과 외부·자기 배정의 참고 이력은 보존합니다.

리뷰 현황 탭은 쿠버네티스 팀에 한해 사이즈별 배정, Total Score, 총 할당, 배정 중 완료와 진행률을 표시합니다. 가중치는 참고 시트와 같은 XS 1, S 4, M 13, L 60, XL 150, XXL 300입니다. 번역 PR X는 제외하며, 크기 미확인은 가중치에서 제외하고 따로 표시합니다. 건수는 PR × 리뷰어 단위입니다. Google 시트는 읽기만 하며 수정하지 않습니다.
