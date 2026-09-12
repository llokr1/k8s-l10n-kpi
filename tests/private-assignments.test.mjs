import assert from "node:assert/strict";
import test from "node:test";
import { projectAssignments, loadPrivateAssignments, validateAssignmentAuthors } from "../lib/private-assignments.mjs";

const source = (row) => ({ version: 1, repository: "kubernetes/website", assignments: { "12345": row } });
test("공개 출력에는 리뷰어 ID와 제외 여부만 포함하고 내부 정보를 차단한다", () => {
  const output = projectAssignments(source({ reviewers: ["Bckmini", "bckmini"], excluded: true, deadline: "2026-12-31", notes: "PRIVATE_CANARY", approver: "INTERNAL_APPROVER", name: "SECRET_NAME", unexpected: { token: "SECRET_TOKEN" } }));
  assert.deepEqual(output, { "12345": { reviewers: ["bckmini"], excluded: true } });
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|INTERNAL|SECRET|2026-12-31/);
});
test("두 팀 외 수동 배정, 잘못된 타입과 날짜를 거부한다", () => {
  assert.deepEqual(projectAssignments(source({reviewers:["developowl"]}))["12345"].reviewers,["developowl"]);
  for (const row of [{ reviewers: ["unknown-user"] }, { reviewers: "bckmini" }, { reviewers: [], excluded: "false" }, { reviewers: [], deadline: "2026-02-30" }, { reviewers: [], notes: {} }]) {
    assert.throws(() => projectAssignments(source(row)), /형식 오류/);
  }
  assert.throws(() => projectAssignments({ ...source({ reviewers: [] }), version: 2 }));
  assert.deepEqual(projectAssignments({ version: 1, repository: "kubernetes/website", assignments: {} }), {});
});
test("배정 대상 PR 작성자 미확인과 자기 배정을 거부한다", () => {
  const assignments = projectAssignments(source({ reviewers: ["Bckmini"] }));
  assert.throws(() => validateAssignmentAuthors(assignments, []), /작성자/);
  assert.throws(() => validateAssignmentAuthors(assignments, [{ number: 12345, author: "BCKMINI" }]), /본인/);
  validateAssignmentAuthors(assignments, [{ number: 12345, author: "someone" }]);
});
test("연결 전과 정상 빈 배정을 구분하고 부분 설정을 거부한다", async () => {
  assert.equal((await loadPrivateAssignments({ repository: "", token: "" })).assignmentSource.status, "not-configured");
  await assert.rejects(loadPrivateAssignments({ repository: "owner/private", token: "" }), /모두 설정/);
  await assert.rejects(loadPrivateAssignments({ repository: "", token: "secret" }), /모두 설정/);
});
test("지정한 GitHub API만 읽고 원문·토큰·저장소 주소를 반환하지 않는다", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer SECRET_TOKEN");
    if (!url.endsWith("/contents/review-assignments.json")) return Response.json({ private: true });
    return Response.json({ type: "file", encoding: "base64", content: Buffer.from(JSON.stringify(source({ reviewers: ["bckmini"], notes: "PRIVATE_CANARY" }))).toString("base64") });
  };
  const output = await loadPrivateAssignments({ repository: "owner/private", token: "SECRET_TOKEN", fetcher });
  assert.deepEqual(calls, ["https://api.github.com/repos/owner/private", "https://api.github.com/repos/owner/private/contents/review-assignments.json"]);
  assert.equal(output.assignmentSource.status, "connected");
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE_CANARY|SECRET_TOKEN|owner\/private/);
});
test("공개 저장소·접근 실패·잘못된 JSON은 원문 노출 없이 실패한다", async () => {
  for (const fetcher of [
    async () => Response.json({ private: false }),
    async () => new Response("PRIVATE_CANARY", { status: 404 }),
    async () => { throw new Error("PRIVATE_CANARY"); },
    async (url) => url.endsWith("/contents/review-assignments.json") ? Response.json({ type: "file", encoding: "base64", content: Buffer.from("PRIVATE_CANARY").toString("base64") }) : Response.json({ private: true }),
  ]) {
    await assert.rejects(loadPrivateAssignments({ repository: "owner/private", token: "SECRET_TOKEN", fetcher }), (error) => !/PRIVATE_CANARY|SECRET_TOKEN/.test(error.message));
  }
});
