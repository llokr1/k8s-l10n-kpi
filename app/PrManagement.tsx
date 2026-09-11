"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import snapshot from "./pr-management.json";
import { ASSIGNABLE_LOGINS, SIZE_WEIGHTS, loginKey, workState, workload } from "../lib/pr-management.mjs";

type Evidence = { login: string; state?: string; at: string; url?: string; commitId?: string };
type Issue = { number: number; repository: string; title: string; url: string; createdAt?: string; kind: string };
type PullRequest = {
  number: number; title: string; url: string; author: string; createdAt: string; state: string;
  draft: boolean; size?: string; checkedAt: string | null; syncError?: string; headSha?: string;
  labels: string[]; reviews: Evidence[]; completed: Evidence[]; lgtm: Evidence[]; approve: Evidence[];
  issues: Issue[]; files: string[]; translation: string;
};
type Manual = { reviewers: string[]; excluded: boolean };
type Data = {
  generatedAt: string | null; trackingStart: string; includeOpenBacklog: boolean;
  lastSuccessfulAt: string | null; discoveryComplete: boolean; errors: string[]; pullRequests: PullRequest[];
  assignments?: Record<string, Manual>; assignmentSource?: { status: string; fetchedAt: string | null };
};
const emptyManual: Manual = { reviewers: [], excluded: false };
const labels: Record<string, string> = { all: "전체", unassigned: "미배정", reviewing: "리뷰 중", approver: "Approver 점검", approved: "승인됨", draft: "Draft", merged: "Merged", closed: "Closed", excluded: "번역 PR X", unknown: "확인 필요" };
const date = (value?: string | null, withTime = false) => value && !Number.isNaN(new Date(value).getTime()) ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", ...(withTime ? { timeStyle: "short" as const } : {}) }).format(new Date(value)) : "—";

