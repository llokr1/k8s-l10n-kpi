import { mkdir, writeFile } from "node:fs/promises";
const site = process.env.SITE_URL;
if (!site) throw new Error("SITE_URL이 필요합니다.");
await mkdir("public/data", { recursive: true });
for (const file of ["pr-management.json", ...(process.env.RESTORE_METRICS === "1" ? ["metrics.json"] : [])]) {
  const url = new URL(`data/${file}`, site.endsWith("/") ? site : `${site}/`);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30000) });
  if (response.status === 404) continue; // First deployment.
  if (!response.ok) throw new Error(`기존 데이터 복구 실패: ${file} HTTP ${response.status}. 이력 유실을 막기 위해 중단합니다.`);
  const data = await response.json();
  if (file === "pr-management.json" && (data.repository !== "kubernetes/website" || !Array.isArray(data.pullRequests))) throw new Error("이전 PR 데이터 형식 오류");
  if (file === "metrics.json" && (!data.members || data.repository?.name !== "website")) throw new Error("이전 성과 데이터 형식 오류");
  const content = JSON.stringify(data, null, 2) + "\n";
  await writeFile(`public/data/${file}`, content);
  await writeFile(`app/${file}`, content);
}
