import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createReviewStore, StoreError } from "./review-store.mjs";
import { updateAssignment, editableAssignment } from "../lib/review-editor.mjs";

const port=Number(process.env.REVIEW_API_PORT || 3101);
const list=(value)=>String(value||"").split(",").map(x=>x.trim().replace(/\/$/,"")).filter(Boolean);
const origins=new Set(list(process.env.REVIEW_ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000"));
const hosts=new Set(list(process.env.REVIEW_ALLOWED_HOSTS || "localhost,127.0.0.1"));
const publicSnapshotUrl=process.env.REVIEW_PUBLIC_SNAPSHOT_URL || "https://llokr1.github.io/k8s-l10n-kpi/data/pr-management.json";
let parsedSnapshotUrl;try{parsedSnapshotUrl=new URL(publicSnapshotUrl);}catch{throw new Error("REVIEW_PUBLIC_SNAPSHOT_URL 형식 오류");}
if(!["https:","http:"].includes(parsedSnapshotUrl.protocol)) throw new Error("REVIEW_PUBLIC_SNAPSHOT_URL은 HTTP(S) 주소여야 합니다.");
const gitDirectory=process.env.REVIEW_GIT_DIRECTORY;
const store=createReviewStore({repository:process.env.PR_ASSIGNMENTS_REPOSITORY,token:process.env.PR_ASSIGNMENTS_WRITE_TOKEN,gitDirectory,file:resolve(gitDirectory ? gitDirectory+"/review-assignments.json" : process.env.REVIEW_PRIVATE_FILE || "private-data/review-assignments.json")});
let queue=Promise.resolve();
let publicSnapshot=null, publicReadAt=0;
async function readPublicSnapshot(){
  if(publicSnapshot && Date.now()-publicReadAt<300000) return publicSnapshot;
  try{
    const response=await fetch(parsedSnapshotUrl,{signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error();
    const value=await response.json();
    if(value.repository!=="kubernetes/website" || !Array.isArray(value.pullRequests)) throw new Error();
    publicSnapshot=value;publicReadAt=Date.now();
  }catch{
    if(!publicSnapshot) publicSnapshot=JSON.parse(await readFile("app/pr-management.json","utf8"));
  }
  return publicSnapshot;
}
async function handle(req,res){
  const origin=req.headers.origin;
  const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Vary":"Origin"};
  const send=(status,value)=>{res.writeHead(status,headers);res.end(JSON.stringify(value));};
  if(origin && !origins.has(origin)) return send(403,{error:"허용되지 않은 요청 출처"});
  // Loopback binding + Host checks prevent DNS rebinding. Internal deployment uses a protected reverse proxy.
  let hostname="";try{hostname=new URL("http://"+(req.headers.host||"")).hostname.toLowerCase();}catch{}
  if(!hosts.has(hostname)) return send(403,{error:"허용되지 않은 Host"});
  if(origin){headers["Access-Control-Allow-Origin"]=origin;headers["Access-Control-Allow-Headers"]="Content-Type";headers["Access-Control-Allow-Methods"]="GET,PATCH,OPTIONS";}
  if(req.method==="OPTIONS") return send(204,null);
  try{
    if(req.method==="GET" && req.url==="/api/reviews"){
      const {document,revision}=await store.read();
      const latest=await readPublicSnapshot();
      const publicPrs=latest.pullRequests || [];
      const prs=new Map((document.pullRequests||[]).map(x=>[x.number,x]));
      for(const pr of publicPrs) if(pr.checkedAt) prs.set(pr.number,{...prs.get(pr.number),...pr,imported:false});
      return send(200,{revision,mode:store.mode,assignments:Object.fromEntries(Object.entries(document.assignments).map(([k,v])=>[k,editableAssignment(v)])),roster:document.roster||[],pullRequests:[...prs.values()].sort((a,b)=>b.number-a.number),importedAt:document.importedAt,githubCollectedAt:latest.generatedAt});
    }
    const match=req.url?.match(/^\/api\/reviews\/([1-9]\d*)$/);
    if(req.method!=="PATCH" || !match) return send(404,{error:"경로 없음"});
    if(!origin || !req.headers["content-type"]?.startsWith("application/json")) return send(403,{error:"사이트에서 JSON 요청을 보내세요."});
    let body="";for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16000) throw new StoreError("입력 크기 초과",413);}
    let input;try{input=JSON.parse(body);}catch{throw new StoreError("JSON 형식 오류",400);}
    const {document,revision}=await store.read();
    if(input.revision!==revision) throw new StoreError("다른 변경이 먼저 저장됐습니다. 다시 불러온 뒤 저장하세요.",409);
    const number=match[1];
    let pr=document.pullRequests?.find(x=>String(x.number)===number);
    if(!pr){const data=await readPublicSnapshot();pr=data.pullRequests.find(x=>String(x.number)===number);}
    if(!pr?.author) throw new StoreError("PR 작성자를 확인하지 못했습니다.",400);
    let updated;try{updated=updateAssignment(document,number,input.assignment,pr.author);}catch(error){throw new StoreError(error.message,400);}
    const result=await store.write(updated,revision,number);
    send(200,{...result,assignment:editableAssignment(updated.assignments[number])});
  }catch(error){send(error.status||500,{error:error instanceof StoreError ? error.message : "저장 데이터를 확인하지 못했습니다. 서버 설정을 확인하세요."});}
}
createServer((req,res)=>{queue=queue.then(()=>handle(req,res)).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});}).listen(port,"127.0.0.1",()=>console.log("Review API: http://127.0.0.1:"+port+" · "+store.mode));
