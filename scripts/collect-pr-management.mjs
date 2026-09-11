import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { issueReferences, reviewEvidence, loginKey } from "../lib/pr-management.mjs";
import { loadPrivateAssignments, validateAssignmentAuthors } from "../lib/private-assignments.mjs";

const config = JSON.parse(await readFile(resolve("data/pr-management-config.json"), "utf8"));
const output = resolve(process.env.PR_MANAGEMENT_OUTPUT || "app/pr-management.json");
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
let previous;
try { previous = JSON.parse(await readFile(output, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const rows = new Map((previous?.pullRequests || []).map((pr) => [pr.number, pr]));
const retainedNumbers = new Set(rows.keys());
const errors = [];
let discoveryComplete = false;
let rateLimited = false;
const checkedAt = new Date().toISOString();
// Fetch in memory before any output. Failure must never publish an empty replacement.
const assignmentData = await loadPrivateAssignments();
if (previous?.assignmentSource?.status === "connected" && assignmentData.assignmentSource.status !== "connected") {
  throw new Error("기존 Private 배정 연결 설정이 사라졌습니다. 배정 이력 유실을 막기 위해 중단합니다.");
}

async function github(path) {
  if (rateLimited) throw new Error("GitHub API 요청 한도에 도달했습니다. 기존 기록을 유지합니다.");
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ossca-pr-management", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    if ([403, 429].includes(response.status)) rateLimited = true;
    throw new Error(`GitHub HTTP ${response.status}${rateLimited ? " · 요청 한도 또는 권한 확인 필요" : ""}`);
  }
  return response.json();
}

async function pages(path) {
  const result = [];
  for (let page = 1; ; page++) {
    const values = await github(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!Array.isArray(values)) throw new Error("예상하지 못한 GitHub 응답입니다.");
    result.push(...values);
    if (values.length < 100) return result;
  }
}

async function discover(state, cutoff) {
  const result = [];
  for (let page = 1; ; page++) {
    const values = await github(`/repos/${config.repository}/pulls?${new URLSearchParams({ state, per_page: "100", page: String(page), sort: "created", direction: "desc" })}`);
    if (!Array.isArray(values)) throw new Error("예상하지 못한 PR 목록 응답입니다.");
    result.push(...values.filter((pr) => !cutoff || pr.created_at >= cutoff));
    if (values.length < 100 || (cutoff && values.at(-1).created_at < cutoff)) return result;
  }
}

function minimal(pr) {
  return { number: pr.number, title: pr.title, url: pr.html_url, author: loginKey(pr.user?.login), createdAt: pr.created_at, updatedAt: pr.updated_at, state: pr.state, draft: Boolean(pr.draft), labels: pr.labels.map((label) => label.name), checkedAt: null, reviews: [], completed: [], lgtm: [], approve: [], issues: [], files: [], translation: "unchecked" };
}

// Inspect every new PR's files, including PRs without a language label or [ko] title.
// Listing all states also catches PRs merged between scheduled runs.
try {
  const since = new Date(config.trackingStart).toISOString();
  const candidates = await discover("all", since);
  if (config.includeOpenBacklog) candidates.push(...(await discover("open", null)).filter((pr) => pr.labels.some((label) => label.name === "language/ko") || /^\[ko\]/i.test(pr.title)));
  for (const candidate of candidates) if (!rows.has(candidate.number)) rows.set(candidate.number, minimal(candidate));
  for (const key of Object.keys(assignmentData.assignments)) {
    const number = Number(key);
    if (!rows.has(number)) rows.set(number, { number, title: `PR #${number}`, url: `https://github.com/kubernetes/website/pull/${number}`, author: "", createdAt: "", state: "unknown", labels: [], checkedAt: null, reviews: [], completed: [], lgtm: [], approve: [], issues: [], files: [], translation: "unchecked" });
    retainedNumbers.add(number);
  }
  discoveryComplete = true;
} catch (error) { errors.push(`새 PR 검색: ${error.message}`); }

// Never delete a tracked row, including a label-removed, merged, closed or temporarily inaccessible PR.
for (const [number, previousPr] of rows) {
  if (rateLimited) {
    rows.set(number, { ...previousPr, syncError: "GitHub API 요청 한도 · 이전 기록 유지" });
    continue;
  }
  try {
    const base = `/repos/${config.repository}`;
    const detail = await github(`${base}/pulls/${number}`);
    const files = await pages(`${base}/pulls/${number}/files`);
    if (files.length < detail.changed_files) throw new Error("변경 파일 목록이 잘려 번역 대상 여부를 확인하지 못했습니다.");
    const koreanFiles = files.filter((file) => /^content\/ko\/.*\.md$/i.test(file.filename) && file.status !== "removed");
    const labeledKorean = detail.labels.some((label) => label.name === "language/ko") || /^\[ko\]/i.test(detail.title);
    if (!koreanFiles.length && !labeledKorean && !retainedNumbers.has(number)) { rows.delete(number); continue; }
    const reviews = await pages(`${base}/pulls/${number}/reviews`);
    const comments = await pages(`${base}/issues/${number}/comments`);
    const issues = [];
    for (const reference of issueReferences(detail.body)) {
      const issue = await github(`/repos/${reference.repository}/issues/${reference.number}`);
      if (!issue.pull_request) issues.push({ ...reference, title: issue.title, createdAt: issue.created_at, author: loginKey(issue.user?.login) });
    }
    rows.set(number, { ...minimal(detail), state: detail.merged_at ? "merged" : detail.state, mergedAt: detail.merged_at, closedAt: detail.closed_at, size: detail.labels.find((label) => label.name.startsWith("size/"))?.name || "", headSha: detail.head.sha, ...reviewEvidence(reviews, comments, detail.user.login), issues, files: koreanFiles.map((file) => file.filename), translation: koreanFiles.length ? "candidate" : "not-translation", checkedAt, syncError: null });
  } catch (error) {
    rows.set(number, { ...previousPr, syncError: error.message });
    errors.push(`#${number}: ${error.message}`);
  }
}

validateAssignmentAuthors(assignmentData.assignments, [...rows.values()]);
const snapshot = { version: 1, repository: config.repository, trackingStart: config.trackingStart, includeOpenBacklog: Boolean(config.includeOpenBacklog), ...assignmentData, generatedAt: checkedAt, lastSuccessfulAt: errors.length ? previous?.lastSuccessfulAt || null : checkedAt, discoveryComplete, errors, pullRequests: [...rows.values()].sort((a, b) => b.number - a.number) };
await mkdir(dirname(output), { recursive: true });
await writeFile(`${output}.tmp`, JSON.stringify(snapshot, null, 2) + "\n");
await rename(`${output}.tmp`, output);
if (!process.env.PR_MANAGEMENT_OUTPUT) {
  await mkdir("public/data", { recursive: true });
  await writeFile("public/data/pr-management.json", JSON.stringify(snapshot, null, 2) + "\n");
}
console.log(`PR ${rows.size}건 보존 · ${errors.length ? `오류 ${errors.length}건 (기존 데이터 유지)` : "수집 완료"}`);
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