export default function PrManagement({ members }: { members: { name: string; githubId: string }[] }) {
  const [data, setData] = useState<Data>(snapshot as Data);
  const [tab, setTab] = useState("prs");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [reviewerFilter, setReviewerFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const connected = data.assignmentSource?.status === "connected";
  const assignments = useMemo(() => data.assignments || {}, [data.assignments]);
  const team = (login: string) => ASSIGNABLE_LOGINS.includes(loginKey(login)) ? "kubernetes" : members.some((member) => loginKey(member.githubId) === loginKey(login)) ? "volunteer" : "external";
  const stateOf = (pr: PullRequest, manual: Manual) => {
    const state = workState(pr, manual);
    return !connected && ["unassigned", "reviewing", "approver", "approved"].includes(state) ? "unknown" : state;
  };

  async function refresh() {
    setBusy(true); setError("");
    try {
      const response = await fetch("./data/pr-management.json", { cache: "no-store" });
      if (!response.ok) throw new Error("수집 데이터를 불러오지 못했습니다. 마지막 데이터를 유지합니다.");
      const next = await response.json();
      if (next.repository !== "kubernetes/website" || !Array.isArray(next.pullRequests) || !Array.isArray(next.errors) || !next.trackingStart) throw new Error("수집 데이터 형식을 확인해주세요.");
      setData(next);
      setMessage("최근 배포된 수집 결과를 불러왔습니다. 새 GitHub 수집은 예약 작업 또는 Actions에서 실행합니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "불러오기 실패"); }
    finally { setBusy(false); }
  }
  const onAutoRefresh = useEffectEvent(() => { if (!document.hidden) void refresh(); });
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(onAutoRefresh, 300000);
    return () => clearInterval(timer);
  }, [autoRefresh]);
  const rows = data.pullRequests.filter((pr) => {
    const manual = assignments[pr.number] || emptyManual;
    return (filter === "all" || stateOf(pr, manual) === filter)
      && (!reviewerFilter || manual.reviewers.includes(reviewerFilter))
      && (pr.number + " " + pr.title + " " + pr.author).toLowerCase().includes(query.toLowerCase());
  });
  const loads = ASSIGNABLE_LOGINS.map((login) => ({ login, ...workload(data.pullRequests, assignments, login) })).sort((a, b) => a.pendingWeight - b.pendingWeight || a.pending - b.pending || a.login.localeCompare(b.login));
  function person(login: string, url?: string) {
    if (!login) return <span>작성자 확인 대기</span>;
    return <a className={"prPerson " + team(login)} href={url || "https://github.com/" + login} target="_blank" rel="noreferrer">@{login}</a>;
  }

  return <section className="prManagement">
    <header className="prHeading"><div><h1>한국어 번역 PR 관리</h1><p>kubernetes/website · {date(data.trackingStart)} 이후{data.includeOpenBacklog ? " · 기존 Open 후보 포함" : " 생성된 PR"} · 종료 후에도 기록 유지</p></div><div className="prSync"><span>최근 수집 <b>{date(data.generatedAt, true)}</b></span><button onClick={refresh} disabled={busy}>{busy ? "불러오는 중…" : "↻ 최신 데이터"}</button><label><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />5분마다 불러오기</label></div></header>
    <div className="prNotice">{connected ? <>배정 반영 {date(data.assignmentSource?.fetchedAt, true)}</> : <strong>Private 저장소 연결 대기</strong>} · 배정은 Private 저장소의 <code>review-assignments.json</code>에서 수정합니다.<small>공개 항목: 리뷰어 GitHub ID·대상 제외 여부. 리뷰 기한·내부 비고·담당 Approver는 사이트에 공개하지 않습니다.</small></div>
    {!data.discoveryComplete && <p className="prNotice">아직 전체 수집이 완료되지 않았습니다. 아래 목록과 집계는 전체 PR 현황으로 볼 수 없습니다.</p>}
    {data.errors.length > 0 && <details className="prNotice"><summary>수집 오류 {data.errors.length}건 · 마지막 정상 데이터 유지</summary>{data.errors.map((item, index) => <p key={index}>{item}</p>)}</details>}
    {message && <p className="prFeedback" role="status">{message}</p>}
    {error && <p className="prError" role="alert">{error}</p>}
    <div className="prTabs"><button aria-pressed={tab === "prs"} onClick={() => setTab("prs")}>PR wrangler</button><button aria-pressed={tab === "reviewers"} onClick={() => setTab("reviewers")}>Reviewer 할당 현황</button></div>
    <div className="prLegend"><span className="prPerson kubernetes">쿠버네티스</span><span className="prPerson volunteer">오픈스택</span><span>일반 댓글은 리뷰 완료에 포함하지 않습니다.</span></div>
    {tab === "prs" ? <>
      <div className="prToolbar"><label>검색<input placeholder="PR 번호, 제목, GitHub ID" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>진행 상태<select value={filter} onChange={(event) => setFilter(event.target.value)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value} disabled={!connected && ["unassigned", "reviewing", "approver", "approved", "excluded"].includes(value)}>{label}</option>)}</select></label><label>배정 리뷰어<select disabled={!connected} value={reviewerFilter} onChange={(event) => setReviewerFilter(event.target.value)}><option value="">전체</option>{ASSIGNABLE_LOGINS.map((login) => <option key={login} value={login}>@{login}</option>)}</select></label><span>{rows.length} / {data.pullRequests.length}건</span></div>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="prTableWrap" tabIndex={0} role="region" aria-label="PR 관리 표 · 가로 스크롤 가능"><table className="prGrid"><thead><tr><th>PR / 제목</th><th>GitHub 계정</th><th>Issue</th><th>Issue 생성일</th><th>PR 생성일</th><th>size</th><th>Status</th><th className="prManualColumn">Reviewer</th><th>Review 완료 여부</th><th>lgtm 개수</th><th>Approver</th><th>관리 상태</th></tr></thead><tbody>
        {rows.map((pr) => {
          const manual = assignments[pr.number] || emptyManual;
          const state = stateOf(pr, manual);
          const completed = new Set(pr.completed.map((review) => loginKey(review.login)));
          return <tr key={pr.number} className={state === "excluded" ? "prExcluded" : ""}>
            <td><a className="prTitle" href={pr.url} target="_blank" rel="noreferrer"><b>#{pr.number}</b><span>{pr.title}</span></a>{pr.translation === "not-translation" && <small className="prWarning">한국어 Markdown 변경 없음 · 제외 검토</small>}{pr.syncError && <small className="prWarning">갱신 실패 · {date(pr.checkedAt, true)} 기준</small>}</td>
            <td>{person(pr.author)}</td>
            <td>{pr.issues.length ? pr.issues.map((issue) => <a className="prIssue" key={issue.repository + "#" + issue.number} href={issue.url} target="_blank" rel="noreferrer" title={issue.title}>#{issue.number}<small>{issue.kind === "closing" ? "해결할 이슈" : "관련"}</small></a>) : "—"}</td>
            <td>{pr.issues.map((issue) => <small key={issue.repository + "#" + issue.number}>#{issue.number} {date(issue.createdAt)}</small>)}</td><td>{date(pr.createdAt)}</td><td>{pr.size?.replace("size/", "") || "—"}</td>
            <td><span className={"prState " + pr.state}>{pr.draft ? "Draft" : pr.state === "merged" ? "Merged" : pr.state === "closed" ? "Closed" : pr.state === "open" ? "Open" : "확인 중"}</span>{pr.labels.includes("do-not-merge/hold") && <small>hold</small>}</td>
            <td>{!connected ? <small>연결 대기</small> : manual.reviewers.length ? manual.reviewers.map((login) => <div key={login}>{person(login)} {completed.has(login) ? "✓" : ""}</div>) : <small>미배정</small>}</td>
            <td>{!pr.checkedAt ? <small>GitHub 상세 수집 대기</small> : pr.completed.length ? pr.completed.map((review) => <div key={review.login}>{person(review.login, review.url)}<small>{review.state === "LGTM" ? "/lgtm" : review.state === "APPROVED" ? "승인 리뷰" : "제출된 리뷰"}{review.commitId && review.commitId !== pr.headSha ? " · 이전 커밋" : ""}</small></div>) : "—"}{pr.reviews.filter((review) => review.state === "CHANGES_REQUESTED").map((review) => <div key={review.login}>{person(review.login, review.url)}<small className="prWarning">수정 요청</small></div>)}</td>
            <td>{pr.checkedAt ? pr.lgtm.length : "—"}<small>{pr.checkedAt ? pr.labels.includes("lgtm") ? "lgtm 라벨 있음" : "lgtm 라벨 없음" : "확인 대기"}</small></td>
            <td>{pr.approve.map((entry) => <div key={entry.login}>{person(entry.login, entry.url)}<small>/approve 기록</small></div>)}{pr.labels.includes("approved") && <small>approved 라벨 있음</small>}{state === "approver" && <b className="prWarning">점검 필요</b>}</td>
            <td>{!connected && state === "unknown" && pr.checkedAt && !pr.syncError ? "배정 연결 대기" : labels[state]}</td>
          </tr>;
        })}
        {!rows.length && <tr><td colSpan={12} className="prEmpty">{data.discoveryComplete ? "현재 조건에 해당하는 PR이 없습니다." : "수집 대기 중입니다. 실제 GitHub 데이터를 수집한 후 표시합니다."}</td></tr>}
      </tbody></table></div>
      <details className="prMethod"><summary>수집·완료 판정 기준</summary><p>기준일 이후 모든 PR의 변경 파일을 확인하여 content/ko/의 Markdown 작업을 찾습니다. 기존 Open PR은 language/ko 라벨·[ko] 제목 후보를 수집합니다. 배정 파일에 추가한 PR도 수집하며, 종료 후에도 이력을 유지합니다. 비번역 작업은 배정 파일에서 excluded를 true로 설정합니다.</p><p>완료는 최신 제출 리뷰(COMMENTED·APPROVED) 또는 취소되지 않은 /lgtm 기록입니다. CHANGES_REQUESTED·DISMISSED는 완료에서 제외합니다. 이전 커밋 리뷰는 별도로 표시합니다. 배정 인원이 1명 이상이고 모두 완료하면 Approver 점검 대상으로 표시합니다.</p><p>lgtm 개수는 취소되지 않은 명령 작성자 수이며 권한 있는 승인 수와는 다를 수 있습니다. 실제 Prow 상태는 lgtm·approved 라벨과 GitHub에서 확인하세요. 배정 파일 변경은 GitHub 리뷰 요청을 자동 전송하지 않습니다. 자동 수집은 배포 설정 후 매시간 실행되며, GitHub 예약 작업은 지연될 수 있습니다.</p></details>
    </> : <>
      <p className="prLoadHint">배정 가중치: {Object.entries(SIZE_WEIGHTS).map(([size, weight]) => size + " " + weight).join(" · ")} · 남은 가중치가 낮은 순서입니다. 완료 여부는 GitHub 리뷰 기록을 기준으로 합니다.</p>
      <div className="prTableWrap"><table className="prGrid prLoadGrid"><thead><tr><th>Reviewer</th><th>총 할당 건수</th><th>완료 개수</th><th>진행률</th><th>미완료 Open</th><th>Total Score</th><th>남은 가중치</th></tr></thead><tbody>{loads.map((load) => <tr key={load.login}><td>{person(load.login)}</td>{connected ? <><td>{load.assigned}</td><td>{load.completed}</td><td>{load.assigned ? Math.round(load.completed / load.assigned * 100) + "%" : "—"}</td><td>{load.pending}</td><td>{load.totalWeight}</td><td>{load.pendingWeight}{load.unknownSize > 0 && <small>크기 미확인 {load.unknownSize}건 별도</small>}</td></> : <td colSpan={6}>Private 저장소 연결 대기</td>}</tr>)}</tbody></table></div>
    </>}
  </section>;
}
