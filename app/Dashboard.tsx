"use client";

import { useMemo, useState } from "react";
import metricsData from "./metrics.json";

type Activity = {
  number: number;
  title: string;
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  state: "open" | "closed" | "merged";
  comments: number;
  labels: string[];
  isKorean: boolean;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  koFiles?: number;
  koAdditions?: number;
  koDeletions?: number;
  reviewedAt?: string;
  reviewState?: string;
  reviewCount?: number;
  resolution?: "open" | "resolved_by_merged_pr" | "closed_without_merged_pr" | "unknown";
  closingPullRequest?: { number: number; title: string; url: string; author: string; mergedAt: string } | null;
};

type Member = {
  name: string;
  githubId: string;
  issues: Activity[];
  pullRequests: Activity[];
  reviewedPullRequests: Activity[];
};

type ConnectedIssue = {
  number: number;
  title: string;
  url: string;
  author: string;
  authorName: string;
  authorRole: "member" | "mentor" | "external";
  createdAt: string | null;
  state: string;
  inActivityPeriod: boolean;
  originType: "member_created" | "mentor_provided" | "external";
  relationKind: "closing" | "related" | "mention";
  relationKeyword: string;
};

type ConnectionReviewer = {
  name: string;
  githubId: string;
  role: "member";
  reviewedAt: string;
  state: string;
  count: number;
};

type ContributionConnection = {
  pullRequest: Activity & { issueRelations?: { number: number; relationKind: "closing" | "related" | "mention"; keyword: string }[]; connectionChecked?: boolean };
  pullRequestAuthor: { name: string; githubId: string; role: "member" };
  linkedIssues: ConnectedIssue[];
  primaryIssueNumber: number | null;
  sourceType: "member_created" | "mentor_provided" | "external" | null;
  reviewers: ConnectionReviewer[];
  relationshipType: "member_created" | "mentor_provided" | "external" | "mixed" | "no_issue" | "unknown";
  exceptionReasons: string[];
  hasException: boolean;
};

type TranslationCompletionSnapshot = {
  commitSha?: string;
  asOf: string;
  totalDocuments: number;
  completedDocuments: number;
  completionPercent: number;
  statusCounts: Record<string, number>;
};

type TranslationCompletion = {
  methodology: "kubernetes-i18n-tracker-up-to-date";
  sourceUrl: string;
  startDate: string;
  start: TranslationCompletionSnapshot;
  current: TranslationCompletionSnapshot;
  changePercentagePoints: number;
  completedDocumentChange: number;
};

type ComparisonPeriod = {
  from: string;
  to: string;
  durationDays: number;
  createdPullRequests: number;
  weeklyAveragePullRequests: number;
  mergedPullRequests: number;
  averagePrToMergeDays: number | null;
  medianPrToMergeDays: number | null;
  prCycleSampleSize: number;
  averageIssueToMergeDays: number | null;
  medianIssueToMergeDays: number | null;
  issueCycleSampleSize: number;
};

type ComparisonRecord = {
  number: number;
  createdAt: string;
  mergedAt: string | null;
  issueCreatedAt: string | null;
};

type ProjectComparison = {
  methodology: "matched-period-korean-localization-prs";
  scope: string;
  activityStart: string;
  durationDays: number;
  dataFrom?: string;
  dataTo?: string;
  records?: ComparisonRecord[];
  before: ComparisonPeriod;
  after: ComparisonPeriod;
};

type SustainabilityTool = {
  repositoryUrl: string;
  description: string | null;
  releaseCount: number;
  latestVersion: string | null;
  latestReleaseAt: string | null;
  commitCount: number;
  commitCountIsMinimum: boolean;
  lastUpdatedAt: string;
};

type View = "overview" | "members" | "connections" | "activity";
type ActivityType = "all" | "issue" | "pr" | "review";
type ConnectionFilter = "all" | "closing" | "related" | "mentor_provided" | "no_issue" | "exceptions";

type DashboardData = {
  generatedAt: string | null;
  repository: { owner: string; name: string; url: string };
  collection: { period: string; startDate: string; authenticated: boolean; koreanDetection: string; note: string | null };
  members: Member[];
  mentors?: { name: string; githubId: string }[];
  contributionConnections?: ContributionConnection[];
  translationCompletion?: TranslationCompletion | null;
  projectComparison?: ProjectComparison | null;
  sustainabilityTool?: SustainabilityTool | null;
};

const initialData = metricsData as unknown as DashboardData;

const fmt = new Intl.NumberFormat("ko-KR");
const dateFmt = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" });
const compactFmt = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" });
const collectedFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });
const periodFmt = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", timeZone: "UTC" });

function formatPeriod(period: ComparisonPeriod) {
  return `${periodFmt.format(new Date(`${period.from}T00:00:00Z`))}–${periodFmt.format(new Date(`${period.to}T00:00:00Z`))}`;
}

function formatMetric(value: number | null, unit: string, digits = 1) {
  return value === null ? "—" : `${value.toFixed(digits)}${unit}`;
}

