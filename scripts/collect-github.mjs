import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const OWNER = process.env.GITHUB_OWNER || "kubernetes";
const REPO = process.env.GITHUB_REPO || "website";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
const ACTIVITY_START = process.env.GITHUB_ACTIVITY_START || "2026-07-11";
const MEMBERS_PATH = resolve(process.env.MEMBERS_CSV || "data/members.csv");
const MENTORS_PATH = resolve(process.env.MENTORS_CSV || "data/mentors.csv");
const OUTPUT_PATH = resolve(process.env.METRICS_OUTPUT || "app/metrics.json");
const PUBLIC_OUTPUT_PATH = resolve("public/data/metrics.json");
const ISSUE_RESOLUTION_CACHE_PATH = resolve(process.env.ISSUE_RESOLUTION_CACHE || "data/issue-resolution-cache.json");
const PR_CONNECTION_CACHE_PATH = resolve(process.env.PR_CONNECTION_CACHE || "data/pr-issue-connection-cache.json");
const LINKED_ISSUE_CACHE_PATH = resolve(process.env.LINKED_ISSUE_CACHE || "data/linked-issue-cache.json");
const I18N_TRACKER_BASE_URL = process.env.I18N_TRACKER_BASE_URL || "https://kfess.github.io/kubernetes-i18n-tracker";
const I18N_TRACKER_DOC_CATEGORIES = ["docs_concepts", "docs_contribute", "docs_home", "docs_reference", "docs_setup", "docs_tasks", "docs_tutorials"];
const TRANSLATION_COMPLETION_START = {
  commitSha: "e6cce326b1bb3ed4f3617aab3db277f1f7232964",
  asOf: "2026-07-10T16:47:45Z",
  totalDocuments: 1675,
  completedDocuments: 216,
  completionPercent: 12.9,
  statusCounts: { up_to_date: 216, outdated: 304, possibly_outdated: 5, not_translated: 1150 },
};
const API_VERSION = "2022-11-28";
const REUSE_EXISTING_ACTIVITY = process.env.REUSE_EXISTING_ACTIVITY === "1";
const USE_ISSUE_RESOLUTION_CACHE = process.env.USE_ISSUE_RESOLUTION_CACHE === "1";
const USE_PR_CONNECTION_CACHE = process.env.USE_PR_CONNECTION_CACHE === "1";
const USE_PR_HTML_FALLBACK = process.env.USE_PR_HTML_FALLBACK === "1";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function parseMembers(csv) {
  return csv.trim().split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
    const [name, githubId] = line.split(",").map((value) => value.trim());
    return { name, githubId: githubId.toLowerCase() };
  });
}

