"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import snapshot from "./pr-management.json";
import { ASSIGNABLE_LOGINS, REVIEWER_LOGINS, SIZE_WEIGHTS, loginKey, workState, workload, completedReviews, assignedReviewers } from "../lib/pr-management.mjs";
import ReviewerDropdown from "./ReviewerDropdown";

type Evidence = { login: string; state?: string; at: string; url?: string; commitId?: string };
type Issue = { number: number; repository: string; title: string; url: string; createdAt?: string; kind: string };
type PullRequest = {
  number: number; title: string; url: string; author: string; createdAt: string; state: string;
  draft: boolean; size?: string; checkedAt: string | null; syncError?: string; headSha?: string;
  labels: string[]; reviews: Evidence[]; completed: Evidence[]; lgtm: Evidence[]; approve: Evidence[];
  issues: Issue[]; files: string[]; translation: string; imported?: boolean; sheetLgtm?: string; sheetApprover?: string;
};
type Manual = { reviewers: string[]; excluded: boolean; completedReviewers?: string[]; reviewOverrides?: Record<string, boolean>; notes?: string; deadline?: string; approver?: string; legacyReviewers?: string[] };
type Internal = { revision: string; mode: string; assignments: Record<string, Manual>; pullRequests: PullRequest[]; roster: { githubId: string; name: string; team: string }[]; importedAt: string; githubCollectedAt?: string };
type Data = {
  generatedAt: string | null; trackingStart: string; includeOpenBacklog: boolean;
  lastSuccessfulAt: string | null; discoveryComplete: boolean; errors: string[]; pullRequests: PullRequest[];
  assignments?: Record<string, Manual>; assignmentSource?: { status: string; fetchedAt: string | null };
};
const emptyManual: Manual = { reviewers: [], excluded: false };
const labels: Record<string, string> = { all: "전체", unassigned: "미배정", reviewing: "리뷰 중", approver: "Approver 점검", approved: "승인됨", draft: "Draft", merged: "Merged", closed: "Closed", excluded: "번역 PR X", unknown: "확인 필요" };
const date = (value?: string | null, withTime = false) => value && !Number.isNaN(new Date(value).getTime()) ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", ...(withTime ? { timeStyle: "short" as const } : {}) }).format(new Date(value)) : "—";
const configuredReviewApiUrl = String(import.meta.env.VITE_REVIEW_API_URL || "").trim().replace(/\/+$/, "");

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
  const [internal, setInternal] = useState<Internal | null>(null);
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const connected = Boolean(internal) || data.assignmentSource?.status === "connected";
  const assignments = useMemo(() => internal?.assignments || data.assignments || {}, [internal, data.assignments]);
  const prs = internal?.pullRequests || data.pullRequests;
  const apiUrl = () => {
    if (configuredReviewApiUrl) return configuredReviewApiUrl;
    if (["localhost", "127.0.0.1"].includes(window.location.hostname)) return "http://127.0.0.1:3101/api/reviews";
    throw new Error("내부 편집 서버 URL이 설정되지 않았습니다.");
  };
  async function refreshInternal() {
    const response = await fetch(apiUrl(), { cache: "no-store" });
    if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || "내부 저장 서버 연결을 확인하세요."); }
    const value = await response.json();
    if (!value.revision || !value.assignments || !Array.isArray(value.pullRequests)) throw new Error("내부 데이터 형식 오류");
    setInternal(value);
  }
  const initialLoad = useEffectEvent(() => { void refreshInternal().catch(() => {}); });
  useEffect(() => {
    const timer = setTimeout(initialLoad, 0);
    return () => clearTimeout(timer);
  }, []);
  async function saveSelection(pr: PullRequest, kind: "reviewers" | "completed", chosen: string[], revision: string) {
    const manual = assignments[pr.number] || emptyManual;
    const next: Manual = { notes: "", ...manual, reviewers: assignedReviewers(pr, manual) };
    if (kind === "reviewers") next.reviewers = chosen;
    else {
      const previous = new Set(completedReviews(pr, manual).map((review: Evidence) => loginKey(review.login)));
      next.reviewOverrides = { ...manual.reviewOverrides, ...Object.fromEntries(REVIEWER_LOGINS.filter(login => login !== loginKey(pr.author) && previous.has(login) !== chosen.includes(login)).map(login => [login, chosen.includes(login)])) };
    }
    await saveManual(pr, next, revision);
  }
  async function saveManual(pr: PullRequest, next: Manual, revision: string) {
    const response = await fetch(apiUrl() + "/" + pr.number, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, assignment: next }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "저장 실패");
    setMessage(result.mode === "local" ? "로컬 비공개 JSON에 저장했습니다." : "Private 저장소에 커밋하고 푸시했습니다.");
    await refreshInternal();
  }
  async function saveDeadline(pr: PullRequest, deadline: string) {
    if (!internal) return;
    setError("");
    try {
      const manual = assignments[pr.number] || emptyManual;
      await saveManual(pr, { notes: "", ...manual, reviewers: assignedReviewers(pr, manual), deadline }, internal.revision);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "기한 저장 실패"); }
  }
  function beginNote(pr: PullRequest) {
    setEditingNote(pr.number);
    setNoteDraft(assignments[pr.number]?.notes || "");
    setError("");
  }
  async function saveNote(pr: PullRequest) {
    if (!internal || noteSaving) return;
    const manual = assignments[pr.number] || emptyManual;
    if (noteDraft === (manual.notes || "")) { setEditingNote(null); return; }
    setNoteSaving(true); setError("");
    try {
      await saveManual(pr, { ...manual, reviewers: assignedReviewers(pr, manual), notes: noteDraft }, internal.revision);
      setEditingNote(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "비고 저장 실패"); }
    finally { setNoteSaving(false); }
  }
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
      if (internal) await refreshInternal();
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
  const rows = prs.filter((pr) => {
    const manual = assignments[pr.number] || emptyManual;
    return (filter === "all" || stateOf(pr, manual) === filter)
      && (!reviewerFilter || assignedReviewers(pr, manual).includes(reviewerFilter))
      && (pr.number + " " + pr.title + " " + pr.author).toLowerCase().includes(query.toLowerCase());
  });
  const roster = REVIEWER_LOGINS.map(login => ({ login, name: internal?.roster.find(x => loginKey(x.githubId) === login)?.name || members.find(x => loginKey(x.githubId) === login)?.name || login, team: ASSIGNABLE_LOGINS.includes(login) ? "kubernetes" : "volunteer" }));
  const loads = roster.filter(member => member.team === "kubernetes").map(({ login }) => ({ login, ...workload(prs, assignments, login) })).sort((a, b) => a.totalWeight - b.totalWeight || a.login.localeCompare(b.login));
  function person(login: string, url?: string) {
    if (!login) return <span>작성자 확인 대기</span>;
    return <a className={"prPerson " + team(login)} href={url || "https://github.com/" + login} target="_blank" rel="noreferrer" title={"@" + login}>{internal?.roster.find(x => x.githubId === login)?.name || login}</a>;
  }

  return <section className="prManagement">
    <header className="prHeading"><div><h1>한국어 번역 PR 관리</h1><p>kubernetes/website · {date(data.trackingStart)} 이후{internal ? " · 기존 시트 이력 포함" : data.includeOpenBacklog ? " · 기존 Open 후보 포함" : " 생성된 PR"} · 종료 후에도 기록 유지</p></div><div className="prSync"><span>최근 수집 <b>{date(internal?.githubCollectedAt || data.generatedAt, true)}</b></span><button onClick={refresh} disabled={busy}>{busy ? "불러오는 중…" : "↻ 최신 데이터"}</button><label><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />5분마다 불러오기</label></div></header>
    {!internal && <div className="prNotice">내부 편집 연결 대기 <button onClick={() => refreshInternal().catch(cause => setError(cause.message))}>편집 서버 연결</button></div>}
    {!data.discoveryComplete && <p className="prNotice">아직 전체 수집이 완료되지 않았습니다. 아래 목록과 집계는 전체 PR 현황으로 볼 수 없습니다.</p>}
    {data.errors.length > 0 && <details className="prNotice"><summary>수집 오류 {data.errors.length}건 · 마지막 정상 데이터 유지</summary>{data.errors.map((item, index) => <p key={index}>{item}</p>)}</details>}
    {message && <p className="prFeedback" role="status">{message}</p>}
    {error && <p className="prError" role="alert">{error}</p>}
    <div className="prTabs"><button aria-pressed={tab === "prs"} onClick={() => setTab("prs")}>PR wrangler</button><button aria-pressed={tab === "reviewers"} onClick={() => setTab("reviewers")}>리뷰 현황</button></div>
    <div className="prLegend"><span className="prPerson kubernetes">쿠버네티스</span><span className="prPerson volunteer">오픈스택</span><span>일반 댓글은 리뷰 완료에 포함하지 않습니다.</span></div>
    {tab === "prs" ? <>
      <div className="prToolbar"><label>검색<input placeholder="PR 번호, 제목, GitHub ID" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>진행 상태<select value={filter} onChange={(event) => setFilter(event.target.value)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value} disabled={!connected && ["unassigned", "reviewing", "approver", "approved", "excluded"].includes(value)}>{label}</option>)}</select></label><label>배정 리뷰어<select disabled={!connected} value={reviewerFilter} onChange={(event) => setReviewerFilter(event.target.value)}><option value="">전체</option>{REVIEWER_LOGINS.map((login) => <option key={login} value={login}>@{login}</option>)}</select></label><span>{rows.length} / {prs.length}건</span></div>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="prTableWrap" tabIndex={0} role="region" aria-label="PR 관리 표 · 가로 스크롤 가능"><table className="prGrid"><thead><tr><th>PR</th><th>작성자</th><th>Issue</th><th>이슈 생성</th><th>PR 생성</th><th>size</th><th>Status</th><th className="prManualColumn">Reviewer</th><th>Review 완료</th><th>LGTM</th><th>Approver</th><th>관리 상태</th><th>기한</th><th>비고</th></tr></thead><tbody>
        {rows.map((pr) => {
          const manual = assignments[pr.number] || emptyManual;
          const state = stateOf(pr, manual);
          const reviews = completedReviews(pr, manual) as Evidence[];
          const completed = new Set(reviews.map((review) => loginKey(review.login)));
          const lgtmCount = pr.checkedAt ? pr.lgtm.length : Number(String(pr.sheetLgtm || "").match(/\d+/)?.[0] || 0);
          return <tr key={pr.number} className={state === "excluded" ? "prExcluded" : ""}>
            <td><a className="prNumber" href={pr.url} target="_blank" rel="noreferrer" title={pr.title}>#{pr.number}</a>{pr.translation === "not-translation" && <small className="prWarning">제외 검토</small>}{pr.syncError && <small className="prWarning">갱신 실패</small>}</td>
            <td>{person(pr.author)}</td>
            <td>{pr.issues.length ? pr.issues.map((issue) => <a className="prIssue" key={issue.repository + "#" + issue.number} href={issue.url} target="_blank" rel="noreferrer" title={issue.title}>#{issue.number}</a>) : "—"}</td>
            <td>{pr.issues.length ? pr.issues.map((issue) => <small key={issue.repository + "#" + issue.number}>{date(issue.createdAt)}</small>) : "—"}</td><td>{date(pr.createdAt)}</td><td>{pr.size?.replace("size/", "") || "—"}</td>
            <td><span className={"prState " + pr.state}>{pr.draft ? "Draft" : pr.state === "merged" ? "Merged" : pr.state === "closed" ? "Closed" : pr.state === "open" ? "Open" : "확인 중"}</span>{pr.labels.includes("do-not-merge/hold") && <small>hold</small>}</td>
            <td>{internal ? <ReviewerDropdown label={`#${pr.number} Reviewer`} members={roster} value={assignedReviewers(pr, manual)} author={pr.author} revision={internal.revision} onApply={(chosen, revision) => saveSelection(pr, "reviewers", chosen, revision)}>{assignedReviewers(pr, manual).length ? assignedReviewers(pr, manual).map(login => <span className={"prPerson " + team(login)} key={login}>{roster.find(x => x.login === login)?.name || login}{completed.has(login) ? " ✓" : ""}</span>) : "미배정"}</ReviewerDropdown> : connected ? assignedReviewers(pr, manual).map(login => <div key={login}>{person(login)}</div>) : "연결 대기"}</td>
            <td>{internal ? <ReviewerDropdown label={`#${pr.number} Review 완료`} members={roster} value={reviews.map(review => loginKey(review.login))} author={pr.author} revision={internal.revision} onApply={(chosen, revision) => saveSelection(pr, "completed", chosen, revision)}>{reviews.length ? reviews.map(review => <span className={"prPerson " + team(review.login)} key={review.login} title={review.state === "MANUAL" ? "운영자 확인" : "GitHub 리뷰"}>{roster.find(x => x.login === loginKey(review.login))?.name || review.login}</span>) : "—"}</ReviewerDropdown> : reviews.map(review => <div key={review.login}>{person(review.login, review.url)}</div>)}{pr.reviews.filter(review => review.state === "CHANGES_REQUESTED").map(review => <small key={review.login} className="prWarning">@{review.login} 수정 요청</small>)}</td>
            <td>{lgtmCount}</td>
            <td>{manual.approver && person(manual.approver)}{pr.sheetApprover && !manual.approver && <small>{pr.sheetApprover}</small>}{pr.approve.map((entry) => <div key={entry.login}>{person(entry.login, entry.url)}<small>/approve</small></div>)}{pr.labels.includes("approved") && <small>approved</small>}{state === "approver" && <b className="prWarning">점검 필요</b>}</td>
            <td>{!connected && state === "unknown" && pr.checkedAt && !pr.syncError ? "배정 연결 대기" : labels[state]}</td>
            <td>{internal ? <input className="prDeadlineInput" type="date" aria-label={`#${pr.number} 리뷰 기한`} value={manual.deadline || ""} onChange={event => void saveDeadline(pr, event.target.value)} /> : manual.deadline || "—"}</td>
            <td>{internal ? editingNote === pr.number ? <input className="prNoteInput" ref={element => element?.focus()} maxLength={2000} disabled={noteSaving} aria-label={`#${pr.number} 비고`} value={noteDraft} onChange={event => setNoteDraft(event.target.value)} onBlur={() => void saveNote(pr)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /> : <button className="prNoteEdit" onClick={() => beginNote(pr)}>{manual.notes || "+비고 입력"}</button> : "내부 전용"}</td>
          </tr>;
        })}
        {!rows.length && <tr><td colSpan={14} className="prEmpty">{data.discoveryComplete ? "현재 조건에 해당하는 PR이 없습니다." : "수집 대기 중입니다. 실제 GitHub 데이터를 수집한 후 표시합니다."}</td></tr>}
      </tbody></table></div>
      <details className="prMethod"><summary>수집·완료 판정 기준</summary><p>기준일 이후 모든 PR의 변경 파일을 확인하여 content/ko/의 Markdown 작업을 찾습니다. 기존 Open PR은 language/ko 라벨·[ko] 제목 후보를 수집합니다. 배정 파일에 추가한 PR도 수집하며, 종료 후에도 이력을 유지합니다. 비번역 작업은 배정 파일에서 excluded를 true로 설정합니다.</p><p>완료는 시트 이력·운영자 수동 설정을 반영하며, 자동 판정은 최신 제출 리뷰(COMMENTED·APPROVED) 또는 취소되지 않은 /lgtm 기록입니다. CHANGES_REQUESTED·DISMISSED는 완료에서 제외합니다. GitHub 리뷰와 운영자 확인은 이름 위에 마우스를 올려 구분합니다. 배정 인원이 1명 이상이고 모두 완료하면 Approver 점검 대상으로 표시합니다.</p><p>lgtm 개수는 취소되지 않은 명령 작성자 수이며 권한 있는 승인 수와는 다를 수 있습니다. 실제 Prow 상태는 lgtm·approved 라벨과 GitHub에서 확인하세요. 배정 파일 변경은 GitHub 리뷰 요청을 자동 전송하지 않습니다. 자동 수집은 배포 설정 후 매시간 실행되며, GitHub 예약 작업은 지연될 수 있습니다.</p></details>
    </> : <>
      <div className="prToolbar"><span>쿠버네티스 팀 {loads.length}명 · 검토 대상 {loads.reduce((sum, row) => sum + row.assigned, 0)}건 · 완료 {loads.reduce((sum, row) => sum + row.completed, 0)}건</span></div>
      <p className="prLoadHint">가중치: {Object.entries(SIZE_WEIGHTS).map(([size, weight]) => size + " " + weight).join(" · ")}. 모든 PR의 Reviewer 배정과 Review 완료 기록을 반영합니다. 번역 PR X도 포함하며, 건수는 PR × 리뷰어 단위입니다.</p>
      <div className="prTableWrap"><table className="prGrid prLoadGrid"><thead><tr><th>Reviewer</th>{Object.keys(SIZE_WEIGHTS).map(size => <th key={size}>{size}</th>)}<th>Total Score</th><th>검토 대상</th><th>완료</th><th>진행률</th></tr></thead><tbody>{loads.map((load) => <tr key={load.login}><td>{person(load.login)}</td>{connected ? <>{Object.keys(SIZE_WEIGHTS).map(size => <td key={size}>{load.sizes[size]}</td>)}<td>{load.totalWeight}{load.unknownSize > 0 && <small>크기 미확인 {load.unknownSize}건 제외</small>}</td><td>{load.assigned}</td><td>{load.completed}</td><td>{load.assigned ? Math.round(load.completed / load.assigned * 100) + "%" : "—"}</td></> : <td colSpan={10}>Private 저장소 연결 대기</td>}</tr>)}</tbody></table></div>
    </>}
  </section>;
}
