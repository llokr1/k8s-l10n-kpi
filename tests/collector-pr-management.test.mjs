import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const exec = promisify(execFile);
const collector = new URL("../scripts/collect-pr-management.mjs", import.meta.url).href;

async function runFixture(mode, previous) {
  const directory = await mkdtemp(join(tmpdir(), "ossca-pr-test-"));
  try {
    await mkdir(join(directory, "data"));
    await writeFile(join(directory, "data/pr-management-config.json"), JSON.stringify({ repository: "kubernetes/website", trackingStart: "2026-09-11T00:00:00+09:00", includeOpenBacklog: false }));
    const output = join(directory, "snapshot.json");
    if (previous) await writeFile(output, JSON.stringify(previous));
    const code = `
      const mode = ${JSON.stringify(mode)};
      const pr = { number: 100, title: 'Translate documentation', user: {login:'Alice'}, html_url:'https://github.com/kubernetes/website/pull/100', created_at:'2026-09-11T01:00:00Z', updated_at:'2026-09-11T02:00:00Z', state:'closed', merged_at:'2026-09-11T02:00:00Z', labels:[], changed_files:1, head:{sha:'abc'}, body:'' };
      globalThis.fetch = async (url) => {
        const path = new URL(url).pathname;
        if (path === '/repos/owner/private') return Response.json({private:true});
        if (path === '/repos/owner/private/contents/review-assignments.json') {
          if (mode === 'private-failure') return new Response('PRIVATE_CANARY', {status:404});
          const document = {version:1,repository:'kubernetes/website',assignments:{'100':{reviewers:['Bckmini'],excluded:false,notes:'PRIVATE_CANARY',deadline:'2026-12-31',approver:'PRIVATE_APPROVER'}}};
          return Response.json({type:'file',encoding:'base64',content:Buffer.from(JSON.stringify(document)).toString('base64')});
        }
        if (mode === 'failure' && !path.endsWith('/pulls')) return new Response('',{status:503});
        if (path.endsWith('/pulls')) return Response.json(mode === 'failure' ? [] : [pr]);
        if (path.endsWith('/files')) return Response.json([{filename:mode === 'non-korean' ? 'content/en/a.md':'content/ko/a.md',status:'modified'}]);
        if (path.endsWith('/reviews') || path.endsWith('/comments')) return Response.json([]);
        return Response.json(pr);
      };
      await import(${JSON.stringify(collector)});
    `;
    let exitCode = 0;
    try { await exec(process.execPath, ["--input-type=module", "-e", code], { cwd: directory, env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "", PR_ASSIGNMENTS_REPOSITORY: mode.startsWith("private") ? "owner/private" : "", PR_ASSIGNMENTS_TOKEN: mode.startsWith("private") ? "SECRET_TOKEN" : "", PR_MANAGEMENT_OUTPUT: output } }); }
    catch (error) { exitCode = error.code; }
    return { exitCode, data: JSON.parse(await readFile(output, "utf8")) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("수집 사이에 머지된 PR과 라벨 없는 한국어 PR도 보존한다", async () => {
  const { exitCode, data } = await runFixture("merged");
  assert.equal(exitCode, 0);
  assert.equal(data.pullRequests.length, 1);
  assert.equal(data.pullRequests[0].state, "merged");
  assert.equal(data.pullRequests[0].author, "alice");
  assert.equal(data.pullRequests[0].translation, "candidate");
});
test("Private 배정을 공개 PR과 병합하되 내부 내용은 출력하지 않는다", async () => {
  const { exitCode, data } = await runFixture("private");
  assert.equal(exitCode, 0);
  assert.equal(data.assignmentSource.status, "connected");
  assert.deepEqual(data.assignments, { "100": { reviewers: ["bckmini"], excluded: false } });
  assert.equal(data.pullRequests[0].state, "merged");
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE_CANARY|PRIVATE_APPROVER|SECRET_TOKEN|2026-12-31/);
});
test("Private 읽기 실패는 이전 출력 파일을 변경하지 않는다", async () => {
  const previous = { pullRequests: [{ number: 99 }], assignments: { "99": { reviewers: ["jiyubaek"] } }, assignmentSource: { status: "connected" } };
  const { exitCode, data } = await runFixture("private-failure", previous);
  assert.equal(exitCode, 1);
  assert.deepEqual(data, previous);
});
test("연결 설정이 사라져도 기존 배정을 빈 데이터로 덮지 않는다", async () => {
  const previous = { pullRequests: [], assignments: {}, assignmentSource: { status: "connected" } };
  const { exitCode, data } = await runFixture("merged", previous);
  assert.equal(exitCode, 1);
  assert.deepEqual(data, previous);
});
test("한국어 변경이 없고 후보 라벨도 없는 신규 PR은 제외한다", async () => {
  const { data } = await runFixture("non-korean");
  assert.equal(data.pullRequests.length, 0);
});
test("API 장애가 발생해도 기존 PR과 마지막 성공 수집 시각을 보존한다", async () => {
  const previous = { lastSuccessfulAt: "2026-09-11T01:00:00Z", pullRequests: [{ number: 99, title: "Existing PR", state: "open", checkedAt: "2026-09-11T01:00:00Z" }] };
  const { exitCode, data } = await runFixture("failure", previous);
  assert.equal(exitCode, 1);
  assert.equal(data.pullRequests[0].number, 99);
  assert.equal(data.pullRequests[0].title, "Existing PR");
  assert.match(data.pullRequests[0].syncError, /503/);
  assert.equal(data.lastSuccessfulAt, previous.lastSuccessfulAt);
});
