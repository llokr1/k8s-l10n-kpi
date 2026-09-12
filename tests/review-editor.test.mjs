import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateAssignment } from "../lib/review-editor.mjs";
import { completedReviews,workState } from "../lib/pr-management.mjs";
import { createReviewStore } from "../server/review-store.mjs";

test("편집은 원본 시트와 다른 PR을 보존하고 수동 완료·비고를 갱신한다",()=>{
  const document={version:1,repository:"kubernetes/website",roster:[{githubId:"developowl"}],sourceSheet:{rows:[["source"]]},assignments:{"1":{reviewers:["bckmini"],legacyReviewers:["old-reviewer"],sheetRow:2},"2":{reviewers:[]}}};
  const change={reviewers:["BCKMINI"],completedReviewers:["developowl"],reviewOverrides:{bckmini:true},notes:"private note",excluded:false};
  const result=updateAssignment(document,"1",change,"author");
  assert.deepEqual(result.sourceSheet,document.sourceSheet);
  assert.deepEqual(result.assignments["2"],document.assignments["2"]);
  assert.deepEqual(result.assignments["1"].legacyReviewers,["old-reviewer"]);
  assert.equal(result.assignments["1"].notes,"private note");
  assert.deepEqual(updateAssignment(document,"1",{...change,reviewers:["developowl"]},"author").assignments["1"].reviewers,["developowl"]);
  assert.throws(()=>updateAssignment(document,"1",{...change,reviewers:["unknown-user"]},"author"));
  assert.throws(()=>updateAssignment(document,"1",change,"bckmini"));
});
test("수동 확인과 자동 리뷰를 구분하고 완료 해제가 판정에 반영된다",()=>{
  const pr={state:"open",checkedAt:"2026-09-11",labels:[],completed:[{login:"bckmini",state:"APPROVED"}]};
  const manual={reviewers:["bckmini","jiyubaek"],reviewOverrides:{jiyubaek:true}};
  assert.equal(workState(pr,manual),"approver");
  assert.equal(completedReviews(pr,manual).find(x=>x.login==="jiyubaek").state,"MANUAL");
  assert.equal(workState(pr,{...manual,reviewOverrides:{jiyubaek:true,bckmini:false}}),"reviewing");
});
test("과거 두 팀 배정은 편집 후 중복 복원되지 않고 원본 시트는 유지한다",()=>{
  const document={assignments:{1:{reviewers:[],legacyReviewers:["developowl","author"]}},sourceSheet:{rows:[["original"]]}};
  const result=updateAssignment(document,1,{reviewers:[],notes:"",excluded:false},"author");
  assert.deepEqual(result.assignments[1].legacyReviewers,["author"]);
  assert.deepEqual(result.sourceSheet,document.sourceSheet);
});
test("로컬 저장은 변경 이력을 남기고 오래된 revision을 거부한다",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"review-store-"));
  try{
    const file=join(dir,"review-assignments.json");
    const document={version:1,repository:"kubernetes/website",assignments:{}};
    await writeFile(file,JSON.stringify(document));
    const store=createReviewStore({file});
    const before=await store.read();
    await store.write({...document,assignments:{"1":{reviewers:["bckmini"]}}},before.revision,1);
    await assert.rejects(store.write(document,before.revision,1),error=>error.status===409);
    assert.deepEqual(JSON.parse(await readFile(file,"utf8")).assignments,{"1":{reviewers:["bckmini"]}});
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("GitHub 저장은 SHA와 커밋 메시지를 보내며 실패 응답 원문은 노출하지 않는다",async()=>{
  const document={version:1,repository:"kubernetes/website",assignments:{}};
  let sent;
  const fetcher=async(url,options)=>{
    if(options.method==="PUT"){sent=JSON.parse(options.body);return Response.json({content:{sha:"next"}});}
    if(url.endsWith("/contents/review-assignments.json"))return Response.json({type:"file",encoding:"base64",sha:"original",content:Buffer.from(JSON.stringify(document)).toString("base64")});
    return Response.json({private:true});
  };
  const store=createReviewStore({repository:"owner/private",token:"test-token",fetcher});
  assert.equal((await store.write(document,"original",123)).revision,"next");
  assert.equal(sent.sha,"original");
  assert.equal(sent.message,"chore: update PR #123 review assignment");
  const bad=createReviewStore({repository:"owner/private",token:"test-token",fetcher:async()=>new Response("private payload",{status:403})});
  await assert.rejects(bad.read(),error=>!error.message.includes("private payload"));
});
