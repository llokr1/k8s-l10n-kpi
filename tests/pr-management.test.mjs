import test from "node:test";
import assert from "node:assert/strict";
import { reviewEvidence, workState, validateAssignment, workload, issueReferences } from "../lib/pr-management.mjs";

const review = (login, state, id = 1) => ({ id, user: { login }, state, submitted_at: `2026-09-11T01:00:0${id}Z`, html_url: "https://github.com/example", body: "" });
const comment = (login, body, id = 1) => ({ id, user: { login }, body, created_at: `2026-09-11T02:00:0${id}Z` });
const pr = { number: 1, author: "llokr1", state: "open", checkedAt: "2026-09-11", size: "size/L", completed: [] };
test("수동 배정은 팀원만 가능하며 대소문자와 중복을 정규화한다", () => {
  assert.deepEqual(validateAssignment(pr, { reviewers: ["BcKmini", "bckmini"] }).reviewers, ["bckmini"]);
  assert.deepEqual(validateAssignment(pr, { reviewers: ["SuperSon7"] }).reviewers, ["superson7"]);
  assert.throws(() => validateAssignment(pr, { reviewers: ["unknown-user"] }));
  assert.throws(() => validateAssignment(pr, { reviewers: ["llokr1"] }));
});
test("일반 댓글, 인용, 취소된 lgtm은 완료가 아니다", () => {
  const evidence = reviewEvidence([], [comment("a", "고생하셨습니다"), comment("b", "> /lgtm"), comment("c", "/lgtm"), comment("c", "/lgtm cancel", 2)], "author");
  assert.equal(evidence.completed.length, 0);
  assert.equal(evidence.lgtm.length, 0);
});
test("자발적 리뷰와 정식 리뷰를 보존하고 변경 요청·철회 리뷰를 완료에서 제외한다", () => {
  const evidence = reviewEvidence([review("OtherTeam", "COMMENTED"), review("a", "APPROVED"), review("a", "CHANGES_REQUESTED", 2), review("b", "DISMISSED")], [], "author");
  assert.deepEqual(evidence.completed.map((x) => x.login), ["otherteam"]);
});
test("배정된 모든 사람이 완료해야 Approver 점검이며 추가 자발적 리뷰는 방해하지 않는다", () => {
  assert.equal(workState(pr, {}), "unassigned");
  assert.equal(workState({ ...pr, completed: [{ login: "BcKmini" }, { login: "volunteer" }] }, { reviewers: ["bckmini"] }), "approver");
  assert.equal(workState({ ...pr, completed: [{ login: "volunteer" }] }, { reviewers: ["bckmini"] }), "reviewing");
  assert.equal(workState({ ...pr, state: "merged" }, {}), "merged");
  assert.equal(workState(pr, { notes: "번역 PR X" }), "excluded");
  assert.equal(workState({ ...pr, syncError: "rate limit" }, { reviewers: ["bckmini"] }), "unknown");
});
test("미완료 열린 PR만 잔여 가중치에 포함하고 종료 이력은 남긴다", () => {
  const result = workload([pr, { ...pr, number: 2, state: "merged" }], { 1: { reviewers: ["bckmini"] }, 2: { reviewers: ["bckmini"] } }, "bckmini");
  assert.equal(result.assigned, 2);
  assert.equal(result.pendingWeight, 60);
  assert.equal(result.totalWeight, 120);
});
test("다른 저장소 이슈를 website 이슈로 오인하지 않으며 주석과 코드는 제외한다", () => {
  const issues = issueReferences("Fixes #12\nRelated: other/repo#44\n<!-- Fixes #99 -->\n```\nfixes #88\n```");
  assert.deepEqual(issues.map((x) => [x.number, x.repository, x.kind]), [[12, "kubernetes/website", "closing"], [44, "other/repo", "related"]]);
});
test("리뷰 현황은 사이즈, 미배정 완료, 제외 PR과 과거 두 팀 배정을 구분한다", () => {
  const prs = [pr, {...pr,number:2,size:"size/XS",completed:[{login:"developowl"}]}, {...pr,number:3,size:"size/XXL"}, {...pr,number:4,size:null}];
  const assignments = {1:{legacyReviewers:["DevelopOwl"],reviewOverrides:{developowl:true}},3:{reviewers:["developowl"],excluded:true},4:{reviewers:["developowl"]}};
  const result = workload(prs,assignments,"developowl");
  assert.equal(result.assigned,2);
  assert.equal(result.completed,1);
  assert.equal(result.voluntary,1);
  assert.equal(result.sizes.L,1);
  assert.equal(result.sizes.XXL,0);
  assert.equal(result.totalWeight,60);
  assert.equal(result.unknownSize,1);
  assert.deepEqual(result.pendingNumbers,[4]);
});
