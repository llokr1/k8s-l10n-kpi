import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(".");
const output = resolve("github-pages");
const client = resolve("dist/client");
const siteUrl = process.env.SITE_URL || "http://localhost:3000/";
const basePath = new URL(siteUrl).pathname.replace(/\/$/, "");
const renderUrl = new URL("/", siteUrl);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(client, output, { recursive: true });

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("export", String(Date.now()));
const { default: worker } = await import(workerUrl.href);
const response = await worker.fetch(
  new Request(renderUrl, { headers: { accept: "text/html", "x-forwarded-proto": "https" } }),
  { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  { waitUntil() {}, passThroughOnException() {} },
);

if (!response.ok) throw new Error(`정적 페이지 렌더링 실패: ${response.status}`);
let html = await response.text();
if (basePath) {
  html = html
    .replaceAll('/_next/', `${basePath}/_next/`)
    .replaceAll('href="/assets/', `href="${basePath}/assets/`)
    .replaceAll('src="/assets/', `src="${basePath}/assets/`)
    .replaceAll('href="/favicon.svg"', `href="${basePath}/favicon.svg"`);
}

await writeFile(resolve(output, "index.html"), html);
await writeFile(resolve(output, "404.html"), html);
await writeFile(resolve(output, ".nojekyll"), "");

async function rewriteAssetPaths(directory) {
  for (const name of await readdir(directory)) {
    const path = resolve(directory, name);
    if ((await stat(path)).isDirectory()) {
      await rewriteAssetPaths(path);
    } else if (basePath && [".css", ".js", ".json"].includes(extname(path))) {
      const source = await readFile(path, "utf8");
      const rewritten = source.replaceAll('/_next/', `${basePath}/_next/`);
      if (rewritten !== source) await writeFile(path, rewritten);
    }
  }
}

await rewriteAssetPaths(output);

const metrics = JSON.parse(await readFile(resolve(root, "app/metrics.json"), "utf8"));
console.log(`GitHub Pages 내보내기 완료: ${output}`);
console.log(`멤버 ${metrics.members.length}명 · ${siteUrl}`);
