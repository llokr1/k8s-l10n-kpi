import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("성과 대시보드가 서버 렌더링된다", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Kubernetes 한국어 문서 기여 현황/);
  assert.match(html, /최근 수집 시각/);
  assert.match(html, /최신 데이터/);
  assert.match(html, /2026년 7월 11일/);
  assert.match(html, /kubernetes\/website/);
  assert.match(html, /통합 기여 현황/);
  assert.match(html, /생성한 이슈/);
  assert.match(html, /영문 최신 내용을 반영한 한국어 번역 완료율/);
  assert.match(html, /활동 전후 한국어 현지화 성과/);
  assert.match(html, /주당 평균 PR/);
  assert.match(html, /활동 전·후 기간을 달력으로 지정/);
  assert.match(html, /type="date"/);
  assert.match(html, /기본 비교로 초기화/);
  assert.match(html, /이슈 생성 → 머지 평균/);
  assert.doesNotMatch(html, /KubeLingoAssist|도구 경유 PR 비율/);
  assert.match(html, /12\.90[\s\S]{0,30}%/);
  assert.match(html, /13\.25[\s\S]{0,30}%/);
  assert.match(html, /\+[\s\S]{0,30}0\.35[\s\S]{0,30}%p/);
  assert.match(html, /해결/);
  assert.match(html, /진행 중/);
  assert.match(html, /PR 없이 종료/);
  assert.doesNotMatch(html, /이슈 해결 성과/);
  assert.doesNotMatch(html, /기여가 쌓여|Contribution Atlas|codex-preview|Your site is taking shape/);
});

test("동일 기간 전후 비교를 수집하고 도구 지표는 개요에서 제외한다", async () => {
  const dashboard = await readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8");
  const collector = await readFile(new URL("../scripts/collect-github.mjs", import.meta.url), "utf8");
  const metrics = JSON.parse(await readFile(new URL("../app/metrics.json", import.meta.url), "utf8"));
  assert.equal(metrics.projectComparison.before.durationDays, metrics.projectComparison.after.durationDays);
  assert.ok(metrics.projectComparison.records.length > 0);
  assert.equal(metrics.projectComparison.dataFrom, metrics.projectComparison.before.from);
  assert.equal(metrics.projectComparison.dataTo, metrics.projectComparison.after.to);
  assert.match(dashboard, /프로젝트 전체의 전후 변화/);
  assert.match(dashboard, /summarizeComparisonRange/);
  assert.match(dashboard, /setBeforeRange/);
  assert.match(dashboard, /setAfterRange/);
  assert.doesNotMatch(dashboard, /KubeLingoAssist|도구 경유 PR 비율|번역 완료 유지율/);
  assert.match(collector, /matched-period-korean-localization-prs/);
  assert.match(collector, /averageIssueToMergeDays/);
  assert.match(collector, /searchKoreanPullRequestsFromPage/);
  assert.match(collector, /k8s-kr\/kubelingoassist/);
});

test("활동 시작 전후 번역 완료율을 i18n Tracker 기준으로 수집한다", async () => {
  const dashboard = await readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8");
  const collector = await readFile(new URL("../scripts/collect-github.mjs", import.meta.url), "utf8");
  assert.match(dashboard, /Markdown 제목 구조가 일치/);
  assert.match(dashboard, /up_to_date/);
  assert.match(collector, /kubernetes-i18n-tracker/);
  assert.match(collector, /up_to_date/);
  assert.match(collector, /docs_concepts/);
  assert.match(collector, /changePercentagePoints/);
  assert.match(collector, /categories/);
  assert.match(dashboard, /문서 유형별 완료율/);
  assert.match(dashboard, /Concept/);
  assert.match(dashboard, /Task/);
  assert.match(dashboard, /Setup/);
  assert.match(dashboard, /Reference/);
});

test("이슈 종료를 머지 PR 해결과 일반 종료로 분리한다", async () => {
  const dashboard = await readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8");
  const collector = await readFile(new URL("../scripts/collect-github.mjs", import.meta.url), "utf8");
  assert.match(dashboard, /resolved_by_merged_pr/);
  assert.match(dashboard, /closed_without_merged_pr/);
  assert.match(collector, /issues\/.+\/timeline/);
  assert.match(collector, /cross-referenced/);
});

test("PR 중심의 통합 기여 현황 화면을 제공한다", async () => {
  const dashboard = await readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8");
  const collector = await readFile(new URL("../scripts/collect-github.mjs", import.meta.url), "utf8");
  assert.match(dashboard, /연결 이슈 · 관계 · 작성자/);
  assert.match(dashboard, /아카데미 리뷰어/);
  assert.match(dashboard, /멘토 제안 이슈/);
  assert.match(dashboard, /해결할 이슈/);
  assert.match(dashboard, /기타/);
  assert.match(dashboard, /외부 이슈 해결/);
  assert.match(dashboard, /<span>없음<\/span>/);
  assert.doesNotMatch(dashboard, /<span>일반 관계<\/span>/);
  assert.match(dashboard, /특이사항만/);
  assert.doesNotMatch(dashboard, /connectionSummary/);
  assert.doesNotMatch(dashboard, /확인할 특이사항/);
  assert.match(collector, /mentor_provided/);
  assert.match(collector, /primaryIssue/);
  assert.match(collector, /sourceType/);
  assert.doesNotMatch(dashboard, /new Set\(connection\.linkedIssues/);
  assert.match(collector, /extractPrBodyFromHtml/);
  assert.match(collector, /relationKind/);
});

test("활동 표가 작성자와 리뷰어를 구분한다", async () => {
  const dashboard = await readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /<span>작성자<\/span><span>리뷰어<\/span>/);
  assert.match(dashboard, /PR 작성자/);
  assert.match(dashboard, /item\.member\.name/);
});
