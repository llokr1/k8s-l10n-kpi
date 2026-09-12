import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { ASSIGNABLE_LOGINS, REVIEWER_LOGINS } from "../lib/pr-management.mjs";
// Retain every CSV field verbatim as a migration audit, in the private output only.
export function parseCsv(text) {
  const rows = []; let row = [], field = "", quoted = false;
  for (let i=0; i<text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i+1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === "," || c === "\n")) { row.push(field.replace(/\r$/, "")); field=""; if(c === "\n"){ rows.push(row); row=[]; } }
    else field += c;
  }
  if (quoted) throw new Error("CSV 형식 오류");
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}
const source = process.argv[2];
if (!source) throw new Error("CSV 경로가 필요합니다.");
const output = resolve(process.argv[3] || "private-data/review-assignments.json");
if (output.includes("/public/") || output.includes("/app/")) throw new Error("비공개 출력 위치를 사용하세요.");
const raw = await readFile(source, "utf8");
const rows = parseCsv(raw.replace(/^\uFEFF/, ""));
const expected = ["Github 계정","Issue","Issue 생성일","PR","PR 생성일","size","Status","Reviewer","Review 완료 여부","리뷰 기한","lgtm 개수","Approver","비고"];
if (expected.some((x,i)=>rows[0][i] !== x)) throw new Error("시트 열 구성이 다릅니다.");
const members = JSON.parse(await readFile("app/metrics.json", "utf8")).members;
const roster = new Map(members.map(x=>[x.githubId.toLowerCase(),{name:x.name,githubId:x.githubId.toLowerCase(),team:ASSIGNABLE_LOGINS.includes(x.githubId.toLowerCase()) ? "kubernetes":"openstack"}]));
const people = (value) => [...String(value || "").matchAll(/([^,\n()]*)\(([a-z\d-]+)\)/gi)].map(m=> {
  const githubId=m[2].toLowerCase();
  if(!roster.has(githubId)) roster.set(githubId,{githubId,name:m[1].trim(),team:ASSIGNABLE_LOGINS.includes(githubId) ? "kubernetes":"external"});
  return githubId;
});
const assignments = {}, pullRequests = [], unmatchedRows = [];
for (const [index,row] of rows.slice(1).entries()) {
  const number = Number(row[3]?.match(/^https:\/\/github\.com\/kubernetes\/website\/pull\/(\d+)\/?$/)?.[1]);
  if (!number) { if(row.some(Boolean)) unmatchedRows.push(index+2); continue; }
  if(assignments[number]) throw new Error("중복 PR 번호: " + number);
  const author = people(row[0])[0] || "";
  const originalReviewers = people(row[7]);
  const reviewers = originalReviewers.filter(x=>REVIEWER_LOGINS.includes(x) && x !== author);
  assignments[number] = { reviewers, legacyReviewers:originalReviewers.filter(x=>!reviewers.includes(x)), completedReviewers:people(row[8]), reviewOverrides:{}, deadline:row[9] || "", approver:people(row[11])[0] || "", notes:row[12] || "", excluded:/번역\s*PR\s*X/i.test(row[12]||""), sheetRow:index+2 };
  const issueNumbers = [...(row[1]||"").matchAll(/github\.com\/kubernetes\/website\/issues\/(\d+)/g)];
  const state = /^merge/i.test(row[6]) ? "merged" : /^close/i.test(row[6]) ? "closed" : "open";
  pullRequests.push({number,title:"PR #"+number,url:row[3],author,createdAt:row[4],state,draft:false,size:row[5],labels:row[6]==="hold"?["do-not-merge/hold"]:[],checkedAt:null,reviews:[],completed:[],lgtm:[],approve:[],issues:issueNumbers.map(m=>({number:Number(m[1]),repository:"kubernetes/website",url:m[0].startsWith("https")?m[0]:"https://"+m[0],kind:"related",title:"",createdAt:row[2]})),files:[],translation:"unchecked",imported:true,sheetLgtm:row[10],sheetStatus:row[6],sheetApprover:row[11]});
}
const document = {version:1,repository:"kubernetes/website",assignments,roster:[...roster.values()],pullRequests,importedAt:new Date().toISOString(),sourceSheet:{url:"https://docs.google.com/spreadsheets/d/17LELIYi9z3GihhClYVBqnhWTHRMN3mbrgBl85zkptXk/edit?gid=251444311",headers:rows[0],rows:rows.slice(1),unmatchedRows}};
await mkdir(dirname(output),{recursive:true,mode:0o700});
await writeFile(output,JSON.stringify(document,null,2)+"\n",{flag:"wx",mode:0o600});
console.log(JSON.stringify({prCount:pullRequests.length,sourceRows:rows.length-1,unmatchedRows:unmatchedRows.length,legacyAssignments:Object.values(assignments).filter(x=>x.legacyReviewers.length).length}));
