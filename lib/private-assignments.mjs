import { ASSIGNABLE_LOGINS, loginKey, validateAssignment } from "./pr-management.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = () => { throw new Error("배정 JSON 형식 오류: version, repository, assignments 및 항목 형식을 확인하세요. 원본 내용은 출력하지 않습니다."); };

// The only fields allowed to cross the private/public boundary. Never spread source rows.
export function projectAssignments(source) {
  if (!object(source) || source.version !== 1 || source.repository !== "kubernetes/website" || !object(source.assignments)) fail();
  const assignments = {};
  for (const [number, row] of Object.entries(source.assignments)) {
    if (!/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number)) || !object(row) || !Array.isArray(row.reviewers)) fail();
    if (row.reviewers.some((login) => typeof login !== "string" || !ASSIGNABLE_LOGINS.includes(loginKey(login)))) fail();
    if (row.excluded !== undefined && typeof row.excluded !== "boolean") fail();
    if (row.deadline !== undefined && (typeof row.deadline !== "string" || (row.deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(row.deadline) || Number.isNaN(Date.parse(row.deadline)) || new Date(row.deadline).toISOString().slice(0, 10) !== row.deadline)))) fail();
    if (row.notes !== undefined && (typeof row.notes !== "string" || row.notes.length > 2000)) fail();
    if (row.approver !== undefined && typeof row.approver !== "string") fail();
    assignments[number] = { reviewers: [...new Set(row.reviewers.map(loginKey))], excluded: row.excluded === true };
  }
  return assignments;
}

export function validateAssignmentAuthors(assignments, prs) {
  const byNumber = new Map(prs.map((pr) => [String(pr.number), pr]));
  for (const [number, row] of Object.entries(assignments)) {
    const pr = byNumber.get(number);
    if (!pr?.author) throw new Error(`PR #${number} 작성자를 확인하지 못해 배정 반영을 중단합니다.`);
    validateAssignment(pr, row);
  }
}

export async function loadPrivateAssignments({ repository = process.env.PR_ASSIGNMENTS_REPOSITORY || "", token = process.env.PR_ASSIGNMENTS_TOKEN || "", fetcher = fetch } = {}) {
  if (!repository && !token) return { assignments: {}, assignmentSource: { status: "not-configured", fetchedAt: null } };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !token) throw new Error("PR_ASSIGNMENTS_REPOSITORY와 PR_ASSIGNMENTS_TOKEN을 모두 설정하세요.");
  const get = async (path) => {
    let response;
    try {
      response = await fetcher(`https://api.github.com/repos/${repository}${path}`, {
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
        redirect: "error", signal: AbortSignal.timeout(30000),
      });
    } catch { throw new Error("Private 저장소 연결 실패. 기존 공개 데이터를 유지합니다."); }
    if (!response.ok) throw new Error(`Private 저장소 읽기 HTTP ${response.status}. 저장소·파일·토큰 권한을 확인하세요.`);
    try { return await response.json(); } catch { fail(); }
  };
  const repo = await get("");
  if (repo.private !== true) throw new Error("배정 저장소가 Private이 아닙니다. 연결을 중단합니다.");
  const file = await get("/contents/review-assignments.json");
  if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string" || file.size > 1024 * 1024) fail();
  let source;
  try { source = JSON.parse(Buffer.from(file.content, "base64").toString("utf8")); } catch { fail(); }
  return { assignments: projectAssignments(source), assignmentSource: { status: "connected", fetchedAt: new Date().toISOString() } };
}
