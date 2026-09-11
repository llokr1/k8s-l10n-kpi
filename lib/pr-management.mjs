// GitHub identifiers are case-insensitive. Names are presentation only.
export const loginKey = (value) => String(value || "").trim().toLowerCase();
export const SIZE_WEIGHTS = { XS: 1, S: 4, M: 13, L: 60, XL: 150, XXL: 300 };
// Source: Reviewer 할당 현황!A3:A16, inspected 2026-09-11.
export const ASSIGNABLE_LOGINS = ["m3k0813", "bckmini", "neronsoda", "woonkim0413", "llokr1", "gpffh20", "ye11oc4t", "hkkim2021", "yucori", "wlgusqkr", "dongjune8931", "starbea", "suhyenim", "jiyubaek"];

export function cleanMarkdown(body) {
  return String(body || "").replace(/<!--[\s\S]*?-->/g, "").replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "").replace(/^\s*>.*$/gm, "");
}

export function issueReferences(body) {
  const found = new Map();
  for (const line of cleanMarkdown(body).split(/\r?\n/)) {
    const closing = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?(?:\s|$)/i.test(line);
    for (const match of line.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)|(?<![\w/])([\w.-]+\/[\w.-]+)#(\d+)|(?<![\w/#])#(\d+)/g)) {
      const repository = match[1] || match[3] || "kubernetes/website";
      const number = Number(match[2] || match[4] || match[5]);
      const key = `${repository.toLowerCase()}#${number}`;
      const previous = found.get(key);
      found.set(key, { repository, number, kind: closing || previous?.kind === "closing" ? "closing" : "related", url: `https://github.com/${repository}/issues/${number}` });
    }
  }
  return [...found.values()];
}

export function reviewEvidence(reviews, comments, author) {
  const latest = new Map();
  const events = [];
  const valid = (user) => user?.login && user.type !== "Bot" && !user.login.endsWith("[bot]") && loginKey(user.login) !== loginKey(author);
  for (const review of [...reviews].sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)) || a.id - b.id)) {
    if (!valid(review.user) || !review.submitted_at || review.state === "PENDING") continue;
    latest.set(loginKey(review.user.login), { login: loginKey(review.user.login), state: review.state, at: review.submitted_at, url: review.html_url, commitId: review.commit_id });
    events.push({ ...review, created_at: review.submitted_at });
  }
  events.push(...comments.filter((comment) => valid(comment.user)));
  events.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id);
  const lgtm = new Map();
  const approve = new Map();
  for (const event of events) {
    if (!valid(event.user)) continue;
    for (const line of cleanMarkdown(event.body).split(/\r?\n/)) {
      const command = line.trim().match(/^\/(lgtm|approve)(?:\s+(cancel))?\s*$/i);
      if (!command) continue;
      const target = command[1].toLowerCase() === "lgtm" ? lgtm : approve;
      const key = loginKey(event.user.login);
      if (command[2]) target.delete(key);
      else target.set(key, { login: key, at: event.created_at, url: event.html_url });
    }
  }
  // A submitted COMMENTED review is an actual review. An ordinary issue comment is not.
  const completed = new Map([...latest].filter(([, review]) => ["APPROVED", "COMMENTED"].includes(review.state)));
  for (const [key, evidence] of lgtm) {
    if (!["CHANGES_REQUESTED", "DISMISSED"].includes(latest.get(key)?.state)) completed.set(key, { ...evidence, state: "LGTM" });
  }
  return { reviews: [...latest.values()], completed: [...completed.values()], lgtm: [...lgtm.values()], approve: [...approve.values()] };
}

export function workState(pr, manual = {}) {
  if (manual.excluded || /번역\s*PR\s*X/i.test(manual.notes || "")) return "excluded";
  if (pr.state === "merged" || pr.state === "closed") return pr.state;
  if (pr.syncError || !pr.checkedAt) return "unknown";
  if (pr.draft) return "draft";
  const assigned = [...new Set((manual.reviewers || []).map(loginKey))];
  if (!assigned.length) return "unassigned";
  const completed = new Set((pr.completed || []).map((review) => loginKey(review.login)));
  if (assigned.every((login) => completed.has(login))) return pr.labels?.includes("approved") ? "approved" : "approver";
  return "reviewing";
}

export function validateAssignment(pr, manual, eligible = ASSIGNABLE_LOGINS) {
  const reviewers = [...new Set((manual.reviewers || []).map(loginKey))];
  if (reviewers.some((login) => !eligible.includes(login))) throw new Error("쿠버네티스 팀만 수동 배정할 수 있습니다.");
  if (reviewers.includes(loginKey(pr.author))) throw new Error("PR 작성자는 본인 PR의 리뷰어로 배정할 수 없습니다.");
  if (manual.deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(manual.deadline) || new Date(manual.deadline).toISOString().slice(0, 10) !== manual.deadline)) throw new Error("올바른 리뷰 기한을 입력하세요.");
  if (String(manual.notes || "").length > 2000) throw new Error("비고는 2,000자 이내로 입력하세요.");
  return { reviewers, deadline: manual.deadline || "", notes: String(manual.notes || ""), excluded: Boolean(manual.excluded), approver: loginKey(manual.approver) };
}

export function workload(prs, assignments, login) {
  const assigned = prs.filter((pr) => (assignments[pr.number]?.reviewers || []).map(loginKey).includes(loginKey(login)) && workState(pr, assignments[pr.number]) !== "excluded");
  const done = (pr) => (pr.completed || []).some((review) => loginKey(review.login) === loginKey(login));
  const pending = assigned.filter((pr) => !["closed", "merged"].includes(pr.state) && !done(pr));
  const weight = (pr) => SIZE_WEIGHTS[pr.size?.replace("size/", "")] || 0;
  return { assigned: assigned.length, completed: assigned.filter(done).length, pending: pending.length, totalWeight: assigned.reduce((sum, pr) => sum + weight(pr), 0), pendingWeight: pending.reduce((sum, pr) => sum + weight(pr), 0), unknownSize: pending.filter((pr) => !weight(pr)).length };
}
