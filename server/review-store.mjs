import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export class StoreError extends Error { constructor(message,status=500){super(message);this.status=status;} }
const hash = text => createHash("sha256").update(text).digest("hex");

export function createReviewStore({repository,token,file,gitDirectory,fetcher=fetch}) {
  const git = async (...args) => (await exec("git",args,{cwd:gitDirectory,timeout:30000,maxBuffer:1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:"0"}})).stdout.trim();
  const remote = Boolean(repository || token);
  if(remote && (!/^[\w.-]+\/[\w.-]+$/.test(repository||"") || !token)) throw new Error("Private 저장소와 서버 토큰을 함께 설정하세요.");
  const api = async (path, options={}) => {
    let response;
    try { response=await fetcher("https://api.github.com/repos/"+repository+path,{...options,redirect:"error",headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:"Bearer "+token,"Content-Type":"application/json"},signal:AbortSignal.timeout(30000)}); }
    catch {throw new StoreError("GitHub 연결 실패",502);}
    if(response.status===409 || response.status===422) throw new StoreError("다른 변경이 먼저 저장됐습니다. 새로고침 후 다시 편집하세요.",409);
    if(!response.ok) throw new StoreError("GitHub 저장소 접근 실패 (HTTP "+response.status+")",502);
    return response.json();
  };
  async function read() {
    if(gitDirectory){
      if(await git("branch","--show-current")!=="main") throw new StoreError("배정 저장소의 main 브랜치를 사용하세요.",409);
      const remoteUrl=await git("remote","get-url","origin");
      if(remoteUrl!=="https://github.com/llokr1/ossca-review-info.git" && remoteUrl!=="git@github.com:llokr1/ossca-review-info.git") throw new StoreError("설정된 배정 저장소가 아닙니다.",403);
      // Preserve local work. Only clean, fast-forward updates are permitted.
      if(await git("status","--porcelain")) throw new StoreError("배정 저장소에 미커밋 변경이 있습니다. 먼저 확인하세요.",409);
      try{await git("fetch","origin","main");await git("merge","--ff-only","origin/main");}catch{throw new StoreError("배정 저장소 동기화 실패. Git 연결과 브랜치를 확인하세요.",409);}
    }
    let raw,revision;
    if(remote){
      if((await api("")).private!==true) throw new StoreError("Private 저장소만 연결할 수 있습니다.",403);
      const content=await api("/contents/review-assignments.json");
      if(content.type!=="file" || content.encoding!=="base64") throw new StoreError("배정 파일 형식 오류",502);
      raw=Buffer.from(content.content,"base64").toString("utf8");revision=content.sha;
    }else{raw=await readFile(file,"utf8");revision=hash(raw);}
    let document;try{document=JSON.parse(raw);}catch{throw new StoreError("배정 JSON 파싱 실패",500);}
    if(document.version!==1 || document.repository!=="kubernetes/website" || !document.assignments) throw new StoreError("배정 JSON 형식 오류",500);
    return {document,revision};
  }
  async function write(document,revision,number){
    const current=await read();
    if(current.revision!==revision) throw new StoreError("다른 변경이 먼저 저장됐습니다. 새로고침 후 다시 편집하세요.",409);
    const raw=JSON.stringify(document,null,2)+"\n";
    if(remote){
      const result=await api("/contents/review-assignments.json",{method:"PUT",body:JSON.stringify({message:"chore: update PR #"+number+" review assignment",content:Buffer.from(raw).toString("base64"),sha:revision})});
      return {revision:result.content.sha,mode:"github"};
    }
    const history=gitDirectory ? gitDirectory+"/.git/review-history" : dirname(file)+"/history";
    await mkdir(history,{recursive:true,mode:0o700});
    await writeFile(history+"/"+Date.now()+"-"+revision.slice(0,8)+".json",JSON.stringify(current.document,null,2),{mode:0o600,flag:"wx"});
    await writeFile(file+".tmp",raw,{mode:0o600});await rename(file+".tmp",file);
    if(gitDirectory){
      try { await git("add","--","review-assignments.json");await git("commit","-m","chore: update PR #"+number+" review assignment","--","review-assignments.json"); }
      catch { throw new StoreError("JSON은 로컬에 저장됐으나 커밋에 실패했습니다. Git 사용자 설정을 확인하세요.",500); }
      try {await git("push","origin","HEAD:main");}
      catch {throw new StoreError("로컬 커밋은 완료됐으나 원격 푸시에 실패했습니다. 배정 저장소에서 git push로 재시도하세요.",502);}
      return {revision:hash(raw),mode:"git"};
    }
    return {revision:hash(raw),mode:"local"};
  }
  return {read,write,mode:remote?"github":gitDirectory?"git":"local"};
}
