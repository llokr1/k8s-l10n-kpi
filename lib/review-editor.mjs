import { REVIEWER_LOGINS, loginKey, validateAssignment } from "./pr-management.mjs";

export function editableAssignment(value = {}) {
  return { reviewers: value.reviewers || [], completedReviewers: value.completedReviewers || [], reviewOverrides: value.reviewOverrides || {}, deadline: value.deadline || "", approver: value.approver || "", notes: value.notes || "", excluded: value.excluded === true, legacyReviewers: value.legacyReviewers || [] };
}

export function updateAssignment(document, number, change, author) {
  const before = document.assignments[number] || {};
  if (!Array.isArray(change.reviewers) || change.reviewers.some(x => typeof x !== "string")) throw new Error("리뷰어 명단 형식 오류");
  if (typeof change.notes !== "string" || change.notes.length > 2000) throw new Error("비고는 2,000자 이내로 입력하세요.");
  if (typeof change.excluded !== "boolean") throw new Error("제외 여부 형식 오류");
  const validated = validateAssignment({ author }, change);
  const allowed = new Set([...(document.roster || []).map(x => loginKey(x.githubId)), ...REVIEWER_LOGINS]);
  const completed = change.completedReviewers || [];
  if (!Array.isArray(completed) || completed.some(x => typeof x !== "string" || !allowed.has(loginKey(x)) || loginKey(x) === loginKey(author))) throw new Error("완료 명단을 확인하세요.");
  const overrides = change.reviewOverrides || {};
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides) || Object.entries(overrides).some(([k,v]) => !allowed.has(loginKey(k)) || typeof v !== "boolean" || loginKey(k) === loginKey(author))) throw new Error("완료 확인 형식 오류");
  const updated = { ...before, ...validated, completedReviewers: [...new Set(completed.map(loginKey))], reviewOverrides: Object.fromEntries(Object.entries(overrides).map(([k,v]) => [loginKey(k), v])), updatedAt: new Date().toISOString() };
  updated.legacyReviewers = (before.legacyReviewers || []).filter(login => !REVIEWER_LOGINS.includes(loginKey(login)) || loginKey(login) === loginKey(author));
  return { ...document, assignments: { ...document.assignments, [number]: updated } };
}
