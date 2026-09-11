# PR 관리 — GitHub PR + Private JSON

현재 화면과 예약 수집은 Google Sheets를 사용하지 않습니다.
이전 Google 연동 소스·문서는 복구를 위해 보존했으나 활성 워크플로에서는 호출하지 않습니다.
DB 없이 Private 저장소의 JSON 한 파일을 배정 원본으로 사용합니다.

## 준비

1. GitHub에서 **Private** 저장소를 만듭니다. 이름은 자유입니다.
2. 이 프로젝트의 `templates/private-repo/review-assignments.json`을 새 저장소 **기본 브랜치의 루트**에 같은 이름으로 추가합니다. 빈 assignments로 시작해도 됩니다.
3. 배정 파일을 편집할 운영자에게만 저장소 접근 권한을 부여합니다.
4. Fine-grained PAT를 발급합니다. 새 Private 저장소 한 개만 선택하고 **Contents: Read-only** 권한을 줍니다. 자동 포함되는 Metadata 읽기 외에 쓰기 권한은 필요 없습니다. 만료 전에 갱신하세요.
5. **사이트 저장소** Settings → Secrets and variables → Actions에서 설정합니다.
   - Variables: `PR_ASSIGNMENTS_REPOSITORY` = `소유자/Private저장소이름`
   - Secrets: `PR_ASSIGNMENTS_TOKEN` = 위 토큰
6. 사이트 변경을 main에 올리고 Pages 배포 원본을 GitHub Actions로 설정합니다. Actions의 **Refresh PR management hourly → Run workflow**로 첫 수집을 실행합니다.

토큰을 채팅, 소스 코드, JSON 파일, 브라우저 환경변수에 넣지 마세요.
사이트 저장소의 기본 GITHUB_TOKEN은 다른 Private 저장소 접근용으로 사용할 수 없어 별도 토큰이 필요합니다.
공식 근거: [Contents API 읽기 권한](https://docs.github.com/en/rest/repos/contents#get-repository-content), [GITHUB_TOKEN 권한 범위](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token).

## 배정 변경

Private 저장소에서 JSON 파일의 연필 버튼(Edit)을 눌러 수정하고 커밋합니다.
사이트에서는 읽기만 합니다. 사이트 내 저장 버튼·토큰 입력·Google 로그인이 없습니다.
아래 번호를 **실제 관리할 PR 번호**로 바꾸어 입력하세요. 샘플은 실제 배정을 의미하지 않습니다.

```json
{
  "version": 1,
  "repository": "kubernetes/website",
  "assignments": {
    "12345": {
      "reviewers": ["bckmini", "jiyubaek"],
      "excluded": false,
      "deadline": "2026-09-30",
      "approver": "eundms",
      "notes": "내부 운영 메모"
    }
  }
}
```

- reviewers는 필수 배열입니다. 미배정은 `[]`. GitHub ID 대소문자와 중복은 정규화합니다.
- 쿠버네티스 팀만 수동 배정할 수 있고 본인의 PR에는 배정할 수 없습니다.
- 배정 가능 ID: m3k0813, bckmini, neronsoda, woonkim0413, llokr1, gpffh20, ye11oc4t, hkkim2021, yucori, wlgusqkr, dongjune8931, starbea, suhyenim, jiyubaek.
- 오픈스택 멤버는 GitHub에 실제로 남긴 자발적 리뷰를 표시합니다. 수동 배정에는 넣지 않습니다.
- 비번역 작업은 `excluded: true`로 설정합니다. 내부 notes를 분석해 제외 여부를 추측하지 않습니다.
- deadline, approver, notes는 선택 항목으로 Private 파일에만 보관됩니다. 사이트에서 조회할 수 없습니다.
- 종료 PR의 배정 기록은 지우지 않아야 과거 업무량 집계가 유지됩니다. 항목 삭제는 배정 해제이며 PR 자체는 보존합니다.
- 여러 사람이 편집하면 GitHub 변경 이력과 충돌 검사를 사용하세요. 잘못된 형식은 수집을 실패 처리하고 이전 배포를 유지합니다.

## 공개 범위

| 정보 | 공개 Pages |
| --- | --- |
| PR 제목·작성자·생성일·상태·이슈·리뷰·/lgtm·/approve·라벨 | GitHub 공개 정보로 수집 |
| 배정 리뷰어 GitHub ID·excluded | 공개 |
| 배정 완료/미완료·업무량·Approver 점검 필요 | 위 공개 항목에서 계산 |
| 이름·리뷰 기한·내부 비고·수동 지정 Approver·추가 필드 | 원본에서 공개 출력으로 복사하지 않음 |
| 토큰·원문·Private 저장소 주소 | 사이트 데이터에 포함하지 않음 |

공개된 배정 ID와 제외 여부는 방문자가 다운로드할 수 있습니다.
이 경계는 **새 PR 관리 기능**에 대한 것입니다. 기존 KPI 페이지의 멤버 이름·metrics 데이터는 이번 변경에서 삭제하지 않았습니다.

원문은 수집 프로세스 메모리에서만 읽고 필요한 두 필드만 새 객체에 담습니다.
전체 응답·파싱 오류 원문은 출력하지 않으며 원문 artifact도 업로드하지 않습니다.
공개 저장소의 코드를 변경할 수 있는 사람은 Secrets를 악용할 수 있으므로 사이트 저장소의 쓰기 권한도 제한하세요.
Private 저장소와 Google 시트를 자동 수정하지 않습니다.

## 갱신과 보존

- PR 관리 기준: `data/pr-management-config.json`의 trackingStart. KPI 활동 시작일(7월 11일)과 별도입니다.
- 이후 모든 PR의 한국어 Markdown 변경을 확인합니다. 기존 Open PR은 language/ko 라벨·[ko] 제목으로 후보를 가져옵니다.
- 배정 파일에 넣은 PR 번호도 수집하므로 기준일 전 PR도 명시적으로 유지할 수 있습니다.
- 매시간 47분 예약 수집합니다. 예약 작업은 지연되거나 저장소 비활성 등으로 중지될 수 있으므로 Actions 실행 결과를 확인하세요.
- Private JSON 커밋 자체는 사이트 빌드를 즉시 실행하지 않습니다. 기다리거나 사이트 저장소에서 Run workflow를 누르세요.
- 사이트의 새로고침은 **마지막 배포 JSON을 다시 읽는 기능**이며 GitHub 수집 실행 기능은 아닙니다.
- 매 수집 전 기존 공개 스냅샷을 복구하므로 머지/종료 PR도 유지합니다.
- 연결 전에는 GitHub 수집만 수행하고 배정은 '연결 대기'로 표시합니다.
- 연결 후 설정 소실, 401/404, 잘못된 JSON, 자기 배정이 발생하면 새 배포를 중단합니다.
- 원본 배정 변경 이력은 Private 저장소의 History에서 확인합니다.

## 개발 검증

`npm run test:prs`로 비공개 필드 차단, 연결 실패, 배정 검증, PR 보존을 확인합니다.
`npm run build`와 `npm run export:pages`로 Pages 출력을 생성합니다.
로컬 수집에서도 두 PR_ASSIGNMENTS 환경변수는 수집 프로세스에만 전달하세요. 실제 원본은 이 공개 프로젝트에 저장하지 마세요.