function summarizeComparisonRange(from: string, to: string, records: ComparisonRecord[], fallback: ComparisonPeriod) {
  if (!from || !to || from > to || !records.length) return fallback;
  const created = records.filter((pr) => pr.createdAt.slice(0, 10) >= from && pr.createdAt.slice(0, 10) <= to);
  const merged = records.filter((pr) => pr.mergedAt && pr.mergedAt.slice(0, 10) >= from && pr.mergedAt.slice(0, 10) <= to);
  const elapsed = (start: string | null, end: string | null) => start && end ? (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000 : null;
  const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const median = (values: number[]) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const prCycles = merged.map((pr) => elapsed(pr.createdAt, pr.mergedAt)).filter((value): value is number => value !== null);
  const issueCycles = merged.map((pr) => elapsed(pr.issueCreatedAt, pr.mergedAt)).filter((value): value is number => value !== null);
  const durationDays = Math.floor((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  return {
    from,
    to,
    durationDays,
    createdPullRequests: created.length,
    weeklyAveragePullRequests: created.length / durationDays * 7,
    mergedPullRequests: merged.length,
    averagePrToMergeDays: avg(prCycles),
    medianPrToMergeDays: median(prCycles),
    prCycleSampleSize: prCycles.length,
    averageIssueToMergeDays: avg(issueCycles),
    medianIssueToMergeDays: median(issueCycles),
    issueCycleSampleSize: issueCycles.length,
  };
}

function inRange(date: string, from: string, to: string) {
  const time = new Date(date).getTime();
  return (!from || time >= new Date(`${from}T00:00:00`).getTime()) && (!to || time <= new Date(`${to}T23:59:59`).getTime());
}

function stateLabel(state: Activity["state"]) {
  return state === "merged" ? "Merged" : state === "open" ? "Open" : "Closed";
}

function issueResolutionLabel(item: Activity) {
  if (item.resolution === "resolved_by_merged_pr") return "PR로 해결";
  if (item.resolution === "closed_without_merged_pr") return "PR 없이 종료";
  if (item.resolution === "unknown") return "판정 불가";
  return "Open";
}

function issueResolutionClass(item: Activity) {
  if (item.resolution === "resolved_by_merged_pr") return "merged";
  if (item.resolution === "closed_without_merged_pr") return "closed";
  if (item.resolution === "unknown") return "unknown";
  return "open";
}

function originLabel(origin: ConnectedIssue["originType"]) {
  return origin === "member_created" ? "멤버 생성 이슈" : origin === "mentor_provided" ? "멘토 제안 이슈" : "외부 이슈";
}

function exceptionLabel(reason: string) {
  if (reason === "external_issue_resolved") return "외부 이슈 해결";
  if (reason === "issue_created_before_activity") return "활동 시작 전 생성";
  if (reason === "connection_unverified") return "연결 판정 불가";
  return "연결 이슈 없음";
}

function relationKindLabel(kind: ConnectedIssue["relationKind"]) {
  return kind === "closing" ? "해결할 이슈" : "기타";
}

function reviewStateLabel(state: string) {
  if (state === "approved") return "승인";
  if (state === "changes_requested") return "변경 요청";
  if (state === "dismissed") return "취소됨";
  return "코멘트";
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData>(initialData);
  const [view, setView] = useState<View>("overview");
  const [from, setFrom] = useState(initialData.collection.startDate);
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [activityType, setActivityType] = useState<ActivityType>("all");
  const [connectionQuery, setConnectionQuery] = useState("");
  const [connectionFilter, setConnectionFilter] = useState<ConnectionFilter>("all");
  const [connectionState, setConnectionState] = useState<"all" | Activity["state"]>("all");
  const [memberId, setMemberId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [beforeRange, setBeforeRange] = useState({ from: initialData.projectComparison?.before.from || "", to: initialData.projectComparison?.before.to || "" });
  const [afterRange, setAfterRange] = useState({ from: initialData.projectComparison?.after.from || "", to: initialData.projectComparison?.after.to || "" });

  const filteredMembers = useMemo(() => data.members.map((member) => ({
    ...member,
    issues: member.issues.filter((item) => inRange(item.createdAt, from, to)),
    pullRequests: member.pullRequests.filter((item) => inRange(item.createdAt, from, to)),
    reviewedPullRequests: member.reviewedPullRequests.filter((item) => inRange(item.reviewedAt || item.updatedAt, from, to)),
  })), [data, from, to]);

  const totals = useMemo(() => {
    const issues = filteredMembers.flatMap((member) => member.issues);
    const prs = filteredMembers.flatMap((member) => member.pullRequests);
    const reviews = filteredMembers.flatMap((member) => member.reviewedPullRequests);
    const merged = prs.filter((pr) => pr.state === "merged");
    const korean = prs.filter((pr) => pr.isKorean);
    const active = filteredMembers.filter((member) => member.issues.length + member.pullRequests.length + member.reviewedPullRequests.length > 0);
    const reviewMembers = filteredMembers.filter((member) => member.reviewedPullRequests.length > 0);
    const resolvedIssues = issues.filter((issue) => issue.resolution === "resolved_by_merged_pr");
    const openIssues = issues.filter((issue) => issue.resolution === "open");
    const closedWithoutPr = issues.filter((issue) => issue.resolution === "closed_without_merged_pr");
    const unknownIssues = issues.filter((issue) => issue.resolution === "unknown");
    const cycleTimes = merged.filter((pr) => pr.mergedAt).map((pr) => (new Date(pr.mergedAt!).getTime() - new Date(pr.createdAt).getTime()) / 86_400_000);
    return {
      issues: issues.length,
      resolvedIssues: resolvedIssues.length,
      openIssues: openIssues.length,
      closedWithoutPr: closedWithoutPr.length,
      unknownIssues: unknownIssues.length,
      prs: prs.length,
      merged: merged.length,
      open: prs.filter((pr) => pr.state === "open").length,
      reviews: reviews.length,
      active: active.length,
      reviewMembers: reviewMembers.length,
      korean: korean.length,
      koreanMerged: korean.filter((pr) => pr.state === "merged").length,
      koFiles: korean.reduce((sum, pr) => sum + (pr.koFiles || 0), 0),
      koAdditions: korean.reduce((sum, pr) => sum + (pr.koAdditions || 0), 0),
      mergeRate: prs.length ? Math.round((merged.length / prs.length) * 100) : 0,
      avgCycle: cycleTimes.length ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : 0,
    };
  }, [filteredMembers]);

  const memberStats = useMemo(() => filteredMembers.map((member) => ({
    ...member,
    merged: member.pullRequests.filter((pr) => pr.state === "merged").length,
    korean: member.pullRequests.filter((pr) => pr.isKorean).length,
    resolvedIssues: member.issues.filter((issue) => issue.resolution === "resolved_by_merged_pr").length,
    total: member.issues.length + member.pullRequests.length + member.reviewedPullRequests.length,
  })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ko")), [filteredMembers]);

  const allActivities = useMemo(() => filteredMembers.flatMap((member) => [
    ...member.issues.map((item) => ({ ...item, type: "issue" as const, member, activityDate: item.createdAt })),
    ...member.pullRequests.map((item) => ({ ...item, type: "pr" as const, member, activityDate: item.createdAt })),
    ...member.reviewedPullRequests.map((item) => ({ ...item, type: "review" as const, member, activityDate: item.reviewedAt || item.updatedAt })),
  ]).sort((a, b) => new Date(b.activityDate || b.createdAt).getTime() - new Date(a.activityDate || a.createdAt).getTime()), [filteredMembers]);

  const visibleActivities = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allActivities.filter((item) => (activityType === "all" || item.type === activityType) && (!needle || item.title.toLowerCase().includes(needle) || item.member.name.includes(needle) || item.member.githubId.includes(needle)));
  }, [allActivities, activityType, query]);

  const connections = useMemo(() => (data.contributionConnections || []).filter((connection) => inRange(connection.pullRequest.createdAt, from, to)), [data, from, to]);

  const visibleConnections = useMemo(() => {
    const needle = connectionQuery.trim().toLowerCase();
    return connections.filter((connection) => {
      const matchesFilter = connectionFilter === "all" || connectionFilter === "exceptions" && connection.hasException || connectionFilter === "no_issue" && connection.linkedIssues.length === 0 || connectionFilter === "mentor_provided" && connection.sourceType === "mentor_provided" || connectionFilter === "closing" && connection.linkedIssues.some((issue) => issue.relationKind === "closing") || connectionFilter === "related" && connection.linkedIssues.some((issue) => issue.relationKind !== "closing");
      const matchesState = connectionState === "all" || connection.pullRequest.state === connectionState;
      const searchable = [connection.pullRequest.title, connection.pullRequestAuthor.name, connection.pullRequestAuthor.githubId, ...connection.linkedIssues.flatMap((issue) => [issue.title, issue.authorName, issue.author, issue.relationKeyword]), ...connection.reviewers.flatMap((reviewer) => [reviewer.name, reviewer.githubId])].join(" ").toLowerCase();
      return matchesFilter && matchesState && (!needle || searchable.includes(needle));
    });
  }, [connections, connectionFilter, connectionQuery, connectionState]);

  const monthly = useMemo(() => {
    const buckets = new Map<string, { issue: number; pr: number; review: number }>();
    for (const item of allActivities) {
      const key = (item.activityDate || item.createdAt).slice(0, 7);
      const bucket = buckets.get(key) || { issue: 0, pr: 0, review: 0 };
      bucket[item.type] += 1;
      buckets.set(key, bucket);
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  }, [allActivities]);

  const selectedMember = memberStats.find((member) => member.githubId === memberId) || null;
  const maxMemberTotal = Math.max(...memberStats.map((member) => member.total), 1);
  const maxMonth = Math.max(...monthly.map(([, value]) => value.issue + value.pr + value.review), 1);
  const completion = data.translationCompletion;
  const comparison = data.projectComparison;
  const sustainabilityTool = data.sustainabilityTool;
  const comparisonBefore = comparison ? summarizeComparisonRange(beforeRange.from, beforeRange.to, comparison.records || [], comparison.before) : null;
  const comparisonAfter = comparison ? summarizeComparisonRange(afterRange.from, afterRange.to, comparison.records || [], comparison.after) : null;
  const comparisonRows = comparison ? [
    { label: "주당 평균 PR", description: "선택 기간 중 생성 · 기간 길이 정규화", before: comparisonBefore!.weeklyAveragePullRequests, after: comparisonAfter!.weeklyAveragePullRequests, unit: "건", digits: 1, lowerIsBetter: false },
    { label: "생성된 PR", description: `활동 전 ${comparisonBefore!.durationDays}일 · 활동 후 ${comparisonAfter!.durationDays}일`, before: comparisonBefore!.createdPullRequests, after: comparisonAfter!.createdPullRequests, unit: "건", digits: 0, lowerIsBetter: false },
    { label: "머지된 PR", description: "선택 기간 중 머지", before: comparisonBefore!.mergedPullRequests, after: comparisonAfter!.mergedPullRequests, unit: "건", digits: 0, lowerIsBetter: false },
    { label: "이슈 생성 → 머지 평균", description: `중앙값 ${formatMetric(comparisonBefore!.medianIssueToMergeDays, "일")}→${formatMetric(comparisonAfter!.medianIssueToMergeDays, "일")} · 표본 ${comparisonBefore!.issueCycleSampleSize}→${comparisonAfter!.issueCycleSampleSize}건`, before: comparisonBefore!.averageIssueToMergeDays, after: comparisonAfter!.averageIssueToMergeDays, unit: "일", digits: 1, lowerIsBetter: true },
    { label: "PR 생성 → 머지 평균", description: `중앙값 ${formatMetric(comparisonBefore!.medianPrToMergeDays, "일")}→${formatMetric(comparisonAfter!.medianPrToMergeDays, "일")} · 표본 ${comparisonBefore!.prCycleSampleSize}→${comparisonAfter!.prCycleSampleSize}건`, before: comparisonBefore!.averagePrToMergeDays, after: comparisonAfter!.averagePrToMergeDays, unit: "일", digits: 1, lowerIsBetter: true },
  ] : [];

  function exportCsv() {
    const header = ["name", "github_id", "issues_created", "issues_resolved_by_merged_pr", "issues_open", "issues_closed_without_merged_pr", "issues_unknown", "pull_requests", "merged_prs", "open_prs", "reviewed_prs", "korean_prs"];
    const rows = memberStats.map((member) => [member.name, member.githubId, member.issues.length, member.resolvedIssues, member.issues.filter((issue) => issue.resolution === "open").length, member.issues.filter((issue) => issue.resolution === "closed_without_merged_pr").length, member.issues.filter((issue) => issue.resolution === "unknown").length, member.pullRequests.length, member.merged, member.pullRequests.filter((pr) => pr.state === "open").length, member.reviewedPullRequests.length, member.korean]);
    const csv = [header, ...rows].map((row) => row.join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    link.download = "kubernetes-korean-contribution-kpi.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportConnectionsCsv() {
    const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const header = ["pr_number", "pr_title", "pr_author", "pr_state", "source_type", "primary_issue", "linked_issues", "issue_relations", "issue_authors", "academy_reviewers", "exception_reasons"];
    const rows = visibleConnections.map((connection) => [connection.pullRequest.number, connection.pullRequest.title, connection.pullRequestAuthor.githubId, connection.pullRequest.state, connection.sourceType || "", connection.primaryIssueNumber ? `#${connection.primaryIssueNumber}` : "", connection.linkedIssues.map((issue) => `#${issue.number}`).join(" | "), connection.linkedIssues.map((issue) => `${issue.relationKind}:${issue.relationKeyword}`).join(" | "), connection.linkedIssues.map((issue) => `${issue.author} (${issue.authorRole})`).join(" | "), connection.reviewers.map((reviewer) => `${reviewer.githubId} (${reviewer.state})`).join(" | "), connection.exceptionReasons.join(" | ")]);
    const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    link.download = "kubernetes-contribution-connections.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function refreshData() {
    setRefreshing(true);
    setRefreshMessage("");
    try {
      const response = await fetch(`./data/metrics.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("데이터 응답 오류");
      const latest = await response.json() as DashboardData;
      if (!latest.generatedAt || !Array.isArray(latest.members)) throw new Error("데이터 형식 오류");
      setData(latest);
      setFrom((current) => !current || current < latest.collection.startDate ? latest.collection.startDate : current);
      setRefreshMessage("최신 게시 데이터를 불러왔습니다.");
    } catch {
      setRefreshMessage("최신 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => setView("overview")} aria-label="대시보드 홈">
          <span><b>OSSCA 기여 현황</b><small>kubernetes/website</small></span>
        </button>
        <nav aria-label="주요 메뉴">
          {(["overview", "members", "connections", "activity"] as View[]).map((item) => <button className={view === item ? "active" : ""} key={item} onClick={() => setView(item)}>{item === "overview" ? "성과 개요" : item === "members" ? "멤버별 기여" : item === "connections" ? "통합 기여 현황" : "활동 내역"}</button>)}
        </nav>
        <div className="headerActions">
          <button className="refreshButton" onClick={refreshData} disabled={refreshing} title="최근 배포된 수집 데이터를 다시 불러옵니다">{refreshing ? "불러오는 중…" : "↻ 최신 데이터"}</button>
          <button className="exportButton" onClick={exportCsv}>CSV 내보내기 ↓</button>
        </div>
      </header>

      <section className="dashboardHeader" id="top">
        <div>
          <h1>Kubernetes 한국어 문서 기여 현황</h1>
          <a href={data.repository.url} target="_blank" rel="noreferrer">{data.repository.owner}/{data.repository.name} ↗</a>
        </div>
        <dl className="collectionMeta">
          <div><dt>수집 대상 기간</dt><dd>2026. 7. 11. 이후</dd></div>
          <div><dt>최근 수집 시각</dt><dd>{data.generatedAt ? collectedFmt.format(new Date(data.generatedAt)) : "수집 대기"}</dd></div>
          <div><dt>수집 상태</dt><dd><i className={`statusDot ${data.generatedAt ? "live" : ""}`} />{data.generatedAt ? "정상 · 매일 06:17 자동 갱신" : "대기"}</dd></div>
        </dl>
      </section>

      <section className="filterBand" aria-label="분석 기간">
        <div><span>분석 기간</span><strong>{from === data.collection.startDate && !to ? "2026. 7. 11. 이후" : "사용자 지정"}</strong></div>
        <label>시작일<input type="date" min={data.collection.startDate} value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <span className="rangeArrow">→</span>
        <label>종료일<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        {(from !== data.collection.startDate || to) && <button className="textButton" onClick={() => { setFrom(data.collection.startDate); setTo(""); }}>초기화</button>}
      </section>

      {refreshMessage && <p className="refreshMessage" role="status">{refreshMessage}</p>}
      {data.collection.note && <p className="dataNote">수집 방식: {data.collection.note}</p>}

      {view === "overview" && <>
        <section className="summary" aria-label="주요 성과 요약">
          <article className="metricCard issueMetricCard blue">
            <p>생성한 이슈</p>
            <strong>{fmt.format(totals.issues)}</strong>
            <div className="issueBreakdown" aria-label="이슈 상태별 세부 집계">
              <span><b>{fmt.format(totals.resolvedIssues)}건</b> 해결</span>
              <span><b>{fmt.format(totals.openIssues)}건</b> 진행 중</span>
              <span><b>{fmt.format(totals.closedWithoutPr)}건</b> PR 없이 종료</span>
              {totals.unknownIssues > 0 && <span><b>{fmt.format(totals.unknownIssues)}건</b> 판정 불가</span>}
            </div>
          </article>
          {[
            ["생성한 PR", totals.prs, "PULL REQUESTS", "violet"],
            ["머지된 PR", totals.merged, `${totals.mergeRate}% MERGE RATE`, "mint"],
            ["다른 PR 리뷰", totals.reviews, `${totals.reviewMembers}명 참여`, "amber"],
          ].map(([label, value, hint, tone]) => <article className={`metricCard ${tone}`} key={String(label)}><p>{label}</p><strong>{fmt.format(Number(value))}</strong><span className="metricHint">{hint}</span></article>)}
        </section>

        <section className="analysisStrip" aria-label="추가 분석 지표">
          <article><span>활동 멤버</span><strong>{totals.active} / 24명</strong></article>
          <article><span>PR 머지율</span><strong>{totals.mergeRate}%</strong></article>
          <article><span>리뷰 참여 멤버</span><strong>{totals.reviewMembers}명</strong></article>
          <article><span>평균 머지 소요</span><strong>{totals.avgCycle ? `${totals.avgCycle.toFixed(1)}일` : "—"}</strong></article>
        </section>

        {comparison && <section className="comparisonPanel" aria-label="오픈소스 컨트리뷰션 아카데미 활동 전후 한국어 PR 비교">
          <div className="comparisonHeader">
            <div><h2>활동 전후 한국어 현지화 성과</h2><p>활동 전·후 기간을 달력으로 지정하면 수집된 PR 기록을 즉시 다시 계산합니다.</p></div>
            <button className="textButton" onClick={() => { setBeforeRange({ from: comparison.before.from, to: comparison.before.to }); setAfterRange({ from: comparison.after.from, to: comparison.after.to }); }}>기본 비교로 초기화</button>
          </div>
          <div className="comparisonRangeEditor" aria-label="활동 전후 비교 기간 설정">
            <fieldset>
              <legend>활동 전</legend>
              <label>시작일<input type="date" min={comparison.dataFrom || comparison.before.from} max={beforeRange.to || comparison.dataTo || comparison.after.to} value={beforeRange.from} onChange={(event) => setBeforeRange((range) => ({ ...range, from: event.target.value }))} /></label>
              <span>→</span>
              <label>종료일<input type="date" min={beforeRange.from || comparison.dataFrom || comparison.before.from} max={comparison.dataTo || comparison.after.to} value={beforeRange.to} onChange={(event) => setBeforeRange((range) => ({ ...range, to: event.target.value }))} /></label>
              <small>{formatPeriod(comparisonBefore!)} · {comparisonBefore!.durationDays}일</small>
            </fieldset>
            <i>VS</i>
            <fieldset className="after">
              <legend>활동 후</legend>
              <label>시작일<input type="date" min={comparison.dataFrom || comparison.before.from} max={afterRange.to || comparison.dataTo || comparison.after.to} value={afterRange.from} onChange={(event) => setAfterRange((range) => ({ ...range, from: event.target.value }))} /></label>
              <span>→</span>
              <label>종료일<input type="date" min={afterRange.from || comparison.dataFrom || comparison.before.from} max={comparison.dataTo || comparison.after.to} value={afterRange.to} onChange={(event) => setAfterRange((range) => ({ ...range, to: event.target.value }))} /></label>
              <small>{formatPeriod(comparisonAfter!)} · {comparisonAfter!.durationDays}일</small>
            </fieldset>
          </div>
          <div className="comparisonTable">
            <div className="comparisonTableHead"><span>지표</span><span>활동 전</span><span>활동 후</span><span>변화</span></div>
            {comparisonRows.map((row) => {
              const change = row.before === null || row.after === null ? null : row.after - row.before;
              const favorable = change !== null && (row.lowerIsBetter ? change < 0 : change > 0);
              const unfavorable = change !== null && (row.lowerIsBetter ? change > 0 : change < 0);
              return <article className="comparisonRow" key={row.label}>
                <span><b>{row.label}</b><small>{row.description}</small></span>
                <strong>{formatMetric(row.before, row.unit, row.digits)}</strong>
                <strong className="afterValue">{formatMetric(row.after, row.unit, row.digits)}</strong>
                <strong className={`metricDelta ${favorable ? "favorable" : unfavorable ? "unfavorable" : "flat"}`}>{change === null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(row.digits)}${row.unit}`}</strong>
              </article>;
            })}
          </div>
          <p className="comparisonNote"><b>집계 기준</b> {comparison.scope}. PR 생성량은 생성일, 머지 건수와 소요일은 머지일이 선택 기간에 포함되는 PR을 집계합니다. 기간 길이가 다를 때는 주당 평균 PR을 우선 비교하세요. 이슈 소요일은 PR 본문에 종료 키워드로 연결된 이슈가 확인된 경우만 계산합니다. 선택 가능한 수집 범위는 {comparison.dataFrom || comparison.before.from}부터 {comparison.dataTo || comparison.after.to}까지이며, 프로젝트 전체의 전후 변화로 아카데미 활동만의 단독 인과를 뜻하지 않습니다.</p>
        </section>}

        {completion && <section className="coveragePanel" aria-label="영문 최신 내용을 반영한 한국어 번역 완료율 변화">
          <div className="coverageHeader">
            <div><h2>영문 최신 내용을 반영한 한국어 번역 완료율</h2><p>활동 시작 직전과 최근 수집 시점 비교</p></div>
            <a href={completion.sourceUrl} target="_blank" rel="noreferrer">Kubernetes i18n Tracker 기준 ↗</a>
          </div>
          <div className="coverageComparison">
            <article className="coverageSnapshot">
              <span>2026. 7. 11. 시작 직전</span>
              <strong>{completion.start.completionPercent.toFixed(2)}%</strong>
              <small>{fmt.format(completion.start.completedDocuments)} / {fmt.format(completion.start.totalDocuments)}개 문서</small>
              <i className="coverageTrack"><b style={{ width: `${completion.start.completionPercent}%` }} /></i>
            </article>
            <div className={`coverageChange ${completion.changePercentagePoints > 0 ? "up" : completion.changePercentagePoints < 0 ? "down" : "flat"}`}>
              <span>활동 후 변화</span>
              <strong>{completion.changePercentagePoints > 0 ? "+" : ""}{completion.changePercentagePoints.toFixed(2)}%p</strong>
              <small>번역 완료 문서 {completion.completedDocumentChange > 0 ? "+" : ""}{fmt.format(completion.completedDocumentChange)}개</small>
            </div>
            <article className="coverageSnapshot current">
              <span>최근 트래커 집계 · {dateFmt.format(new Date(completion.current.asOf))}</span>
              <strong>{completion.current.completionPercent.toFixed(2)}%</strong>
              <small>{fmt.format(completion.current.completedDocuments)} / {fmt.format(completion.current.totalDocuments)}개 문서</small>
              <i className="coverageTrack"><b style={{ width: `${completion.current.completionPercent}%` }} /></i>
            </article>
          </div>
          <p className="coverageNote"><b>완료 판정</b> 한국어 문서가 존재하고 마지막 한국어 갱신이 영문 원문의 최신 변경보다 늦으며, Markdown 제목 구조가 일치해 트래커에서 <code>up_to_date</code>로 분류된 문서만 포함합니다.</p>
        </section>}

        {sustainabilityTool && <section className="toolPanel" aria-label="KubeLingoAssist를 통한 장기 성과 유지 기반">
          <div className="toolHeader">
            <div><span className="eyebrow">장기 성과 유지 기반</span><h2>KubeLingoAssist</h2><p>번역 파일 생성과 영문·번역문 병렬 비교, PR 변경 파일 기반 리뷰 흐름을 VS Code 안에 묶어 번역·리뷰의 반복 작업을 줄이는 도구입니다.</p></div>
            <a href={sustainabilityTool.repositoryUrl} target="_blank" rel="noreferrer">도구 저장소 ↗</a>
          </div>
          <div className="toolProofGrid">
            <article><span>제공 워크플로</span><strong>2개</strong><small>번역 모드 · 리뷰 모드</small></article>
            <article><span>공개 릴리스</span><strong>{fmt.format(sustainabilityTool.releaseCount)}회</strong><small>최신 {sustainabilityTool.latestVersion || "버전 확인 중"}</small></article>
            <article><span>개발 커밋</span><strong>{sustainabilityTool.commitCountIsMinimum ? `${fmt.format(sustainabilityTool.commitCount)}+` : fmt.format(sustainabilityTool.commitCount)}</strong><small>기본 브랜치 기준</small></article>
            <article><span>최근 개발 갱신</span><strong>{compactFmt.format(new Date(sustainabilityTool.lastUpdatedAt))}</strong><small>저장소 push 기준</small></article>
          </div>
          <div className="toolMetricFramework">
            <div className="frameworkIntro"><h3>도구 도입 효과를 증명할 운영 KPI</h3><p>현재 저장소에는 사용 텔레메트리가 없어 아래 값은 아직 실적으로 집계하지 않습니다. PR 템플릿에 도구 사용 여부를 기록하면 GitHub 데이터만으로 장기 추적할 수 있습니다.</p></div>
            <div className="frameworkGrid">
              <article><b>도구 경유 PR 비율</b><span>도구 사용 PR ÷ 전체 한국어 PR</span><small>도입률</small></article>
              <article><b>번역·리뷰 리드타임</b><span>도구 사용 여부별 PR 생성→머지 중앙값</span><small>속도</small></article>
              <article><b>재작업 감소율</b><span>변경 요청·재리뷰 횟수의 전후 변화</span><small>품질</small></article>
              <article><b>번역 완료 유지율</b><span>머지 30·60·90일 후 up_to_date 유지 비율</span><small>지속성</small></article>
            </div>
          </div>
        </section>}

        <section className="insightGrid">
          <article className="chartPanel wide">
            <div className="sectionHead"><h2>월별 기여 흐름</h2><span>이슈 · PR · 리뷰 참여</span></div>
            <div className="legend"><i className="issueKey" />이슈 <i className="prKey" />PR <i className="reviewKey" />리뷰</div>
            <div className="monthChart">
              {monthly.length ? monthly.map(([month, values]) => {
                const total = values.issue + values.pr + values.review;
                return <div className="monthColumn" key={month}><div className="monthTotal">{total}</div><div className="stack" style={{ height: `${Math.max((total / maxMonth) * 190, 4)}px` }}><i className="reviewBar" style={{ flex: values.review }} /><i className="prBar" style={{ flex: values.pr }} /><i className="issueBar" style={{ flex: values.issue }} /></div><span>{month.slice(2).replace("-", ".")}</span></div>;
              }) : <div className="emptyState">수집된 활동이 없습니다.</div>}
            </div>
          </article>

          <article className="impactPanel">
            <h2>한국어 문서 기여</h2>
            <div className="impactHero"><strong>{fmt.format(totals.koreanMerged)}</strong><span>머지된 한국어 PR</span></div>
            <dl><div><dt>한국어 관련 PR</dt><dd>{fmt.format(totals.korean)}</dd></div><div><dt>변경한 한국어 파일</dt><dd>{totals.koFiles ? fmt.format(totals.koFiles) : "—"}</dd></div><div><dt>한국어 라인 추가</dt><dd>{totals.koAdditions ? `+${fmt.format(totals.koAdditions)}` : "—"}</dd></div></dl>
            {!data.collection.authenticated && <small>파일 단위 통계는 GitHub Actions 갱신 후 표시됩니다.</small>}
          </article>
        </section>

        <section className="leaderSection">
          <div className="sectionHead"><h2>멤버별 기여 분포</h2><button className="textButton" onClick={() => setView("members")}>전체 멤버 보기 →</button></div>
          <div className="leaderList">{memberStats.slice(0, 8).map((member) => <button key={member.githubId} onClick={() => setMemberId(member.githubId)}><span className="avatar"><img src={`https://github.com/${member.githubId}.png?size=80`} alt="" /></span><span className="memberLabel"><b>{member.name}</b><small>@{member.githubId}</small></span><span className="barTrack"><i style={{ width: `${(member.total / maxMemberTotal) * 100}%` }} /></span><strong>{member.total}</strong></button>)}</div>
        </section>
      </>}

      {view === "members" && <section className="contentSection">
        <div className="sectionHead"><h2>멤버별 기여</h2><p>카드를 선택하면 상세 활동을 볼 수 있습니다.</p></div>
        <div className="memberGrid">{memberStats.map((member) => <button className="memberCard" key={member.githubId} onClick={() => setMemberId(member.githubId)}><div className="memberTop"><img src={`https://github.com/${member.githubId}.png?size=96`} alt="" /><span><b>{member.name}</b><small>@{member.githubId}</small></span><strong>{member.total}</strong></div><div className="miniStats"><span><b>{member.issues.length}</b>이슈</span><span><b>{member.pullRequests.length}</b>PR</span><span><b>{member.merged}</b>머지</span><span><b>{member.reviewedPullRequests.length}</b>리뷰</span></div></button>)}</div>
      </section>}

      {view === "connections" && <section className="contentSection connectionSection">
        <div className="sectionHead connectionHeading"><div><h2>통합 기여 현황</h2><p>성과 집계의 근거가 되는 이슈·PR·리뷰 연결을 확인합니다.</p></div><button className="exportButton" onClick={exportConnectionsCsv}>통합 CSV 내보내기 ↓</button></div>
        <div className="connectionFilters">
          <input type="search" placeholder="이슈, PR, 작성자, 리뷰어 검색" value={connectionQuery} onChange={(event) => setConnectionQuery(event.target.value)} aria-label="기여 연결 검색" />
          <div className="connectionFilterButtons">{(["all", "closing", "related", "mentor_provided", "no_issue", "exceptions"] as ConnectionFilter[]).map((filter) => <button className={connectionFilter === filter ? "active" : ""} onClick={() => setConnectionFilter(filter)} key={filter}>{filter === "all" ? "전체" : filter === "closing" ? "해결할 이슈" : filter === "related" ? "기타" : filter === "mentor_provided" ? "멘토 제안" : filter === "no_issue" ? "이슈 없음" : "특이사항만"}</button>)}</div>
          <label>PR 상태<select value={connectionState} onChange={(event) => setConnectionState(event.target.value as "all" | Activity["state"])}><option value="all">전체</option><option value="open">Open</option><option value="merged">Merged</option><option value="closed">Closed</option></select></label>
        </div>
        <div className="connectionTable">
          <div className="connectionTableHead"><span>출처 유형</span><span>연결 이슈 · 관계 · 작성자</span><span>PR · 작성자</span><span>아카데미 리뷰어</span><span>상태</span><span>특이사항</span></div>
          {visibleConnections.map((connection) => <article className="connectionRow" key={connection.pullRequest.number}>
            <span>{connection.sourceType ? <i className={`relationBadge ${connection.sourceType}`}>{originLabel(connection.sourceType)}</i> : <i className="emptyCell">—</i>}</span>
            <div className="connectionIssues">{connection.linkedIssues.length ? connection.linkedIssues.map((issue) => <a href={issue.url} target="_blank" rel="noreferrer" key={`${issue.number}-${issue.relationKind}`}><b><i className={`issueRelationKind ${issue.relationKind === "closing" ? "closing" : "other"}`}>{relationKindLabel(issue.relationKind)}</i> #{issue.number} {issue.title}</b><small>{issue.authorName} · @{issue.author} · {issue.authorRole === "mentor" ? "멘토" : issue.authorRole === "member" ? "멤버" : "외부"}</small></a>) : <span className="noConnection"><b>연결 이슈 없음</b><small>{connection.pullRequest.connectionChecked === false ? "GitHub 연결 정보를 확인하지 못했습니다." : "PR 본문에 이슈 링크나 참조가 없습니다."}</small></span>}</div>
            <a className="connectionPr" href={connection.pullRequest.url} target="_blank" rel="noreferrer"><b>#{connection.pullRequest.number} {connection.pullRequest.title}</b><small>{connection.pullRequestAuthor.name} · @{connection.pullRequestAuthor.githubId}</small><small>{compactFmt.format(new Date(connection.pullRequest.createdAt))} 생성</small></a>
            <div className="connectionReviewers">{connection.reviewers.length ? connection.reviewers.map((reviewer) => <span key={reviewer.githubId}><b>{reviewer.name}</b><small>@{reviewer.githubId} · {reviewStateLabel(reviewer.state)}{reviewer.count > 1 ? ` ${reviewer.count}회` : ""}</small></span>) : <i className="emptyCell">아카데미 리뷰 없음</i>}</div>
            <span><i className={`state ${connection.pullRequest.state}`}>{stateLabel(connection.pullRequest.state)}</i>{connection.pullRequest.mergedAt && <small className="connectionDate">{compactFmt.format(new Date(connection.pullRequest.mergedAt))}</small>}</span>
            <div className="exceptionBadges">{connection.exceptionReasons.length ? connection.exceptionReasons.map((reason) => <i key={reason}>{exceptionLabel(reason)}</i>) : <span>없음</span>}</div>
          </article>)}
          {!visibleConnections.length && <div className="connectionEmpty">조건에 맞는 기여 연결 관계가 없습니다.</div>}
        </div>
        <p className="connectionFootnote">Closes · Fixes · Resolves로 연결된 항목은 해결할 이슈로, 그 밖의 관련·참조 링크는 기타로 간략히 표시합니다. 리뷰어는 아카데미 멤버가 제출한 GitHub 리뷰만 포함합니다.</p>
      </section>}

      {view === "activity" && <section className="contentSection">
        <div className="sectionHead"><h2>전체 활동 내역</h2><strong>{fmt.format(visibleActivities.length)}건</strong></div>
        <div className="activityFilters"><input type="search" placeholder="제목, 이름, GitHub ID 검색" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="활동 검색" /><div>{(["all", "issue", "pr", "review"] as ActivityType[]).map((type) => <button className={activityType === type ? "active" : ""} onClick={() => setActivityType(type)} key={type}>{type === "all" ? "전체" : type === "issue" ? "이슈" : type === "pr" ? "PR" : "리뷰"}</button>)}</div></div>
        <div className="activityTable">
          <div className="tableHead"><span>구분</span><span>활동</span><span>작성자</span><span>리뷰어</span><span>상태</span><span>날짜</span></div>
          {visibleActivities.slice(0, 300).map((item, index) => {
            const knownAuthor = data.members.find((member) => member.githubId === item.author.toLowerCase());
            return <a className="tableRow" href={item.url} target="_blank" rel="noreferrer" key={`${item.type}-${item.member.githubId}-${item.number}-${index}`}>
              <span><i className={`typeIcon ${item.type}`}>{item.type === "issue" ? "I" : item.type === "pr" ? "P" : "R"}</i></span>
              <span><b>#{item.number} {item.title}</b><small>{item.type === "review" ? "리뷰한 Pull Request" : item.type === "pr" ? "생성한 Pull Request" : item.closingPullRequest ? `PR #${item.closingPullRequest.number}로 해결` : "생성한 Issue"}</small></span>
              <span><b>{item.type === "review" ? (knownAuthor?.name || `@${item.author}`) : item.member.name}</b><small>@{item.type === "review" ? item.author : item.member.githubId} · {item.type === "review" ? "PR 작성자" : "기여자"}</small></span>
              <span>{item.type === "review" ? <><b>{item.member.name}</b><small>@{item.member.githubId}</small></> : <i className="emptyCell">—</i>}</span>
              <span><i className={`state ${item.type === "issue" ? issueResolutionClass(item) : item.state}`}>{item.type === "issue" ? issueResolutionLabel(item) : stateLabel(item.state)}</i></span>
              <span className="activityDate">{compactFmt.format(new Date(item.activityDate || item.createdAt))}</span>
            </a>;
          })}
        </div>
        {visibleActivities.length > 300 && <p className="limitNote">화면 성능을 위해 최신 300건을 표시합니다. 전체 집계에는 모든 활동이 포함됩니다.</p>}
      </section>}

      {selectedMember && <div className="drawerBackdrop"><button className="drawerDismiss" onClick={() => setMemberId(null)} aria-label="멤버 상세 닫기" /><aside className="memberDrawer" role="dialog" aria-modal="true" aria-label={`${selectedMember.name} 상세 기여`}><button className="closeButton" onClick={() => setMemberId(null)} aria-label="닫기">×</button><div className="drawerProfile"><img src={`https://github.com/${selectedMember.githubId}.png?size=128`} alt="" /><div><h2>{selectedMember.name}</h2><a href={`https://github.com/${selectedMember.githubId}`} target="_blank" rel="noreferrer">@{selectedMember.githubId} ↗</a></div></div><div className="drawerStats"><span><strong>{selectedMember.issues.length}</strong>이슈</span><span><strong>{selectedMember.pullRequests.length}</strong>PR</span><span><strong>{selectedMember.merged}</strong>머지</span><span><strong>{selectedMember.reviewedPullRequests.length}</strong>리뷰</span></div><h3>최근 활동</h3><div className="drawerActivities">{[
        ...selectedMember.issues.map((item) => ({ ...item, kind: "이슈" })),
        ...selectedMember.pullRequests.map((item) => ({ ...item, kind: "PR" })),
        ...selectedMember.reviewedPullRequests.map((item) => ({ ...item, kind: "리뷰", createdAt: item.reviewedAt || item.updatedAt })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map((item, index) => <a href={item.url} target="_blank" rel="noreferrer" key={`${item.kind}-${item.number}-${index}`}><span>{item.kind}</span><div><b>#{item.number} {item.title}</b><small>{dateFmt.format(new Date(item.createdAt))} · {item.kind === "이슈" ? issueResolutionLabel(item) : stateLabel(item.state)}</small></div></a>)}</div></aside></div>}
    </main>
  );
}