function extractIssueRelations(body) {
  if (!body) return [];
  const relations = new Map();
  const strength = { mention: 1, related: 2, closing: 3 };
  const repository = `${OWNER}/${REPO}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const referencePattern = new RegExp(`(?:https?:\\/\\/github\\.com\\/${repository}\\/issues\\/|(?:${repository})?#)(\\d+)`, "gi");
  let previousLine = "";
  for (const line of body.replaceAll("\r", "").split("\n")) {
    const references = [...line.matchAll(referencePattern)];
    for (const reference of references) {
      const context = `${previousLine} ${line.slice(0, reference.index)}`.slice(-180);
      const closing = [...context.matchAll(/\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s*/gi)].at(-1);
      const related = [...context.matchAll(/\b(related(?:\s+to)?|relates(?:\s+to)?|references?|refs?|part\s+of|see|issue|관련(?:된)?(?:\s+이슈)?|참조)\b\s*:?\s*/gi)].at(-1);
      const relationKind = closing && (!related || closing.index > related.index) ? "closing" : related ? "related" : "mention";
      const keyword = relationKind === "closing" ? closing?.[1] : relationKind === "related" ? related?.[1] : "본문 언급";
      const number = Number(reference[1]);
      const current = relations.get(number);
      if (!current || strength[relationKind] > strength[current.relationKind]) relations.set(number, { number, relationKind, keyword: keyword || "본문 언급" });
    }
    if (line.trim()) previousLine = line.trim().slice(-120);
  }
  return [...relations.values()];
}

function decodeHtml(value) {
  return value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function extractPrBodyFromHtml(html) {
  const fragment = html.match(/<task-lists[^>]*>\s*<div class="comment-body markdown-body js-comment-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/task-lists>/i)?.[1];
  if (!fragment) return "";
  return decodeHtml(fragment.replace(/<a[^>]+href="https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)"[^>]*>[\s\S]*?<\/a>/gi, " #$1 ").replace(/<(?:br|\/p|\/li|\/h[1-6]|\/div)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim());
}

async function github(path, { search = false, attempt = 0 } = {}) {
  let response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "ossca-k8s-kpi-dashboard",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    });
  } catch (error) {
    if (attempt >= 4) throw error;
    const wait = 2 ** attempt * 2_000;
    console.log(`  네트워크 오류 재시도 ${attempt + 1}/4 · ${wait / 1000}초 후`);
    await sleep(wait);
    return github(path, { search, attempt: attempt + 1 });
  }

  if (response.status === 403 || response.status === 429) {
    const reset = Number(response.headers.get("x-ratelimit-reset") || 0) * 1000;
    const wait = Math.max(reset - Date.now() + 1500, 10_000);
    console.log(`  API 한도 대기 ${Math.ceil(wait / 1000)}초`);
    await sleep(wait);
    return github(path, { search, attempt });
  }

  if (response.status >= 500 && attempt < 4) {
    const wait = 2 ** attempt * 2_000;
    console.log(`  GitHub API ${response.status} 재시도 ${attempt + 1}/4 · ${wait / 1000}초 후`);
    await sleep(wait);
    return github(path, { search, attempt: attempt + 1 });
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API ${response.status}: ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  if (search && !TOKEN) await sleep(6_500);
  return data;
}

async function githubPage(path, attempt = 0) {
  const response = await fetch(`https://github.com/${OWNER}/${REPO}${path}`, { headers: { "User-Agent": "ossca-k8s-kpi-dashboard" } });
  if ((!response.ok || response.status >= 500) && attempt < 4) {
    await sleep(2 ** attempt * 1_000);
    return githubPage(path, attempt + 1);
  }
  if (!response.ok) throw new Error(`GitHub page ${response.status}: ${path}`);
  return response.text();
}

async function searchAll(query) {
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const params = new URLSearchParams({ q: query, per_page: "100", page: String(page), sort: "created", order: "desc" });
    const result = await github(`/search/issues?${params}`, { search: true });
    items.push(...result.items);
    if (result.items.length < 100 || items.length >= result.total_count) break;
  }
  return items;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function average(values) {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Number(value.toFixed(2));
}

function elapsedDays(from, to) {
  if (!from || !to) return null;
  const value = (new Date(to).getTime() - new Date(from).getTime()) / DAY_MS;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function searchKoreanPullRequests(qualifier) {
  const query = `repo:${OWNER}/${REPO} is:pr [ko] in:title ${qualifier}`;
  if (!TOKEN) return searchKoreanPullRequestsFromPage(qualifier);
  try {
    return await searchAll(query);
  } catch (error) {
    console.warn(`  한국어 PR API 검색 실패 · 공개 페이지로 재시도: ${error.message}`);
    return searchKoreanPullRequestsFromPage(qualifier);
  }
}

function parseEmbeddedPullRequest(html, number) {
  for (const match of html.matchAll(/<script type="application\/json" data-target="react-app\.embeddedData">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(match[1]);
      const pull = data.payload?.pullRequestsConversationsRoute?.pullRequestsLayoutRoute?.pullRequest;
      if (pull?.number) return pull;
    } catch {
      // GitHub 페이지의 다른 JSON 블록은 무시합니다.
    }
  }
  const createdTime = html.match(/"createdTime":"([^"]+)"/)?.[1];
  const mergedTime = html.match(/"mergedTime":"([^"]+)"/)?.[1];
  const title = decodeHtml(html.match(/<meta\s+property="og:title"\s+content="([\s\S]*?)"\s*\/?>/i)?.[1] || "").replace(/ by [\s\S]*$/, "");
  return createdTime ? { number, title: title || `[ko] PR #${number}`, author: { login: "unknown" }, createdTime, mergedTime: mergedTime || null, closedTime: mergedTime || null } : null;
}

async function searchKoreanPullRequestsFromPage(qualifier) {
  const query = `is:pr [ko] in:title ${qualifier}`;
  const firstHtml = await githubPage(`/pulls?q=${encodeURIComponent(query)}`);
  const openCounts = [...firstHtml.matchAll(/([\d,]+)\s*Open/g)].map((match) => Number(match[1].replaceAll(",", "")));
  const closedCounts = [...firstHtml.matchAll(/([\d,]+)\s*Closed/g)].map((match) => Number(match[1].replaceAll(",", "")));
  const total = Math.max(...openCounts, 0) + Math.max(...closedCounts, 0);
  const numbers = new Set();
  for (let page = 1; page <= 10; page += 1) {
    const html = page === 1 ? firstHtml : await githubPage(`/pulls?q=${encodeURIComponent(query)}&page=${page}`);
    const before = numbers.size;
    for (const match of html.matchAll(/id="issue_(\d+)_link"/g)) numbers.add(Number(match[1]));
    if (numbers.size === before || total && numbers.size >= total) break;
  }
  return mapLimit([...numbers], 6, async (number) => {
    const html = await githubPage(`/pull/${number}`);
    const pull = parseEmbeddedPullRequest(html, number);
    if (!pull) throw new Error(`PR #${number} 공개 페이지 데이터 추출 실패`);
    return {
      number,
      title: pull.title,
      html_url: `https://github.com/${OWNER}/${REPO}/pull/${number}`,
      user: { login: pull.author?.login || "unknown" },
      created_at: pull.createdTime,
      updated_at: pull.mergedTime || pull.createdTime,
      closed_at: pull.closedTime,
      pull_request: { merged_at: pull.mergedTime },
      body: extractPrBodyFromHtml(html),
      labels: [],
      comments: 0,
      fromHtml: true,
    };
  });
}

async function collectComparisonRecords(from, to) {
  const range = `${from}..${to}`;
  const created = await searchKoreanPullRequests(`created:${range}`);
  const merged = await searchKoreanPullRequests(`is:merged merged:${range}`);
  const byNumber = new Map(created.map((item) => {
    const pr = compact(item);
    return [pr.number, { ...pr, issueCreatedAt: null }];
  }));
  for (const item of merged) {
    const pr = compact(item);
    byNumber.set(pr.number, { ...(byNumber.get(pr.number) || {}), ...pr, issueCreatedAt: null });
  }
  const compactMerged = merged.map((item) => byNumber.get(item.number));
  const fromHtml = merged.some((pr) => pr.fromHtml);
  const issueNumbers = [...new Set(compactMerged.flatMap((pr) => (pr.issueRelations || []).filter((relation) => relation.relationKind === "closing").slice(0, 1).map((relation) => relation.number)))];
  const issueEntries = await mapLimit(issueNumbers, TOKEN ? 6 : 2, async (number) => {
    try {
      return [number, fromHtml ? await fetchIssueDetailFromPage(number) : await fetchIssueDetail(number)];
    } catch {
      return [number, null];
    }
  });
  const issueByNumber = new Map(issueEntries);
  for (const pr of compactMerged) {
    const closing = (pr.issueRelations || []).find((relation) => relation.relationKind === "closing");
    if (closing) pr.issueCreatedAt = issueByNumber.get(closing.number)?.createdAt || null;
  }
  return [...byNumber.values()].map((pr) => ({ number: pr.number, createdAt: pr.createdAt, mergedAt: pr.mergedAt, issueCreatedAt: pr.issueCreatedAt })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function summarizeComparisonPeriod(from, to, records) {
  const created = records.filter((pr) => pr.createdAt?.slice(0, 10) >= from && pr.createdAt.slice(0, 10) <= to);
  const merged = records.filter((pr) => pr.mergedAt?.slice(0, 10) >= from && pr.mergedAt.slice(0, 10) <= to);
  const prCycleDays = merged.map((pr) => elapsedDays(pr.createdAt, pr.mergedAt)).filter((value) => value !== null);
  const issueCycleDays = merged.map((pr) => elapsedDays(pr.issueCreatedAt, pr.mergedAt)).filter((value) => value !== null);
  const durationDays = Math.floor((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS) + 1;
  return {
    from,
    to,
    durationDays,
    createdPullRequests: created.length,
    weeklyAveragePullRequests: Number((created.length / durationDays * 7).toFixed(2)),
    mergedPullRequests: merged.length,
    averagePrToMergeDays: average(prCycleDays),
    medianPrToMergeDays: median(prCycleDays),
    prCycleSampleSize: prCycleDays.length,
    averageIssueToMergeDays: average(issueCycleDays),
    medianIssueToMergeDays: median(issueCycleDays),
    issueCycleSampleSize: issueCycleDays.length,
  };
}

async function fetchProjectComparison() {
  const activityStart = new Date(`${ACTIVITY_START}T00:00:00Z`);
  const collectionDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (collectionDate < activityStart) return null;
  const durationDays = Math.floor((collectionDate.getTime() - activityStart.getTime()) / DAY_MS) + 1;
  const beforeTo = addUtcDays(activityStart, -1);
  const beforeFrom = addUtcDays(beforeTo, -(durationDays - 1));
  const dataFrom = isoDate(beforeFrom);
  const dataTo = isoDate(collectionDate);
  const records = await collectComparisonRecords(dataFrom, dataTo);
  const before = summarizeComparisonPeriod(dataFrom, isoDate(beforeTo), records);
  const after = summarizeComparisonPeriod(ACTIVITY_START, dataTo, records);
  return {
    methodology: "matched-period-korean-localization-prs",
    scope: "kubernetes/website의 [ko] 제목 규칙을 사용한 한국어 현지화 PR",
    activityStart: ACTIVITY_START,
    durationDays,
    dataFrom,
    dataTo,
    records,
    before,
    after,
  };
}

async function fetchSustainabilityTool() {
  if (!TOKEN) {
    const repositoryUrl = "https://github.com/k8s-kr/kubelingoassist";
    const [response, releasesResponse] = await Promise.all([
      fetch(repositoryUrl, { headers: { "User-Agent": "ossca-k8s-kpi-dashboard" } }),
      fetch(`${repositoryUrl}/releases`, { headers: { "User-Agent": "ossca-k8s-kpi-dashboard" } }),
    ]);
    if (!response.ok || !releasesResponse.ok) throw new Error(`GitHub page ${response.status}/${releasesResponse.status}: k8s-kr/kubelingoassist`);
    const [html, releasesHtml] = await Promise.all([response.text(), releasesResponse.text()]);
    const commitCount = Number(html.match(/"commitCount":"([\d,]+)"/)?.[1]?.replaceAll(",", "") || html.match(/([\d,]+)\s+Commits?/)?.[1]?.replaceAll(",", "") || 0);
    const versions = [...new Set([...releasesHtml.matchAll(/\/k8s-kr\/kubelingoassist\/releases\/tag\/([^"?#]+)/g)].map((match) => decodeURIComponent(match[1])))];
    const releaseCount = versions.length;
    const latestVersion = versions[0] || null;
    const cacheTimestamp = Number(html.match(/"listCacheKey":"v0:([\d.]+)/)?.[1] || 0);
    const lastUpdatedAt = cacheTimestamp ? new Date(cacheTimestamp * 1000).toISOString() : new Date().toISOString();
    return { repositoryUrl, description: "VS Code extension for translating Kubernetes documentation", releaseCount, latestVersion, latestReleaseAt: null, commitCount, commitCountIsMinimum: false, lastUpdatedAt };
  }
  const [repository, releases, commits] = await Promise.all([
    github("/repos/k8s-kr/kubelingoassist"),
    github("/repos/k8s-kr/kubelingoassist/releases?per_page=100"),
    github("/repos/k8s-kr/kubelingoassist/commits?per_page=100"),
  ]);
  return {
    repositoryUrl: repository.html_url,
    description: repository.description,
    releaseCount: releases.length,
    latestVersion: releases[0]?.tag_name || null,
    latestReleaseAt: releases[0]?.published_at || null,
    commitCount: commits.length,
    commitCountIsMinimum: commits.length === 100,
    lastUpdatedAt: repository.pushed_at,
  };
}

async function fetchTrackerMatrix(category, attempt = 0) {
  const response = await fetch(`${I18N_TRACKER_BASE_URL}/data/matrix/${category}.json`, { headers: { "User-Agent": "ossca-k8s-kpi-dashboard" } });
  if ((!response.ok || response.status >= 500) && attempt < 3) {
    await sleep(2 ** attempt * 1_000);
    return fetchTrackerMatrix(category, attempt + 1);
  }
  if (!response.ok) throw new Error(`i18n tracker ${response.status}: ${category}`);
  return response.json();
}

async function fetchTranslationCompletion() {
  const matrices = await Promise.all(I18N_TRACKER_DOC_CATEGORIES.map(fetchTrackerMatrix));
  const articles = matrices.flatMap((matrix) => matrix.articles || []);
  const statusCounts = { up_to_date: 0, outdated: 0, possibly_outdated: 0, not_translated: 0 };
  for (const article of articles) {
    const status = article.translations?.ko?.status || "not_translated";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  const completedDocuments = statusCounts.up_to_date;
  const current = {
    asOf: matrices.map((matrix) => matrix.lastUpdated).filter(Boolean).sort().at(-1) || new Date().toISOString(),
    totalDocuments: articles.length,
    completedDocuments,
    completionPercent: articles.length ? Number((completedDocuments / articles.length * 100).toFixed(2)) : 0,
    statusCounts,
  };
  return {
    methodology: "kubernetes-i18n-tracker-up-to-date",
    sourceUrl: `${I18N_TRACKER_BASE_URL}/?page=1&lang=ko`,
    startDate: ACTIVITY_START,
    start: TRANSLATION_COMPLETION_START,
    current,
    changePercentagePoints: Number((current.completionPercent - TRANSLATION_COMPLETION_START.completionPercent).toFixed(2)),
    completedDocumentChange: current.completedDocuments - TRANSLATION_COMPLETION_START.completedDocuments,
  };
}

function compact(item) {
  const mergedAt = item.pull_request?.merged_at || null;
  const result = {
    number: item.number,
    title: item.title,
    url: item.html_url,
    author: item.user?.login || "unknown",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    closedAt: item.closed_at,
    mergedAt,
    state: mergedAt ? "merged" : item.state,
    comments: item.comments || 0,
    labels: (item.labels || []).map((label) => typeof label === "string" ? label : label.name).filter(Boolean),
    isKorean: /^\[ko\]/i.test(item.title) || (item.labels || []).some((label) => /language\/ko|area\/localization\/ko/i.test(typeof label === "string" ? label : label.name || "")),
  };
  if (item.pull_request) {
    result.issueRelations = extractIssueRelations(item.body);
    result.connectionChecked = true;
  }
  return result;
}

async function fetchPullConnection(pr) {
  const detail = await github(`/repos/${OWNER}/${REPO}/pulls/${pr.number}`);
  return { ...pr, issueRelations: extractIssueRelations(detail.body), connectionChecked: true };
}

async function fetchPullConnectionFromPage(pr) {
  const html = await githubPage(`/pull/${pr.number}`);
  const body = extractPrBodyFromHtml(html);
  if (!body) throw new Error(`PR #${pr.number} 본문 추출 실패`);
  return { ...pr, issueRelations: extractIssueRelations(body), connectionChecked: true };
}

async function fetchIssueDetail(number) {
  return compact(await github(`/repos/${OWNER}/${REPO}/issues/${number}`));
}

async function fetchIssueDetailFromPage(number) {
  const html = await githubPage(`/issues/${number}`);
  const title = html.match(/<meta\s+property="og:title"\s+content="([\s\S]*?)"\s*\/?\s*>/i)?.[1]?.replace(/ · Issue #[\s\S]*$/, "") || `이슈 #${number}`;
  const author = html.match(/<meta\s+property="og:author:username"\s+content="([^"]+)"/i)?.[1] || "unknown";
  const createdAt = html.match(/"createdAt":"([^"]+)"/)?.[1] || html.match(/<relative-time[^>]+datetime="([^"]+)"/i)?.[1] || "";
  const closed = /data-status="issueClosed"|State--closed|>Closed<\/span>/i.test(html);
  return { number, title, url: `https://github.com/${OWNER}/${REPO}/issues/${number}`, author, createdAt, updatedAt: createdAt, closedAt: null, mergedAt: null, state: closed ? "closed" : "open", comments: 0, labels: [], isKorean: /^\[ko\]/i.test(title) };
}

async function enrichPull(pr) {
  const detail = await github(`/repos/${OWNER}/${REPO}/pulls/${pr.number}`);
  const files = [];
  for (let page = 1; page <= Math.ceil((detail.changed_files || 0) / 100) || page === 1; page += 1) {
    const batch = await github(`/repos/${OWNER}/${REPO}/pulls/${pr.number}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if (batch.length < 100) break;
  }
  const koFiles = files.filter((file) => file.filename.startsWith("content/ko/") || file.filename.startsWith("i18n/ko/"));
  return {
    ...pr,
    additions: detail.additions || 0,
    deletions: detail.deletions || 0,
    changedFiles: detail.changed_files || 0,
    koFiles: koFiles.length,
    koAdditions: koFiles.reduce((sum, file) => sum + (file.additions || 0), 0),
    koDeletions: koFiles.reduce((sum, file) => sum + (file.deletions || 0), 0),
    isKorean: koFiles.length > 0 || pr.isKorean,
  };
}

async function fetchReviews(number) {
  const reviews = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await github(`/repos/${OWNER}/${REPO}/pulls/${number}/reviews?per_page=100&page=${page}`);
    reviews.push(...batch);
    if (batch.length < 100) break;
  }
  return reviews;
}

async function fetchIssueTimeline(number) {
  const events = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await github(`/repos/${OWNER}/${REPO}/issues/${number}/timeline?per_page=100&page=${page}`);
    events.push(...batch);
    if (batch.length < 100) break;
  }
  return events;
}

function referencesIssue(body, number) {
  if (!body) return false;
  const escaped = String(number).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const closingKeyword = String.raw`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)`;
  const localReference = String.raw`(?:${OWNER}\/${REPO})?#${escaped}\b`;
  const issueUrl = String.raw`https?:\/\/github\.com\/${OWNER}\/${REPO}\/issues\/${escaped}\b`;
  return new RegExp(String.raw`${closingKeyword}\s*:?\s*(?:${localReference}|${issueUrl})`, "i").test(body);
}

async function enrichIssueResolution(issue) {
  if (issue.state === "open") return { ...issue, resolution: "open", closingPullRequest: null };

  const timeline = await fetchIssueTimeline(issue.number);
  const closedEvent = timeline.filter((event) => event.event === "closed").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
  const closedAt = new Date(closedEvent?.created_at || issue.closedAt || 0).getTime();
  const mergedReferences = timeline.filter((event) => event.event === "cross-referenced" && event.source?.issue?.pull_request?.merged_at).map((event) => {
    const source = event.source.issue;
    const mergedAt = source.pull_request.merged_at;
    const mergeGap = closedAt - new Date(mergedAt).getTime();
    return {
      source,
      mergedAt,
      hasClosingKeyword: referencesIssue(source.body, issue.number),
      closesAtSameTime: mergeGap >= 0 && mergeGap <= 5 * 60 * 1000,
      mergeGap,
    };
  });
  const confirmed = mergedReferences.filter((item) => item.hasClosingKeyword || item.closesAtSameTime).sort((a, b) => a.mergeGap - b.mergeGap)[0];

  if (confirmed) {
    return {
      ...issue,
      resolution: "resolved_by_merged_pr",
      closingPullRequest: {
        number: confirmed.source.number,
        title: confirmed.source.title,
        url: confirmed.source.pull_request.html_url,
        author: confirmed.source.user?.login || "unknown",
        mergedAt: confirmed.mergedAt,
      },
    };
  }

  return {
    ...issue,
    resolution: mergedReferences.length ? "unknown" : "closed_without_merged_pr",
    closingPullRequest: null,
  };
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

const memberRows = parseMembers(await readFile(MEMBERS_PATH, "utf8"));
let mentorRows = [];
try {
  mentorRows = parseMembers(await readFile(MENTORS_PATH, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const members = [];
const issueResolutionCache = new Map();
const prConnectionCache = new Map();
let existingPayload = null;

try {
  existingPayload = JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

try {
  const cached = JSON.parse(await readFile(ISSUE_RESOLUTION_CACHE_PATH, "utf8"));
  for (const [number, resolution] of Object.entries(cached)) issueResolutionCache.set(Number(number), resolution);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

try {
  const cached = JSON.parse(await readFile(PR_CONNECTION_CACHE_PATH, "utf8"));
  for (const [number, relations] of Object.entries(cached)) prConnectionCache.set(Number(number), relations.map((relation) => typeof relation === "number" ? { number: relation, relationKind: "closing", keyword: "검증 캐시" } : relation));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (REUSE_EXISTING_ACTIVITY) {
  if (!existingPayload) throw new Error(`Existing metrics not found: ${OUTPUT_PATH}`);
  members.push(...existingPayload.members);
  console.log(`${OWNER}/${REPO}: 기존 활동 데이터 재사용 · 이슈 해결 경로만 갱신`);
} else {
  console.log(`${OWNER}/${REPO}: ${memberRows.length}명 활동 수집 시작 · ${ACTIVITY_START} 이후${TOKEN ? " (인증됨)" : " (공개 API)"}`);
  for (const [index, member] of memberRows.entries()) {
    console.log(`[${index + 1}/${memberRows.length}] ${member.name} (@${member.githubId})`);
    const authored = await searchAll(`repo:${OWNER}/${REPO} author:${member.githubId} created:>=${ACTIVITY_START}`);
    const reviewed = await searchAll(`repo:${OWNER}/${REPO} is:pr reviewed-by:${member.githubId} -author:${member.githubId} updated:>=${ACTIVITY_START}`);
    members.push({
      ...member,
      issues: authored.filter((item) => !item.pull_request).map(compact),
      pullRequests: authored.filter((item) => item.pull_request).map(compact),
      reviewedPullRequests: reviewed.map(compact),
    });
  }
}

const closedIssues = members.flatMap((member) => member.issues.filter((issue) => issue.state === "closed").map((issue) => ({ githubId: member.githubId, issue })));
console.log(`닫힌 이슈 해결 경로 분석: 이슈 ${closedIssues.length}개`);
const enrichedIssues = await mapLimit(closedIssues, TOKEN ? 5 : 2, async ({ githubId, issue }) => {
  const cached = issueResolutionCache.get(issue.number);
  if (USE_ISSUE_RESOLUTION_CACHE && cached) return { githubId, issue: { ...issue, ...cached } };
  try {
    return { githubId, issue: await enrichIssueResolution(issue) };
  } catch {
    console.warn(`  #${issue.number} 타임라인 조회 실패 · ${cached ? "검증 캐시 사용" : "판정 불가 처리"}`);
    return { githubId, issue: cached ? { ...issue, ...cached } : { ...issue, resolution: "unknown", closingPullRequest: null } };
  }
});
const issuesByMember = new Map();
for (const member of members) issuesByMember.set(member.githubId, member.issues.filter((issue) => issue.state === "open").map((issue) => ({ ...issue, resolution: "open", closingPullRequest: null })));
for (const item of enrichedIssues) issuesByMember.get(item.githubId).push(item.issue);
for (const member of members) member.issues = (issuesByMember.get(member.githubId) || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
for (const item of enrichedIssues) issueResolutionCache.set(item.issue.number, { resolution: item.issue.resolution, closingPullRequest: item.issue.closingPullRequest });
await mkdir(dirname(ISSUE_RESOLUTION_CACHE_PATH), { recursive: true });
await writeFile(ISSUE_RESOLUTION_CACHE_PATH, `${JSON.stringify(Object.fromEntries([...issueResolutionCache.entries()].sort(([a], [b]) => a - b)), null, 2)}\n`);

const pullsMissingConnections = members.flatMap((member) => member.pullRequests.filter((pr) => !Array.isArray(pr.issueRelations) || USE_PR_HTML_FALLBACK).map((pr) => ({ githubId: member.githubId, pr })));
if (pullsMissingConnections.length) {
  console.log(`PR-이슈 연결 보강: PR ${pullsMissingConnections.length}개`);
  const connected = await mapLimit(pullsMissingConnections, TOKEN ? 5 : 2, async ({ githubId, pr }) => {
    const cached = prConnectionCache.get(pr.number);
    if (USE_PR_HTML_FALLBACK) {
      try {
        return { githubId, pr: await fetchPullConnectionFromPage(pr) };
      } catch {
        console.warn(`  PR #${pr.number} 공개 페이지 연결 조회 실패`);
        return { githubId, pr: cached ? { ...pr, issueRelations: cached, connectionChecked: true } : { ...pr, issueRelations: [], connectionChecked: false } };
      }
    }
    if (USE_PR_CONNECTION_CACHE && cached) return { githubId, pr: { ...pr, issueRelations: cached, connectionChecked: true } };
    if (USE_PR_CONNECTION_CACHE) return { githubId, pr: { ...pr, issueRelations: [], connectionChecked: false } };
    try {
      return { githubId, pr: await fetchPullConnection(pr) };
    } catch {
      console.warn(`  PR #${pr.number} 연결 조회 실패 · 판정 불가 처리`);
      return { githubId, pr: cached ? { ...pr, issueRelations: cached, connectionChecked: true } : { ...pr, issueRelations: [], connectionChecked: false } };
    }
  });
  const connectedByMember = new Map();
  for (const item of connected) {
    if (!connectedByMember.has(item.githubId)) connectedByMember.set(item.githubId, new Map());
    connectedByMember.get(item.githubId).set(item.pr.number, item.pr);
  }
  for (const member of members) member.pullRequests = member.pullRequests.map((pr) => connectedByMember.get(member.githubId)?.get(pr.number) || pr);
}
for (const member of members) for (const pr of member.pullRequests) if (pr.connectionChecked) prConnectionCache.set(pr.number, pr.issueRelations || []);
await mkdir(dirname(PR_CONNECTION_CACHE_PATH), { recursive: true });
await writeFile(PR_CONNECTION_CACHE_PATH, `${JSON.stringify(Object.fromEntries([...prConnectionCache.entries()].sort(([a], [b]) => a - b)), null, 2)}\n`);

if (TOKEN) {
  const authoredPulls = members.flatMap((member) => member.pullRequests.map((pr) => ({ githubId: member.githubId, pr })));
  console.log(`한국어 문서 영향 분석: PR ${authoredPulls.length}개`);
  const enriched = await mapLimit(authoredPulls, 5, async ({ githubId, pr }, index) => {
    if ((index + 1) % 20 === 0) console.log(`  ${index + 1}/${authoredPulls.length}`);
    return { githubId, pr: await enrichPull(pr) };
  });
  const byMember = new Map();
  for (const item of enriched) {
    if (!byMember.has(item.githubId)) byMember.set(item.githubId, []);
    byMember.get(item.githubId).push(item.pr);
  }
  for (const member of members) member.pullRequests = byMember.get(member.githubId) || [];

}

if (!REUSE_EXISTING_ACTIVITY) {
  const reviewedNumbers = [...new Set(members.flatMap((member) => member.reviewedPullRequests.map((pr) => pr.number)))];
  console.log(`리뷰 제출 시점 분석: PR ${reviewedNumbers.length}개`);
  const reviewEntries = await mapLimit(reviewedNumbers, TOKEN ? 5 : 2, async (number) => [number, await fetchReviews(number)]);
  const reviewsByPull = new Map(reviewEntries);
  for (const member of members) {
    member.reviewedPullRequests = member.reviewedPullRequests.map((pr) => {
      const ownReviews = (reviewsByPull.get(pr.number) || []).filter((review) => review.user?.login?.toLowerCase() === member.githubId);
      const latest = ownReviews.filter((review) => review.submitted_at).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
      return latest ? { ...pr, reviewedAt: latest.submitted_at, reviewState: latest.state?.toLowerCase() || "commented", reviewCount: ownReviews.length } : null;
    }).filter((pr) => pr && pr.reviewedAt.slice(0, 10) >= ACTIVITY_START);
  }
}

const memberById = new Map(memberRows.map((person) => [person.githubId, { ...person, role: "member" }]));
const mentorById = new Map(mentorRows.map((person) => [person.githubId, { ...person, role: "mentor" }]));
const knownIssues = new Map(members.flatMap((member) => member.issues.map((issue) => [issue.number, issue])));
for (const connection of existingPayload?.contributionConnections || []) {
  for (const issue of connection.linkedIssues || []) {
    if (!knownIssues.has(issue.number)) knownIssues.set(issue.number, {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      author: issue.author,
      createdAt: issue.createdAt || "",
      updatedAt: issue.createdAt || "",
      closedAt: null,
      mergedAt: null,
      state: issue.state,
      comments: 0,
      labels: [],
      isKorean: /^\[ko\]/i.test(issue.title),
    });
  }
}
try {
  const cachedIssues = JSON.parse(await readFile(LINKED_ISSUE_CACHE_PATH, "utf8"));
  for (const [number, issue] of Object.entries(cachedIssues)) if (!knownIssues.has(Number(number))) knownIssues.set(Number(number), issue);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const authoredPulls = members.flatMap((member) => member.pullRequests.map((pr) => ({ member, pr })));
const linkedNumbers = [...new Set(authoredPulls.flatMap(({ pr }) => (pr.issueRelations || []).map((relation) => relation.number)))];
const missingIssueNumbers = linkedNumbers.filter((number) => !knownIssues.has(number));
if (missingIssueNumbers.length) {
  console.log(`연결 이슈 작성자 분석: 이슈 ${missingIssueNumbers.length}개`);
  const details = await mapLimit(missingIssueNumbers, TOKEN ? 5 : 2, async (number) => {
    try {
      return [number, USE_PR_HTML_FALLBACK ? await fetchIssueDetailFromPage(number) : await fetchIssueDetail(number)];
    } catch {
      console.warn(`  이슈 #${number} 상세 조회 실패`);
      return [number, { number, title: "상세 정보 확인 필요", url: `https://github.com/${OWNER}/${REPO}/issues/${number}`, author: "unknown", createdAt: "", updatedAt: "", closedAt: null, mergedAt: null, state: "closed", comments: 0, labels: [], isKorean: false }];
    }
  });
  for (const [number, issue] of details) knownIssues.set(number, issue);
}

const contributionConnections = authoredPulls.map(({ member, pr }) => {
  const reviewers = members.flatMap((reviewer) => reviewer.reviewedPullRequests.filter((review) => review.number === pr.number).map((review) => ({
    name: reviewer.name,
    githubId: reviewer.githubId,
    role: "member",
    reviewedAt: review.reviewedAt || review.updatedAt,
    state: review.reviewState || "commented",
    count: review.reviewCount || 1,
  })));
  const linkedIssues = (pr.issueRelations || []).map((relation) => {
    const issue = knownIssues.get(relation.number);
    const authorId = issue?.author?.toLowerCase() || "unknown";
    const person = memberById.get(authorId) || mentorById.get(authorId);
    const authorRole = person?.role || "external";
    return {
      number: relation.number,
      title: issue?.title || "상세 정보 확인 필요",
      url: issue?.url || `https://github.com/${OWNER}/${REPO}/issues/${relation.number}`,
      author: issue?.author || "unknown",
      authorName: person?.name || issue?.author || "확인 필요",
      authorRole,
      createdAt: issue?.createdAt || null,
      state: issue?.state || "unknown",
      inActivityPeriod: Boolean(issue?.createdAt && issue.createdAt.slice(0, 10) >= ACTIVITY_START),
      originType: authorRole === "mentor" ? "mentor_provided" : authorRole === "member" ? "member_created" : "external",
      relationKind: relation.relationKind,
      relationKeyword: relation.keyword,
    };
  });
  const primaryIssue = linkedIssues.find((issue) => issue.relationKind === "closing" && issue.author.toLowerCase() === member.githubId) || linkedIssues.find((issue) => issue.relationKind === "closing") || linkedIssues[0] || null;
  const sourceType = primaryIssue ? primaryIssue.author.toLowerCase() === member.githubId ? "member_created" : primaryIssue.originType : null;
  const relationshipType = !pr.connectionChecked ? "unknown" : sourceType || "no_issue";
  const exceptionReasons = [];
  if (relationshipType === "unknown") exceptionReasons.push("connection_unverified");
  if (relationshipType === "no_issue") exceptionReasons.push("no_linked_issue");
  if (primaryIssue?.originType === "external" && primaryIssue.relationKind === "closing") exceptionReasons.push("external_issue_resolved");
  if (primaryIssue && primaryIssue.originType !== "external" && !primaryIssue.inActivityPeriod) exceptionReasons.push("issue_created_before_activity");
  return {
    pullRequest: pr,
    pullRequestAuthor: { name: member.name, githubId: member.githubId, role: "member" },
    linkedIssues,
    primaryIssueNumber: primaryIssue?.number || null,
    sourceType,
    reviewers,
    relationshipType,
    exceptionReasons,
    hasException: exceptionReasons.length > 0,
  };
}).sort((a, b) => b.pullRequest.createdAt.localeCompare(a.pullRequest.createdAt));

let translationCompletion = existingPayload?.translationCompletion || null;
try {
  console.log("Kubernetes i18n Tracker 기준 한국어 번역 완료율 분석");
  translationCompletion = await fetchTranslationCompletion();
} catch (error) {
  console.warn(`  번역 완료율 분석 실패${translationCompletion ? " · 이전 수집값 유지" : ""}: ${error.message}`);
}

let projectComparison = existingPayload?.projectComparison || null;
try {
  console.log("활동 전후 동일 기간 한국어 PR 비교 분석");
  projectComparison = await fetchProjectComparison();
} catch (error) {
  console.warn(`  활동 전후 비교 분석 실패${projectComparison ? " · 이전 수집값 유지" : ""}: ${error.message}`);
}

let sustainabilityTool = existingPayload?.sustainabilityTool || null;
try {
  console.log("KubeLingoAssist 개발 산출물 분석");
  sustainabilityTool = await fetchSustainabilityTool();
} catch (error) {
  console.warn(`  KubeLingoAssist 분석 실패${sustainabilityTool ? " · 이전 수집값 유지" : ""}: ${error.message}`);
}

const payload = {
  schemaVersion: 7,
  generatedAt: new Date().toISOString(),
  repository: { owner: OWNER, name: REPO, url: `https://github.com/${OWNER}/${REPO}` },
  collection: {
    period: "since",
    startDate: ACTIVITY_START,
    authenticated: Boolean(TOKEN),
    koreanDetection: TOKEN ? "changed-files" : "title-and-labels",
    issueResolution: "timeline-closing-reference",
    contributionConnections: "full-body-closing-related-mentions-and-academy-reviews",
    note: TOKEN ? null : "공개 API 수집본입니다. GitHub Actions 실행 시 변경 파일 기준 한국어 문서 통계가 보강됩니다.",
  },
  members,
  mentors: mentorRows,
  contributionConnections,
  translationCompletion,
  projectComparison,
  sustainabilityTool,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
await writeFile(OUTPUT_PATH, serialized);
await mkdir(dirname(PUBLIC_OUTPUT_PATH), { recursive: true });
await writeFile(PUBLIC_OUTPUT_PATH, serialized);
console.log(`완료: ${OUTPUT_PATH}`);
