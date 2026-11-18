// 라운드 9d: 법령 원문 미리받기. 칸 PC(open.law.go.kr에 IP 등록)에서만 실행한다: npm run laws:fetch
// 1) 코드(lib·components·app)에서 인용 중인 조문과 기본 조문(lib/law/refs.ts)을 모은다.
// 2) open.law.go.kr에서 받아 data/laws/<id>.json과 data/laws/index.json(앱이 읽는 묶음)에 쓴다.
// - OC 값은 v6/.env.local의 LAW_OC에서 읽는다(저장소에 커밋하지 않음, 화면·로그에 값을 찍지 않음).
// - 인증 실패·IP 미등록 등 거절 응답이면 원인을 한국어로 알리고 파일을 하나도 덮어쓰지 않는다.
// - 조문 하나를 못 받으면 그 조문의 예전 파일은 그대로 둔다.
// 옵션: --list 는 인터넷 없이 받을 조문 목록만 index.json에 적는다.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAW_API_BASE, SITE, authProblem, parseAnnexes, parseArticle, parseLawId } from "../lib/law/parse.ts";
import { LAW_NAMES, wantedRefs, type LawKey, type LawRef } from "../lib/law/refs.ts";

export type LawRecord = { id: string; lawName: string; label: string; heading: string; text: string; effectiveDate: string | null; fetchedAt: string; url: string };
type Index = { generatedAt: string | null; wanted: string[]; articles: LawRecord[] };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT_DIR = join(ROOT, "data", "laws");

/** 코드 글자 모으기(약관 원문 묶음 같은 큰 자료 파일은 뺀다) */
export function codeTexts(root = ROOT): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) out.push(readFileSync(path, "utf8"));
    }
  };
  for (const dir of ["lib", "components", "app"]) if (existsSync(join(root, dir))) walk(join(root, dir));
  return out;
}

/** .env.local 글자에서 LAW_OC 값 */
export function readOc(envText: string): string | null {
  const m = /^\s*LAW_OC\s*=\s*["']?([^"'\s#]+)["']?/m.exec(envText);
  return m ? m[1] : null;
}

/** 실행을 멈춰야 하는 오류(인증 실패·IP 미등록·인터넷 끊김). 파일을 쓰지 않는다 */
export class LawFetchError extends Error {}

type Deps = { fetch: typeof fetch; oc: string; now: () => Date };

async function get(deps: Deps, path: string, params: Record<string, string>): Promise<unknown> {
  const url = `${LAW_API_BASE}/${path}?${new URLSearchParams({ OC: deps.oc, type: "JSON", ...params })}`;
  let response: Response;
  try {
    // 등록한 도메인을 Referer로 싣는다(도메인을 등록했어도 Referer가 없어 거절된 사례가 있음)
    response = await deps.fetch(url, { headers: { Referer: SITE }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new LawFetchError("인터넷 연결 실패: law.go.kr에 닿지 못했습니다. 인터넷 연결을 확인하고 다시 실행하세요.");
  }
  const body = await response.text();
  if (!response.ok) throw new LawFetchError(`법령 서버 오류(HTTP ${response.status}). 잠시 뒤 다시 실행하세요.`);
  const problem = authProblem(body);
  if (problem) throw new LawFetchError(problem);
  try {
    return JSON.parse(body);
  } catch {
    throw new LawFetchError("알아볼 수 없는 응답: JSON이 아닙니다. 인증·IP 등록을 확인하세요(docs/법령-갱신.md 3번).");
  }
}

/** 조문을 받는다. 인증 문제면 LawFetchError로 멈추고, 조문 하나를 못 찾으면 failed에 적고 계속한다 */
export async function fetchLaws(refs: LawRef[], deps: Deps): Promise<{ records: LawRecord[]; failed: { id: string; reason: string }[] }> {
  const fetchedAt = deps.now().toISOString().slice(0, 10);
  const records: LawRecord[] = [];
  const failed: { id: string; reason: string }[] = [];
  const laws = [...new Set(refs.map((r) => r.law))] as LawKey[];
  for (const law of laws) {
    const name = LAW_NAMES[law];
    const mine = refs.filter((r) => r.law === law);
    const id = parseLawId(await get(deps, "lawSearch.do", { target: "law", query: name, display: "100" }), name);
    if (!id) {
      for (const r of mine) failed.push({ id: r.id, reason: `법령 '${name}'을 찾지 못했습니다` });
      continue;
    }
    for (const r of mine.filter((x) => x.article !== null)) {
      const raw = await get(deps, "lawService.do", { target: "lawjosub", ID: id, JO: `${String(r.article).padStart(4, "0")}${String(r.branch).padStart(2, "0")}` });
      const parsed = parseArticle(raw, name, r.article!, r.branch);
      if (parsed) records.push({ id: r.id, label: r.label, fetchedAt, ...parsed });
      else failed.push({ id: r.id, reason: `${name} ${r.label} 원문이 응답에 없습니다` });
    }
    const annexes = mine.filter((x) => x.annex !== null);
    if (annexes.length) {
      const all = parseAnnexes(await get(deps, "lawService.do", { target: "law", ID: id }), name);
      for (const r of annexes) {
        const hit = all.find((a) => a.annex === r.annex);
        if (hit) {
          const { annex: _annex, ...rest } = hit;
          void _annex;
          records.push({ id: r.id, label: r.label, fetchedAt, ...rest });
        } else failed.push({ id: r.id, reason: `${name} ${r.label} 원문이 응답에 없습니다(별표가 그림·파일로만 제공될 수 있음)` });
      }
    }
  }
  return { records, failed };
}

/** 받은 조문을 파일로 쓴다. 못 받은 조문의 예전 기록은 index.json에 그대로 남긴다 */
export function writeLaws(dir: string, wanted: string[], records: LawRecord[], now: Date): Index {
  mkdirSync(dir, { recursive: true });
  const indexPath = join(dir, "index.json");
  const old: Index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : { generatedAt: null, wanted: [], articles: [] };
  for (const r of records) writeFileSync(join(dir, `${r.id}.json`), `${JSON.stringify(r, null, 2)}\n`);
  const fresh = new Map(records.map((r) => [r.id, r]));
  const articles = [...old.articles.filter((a) => !fresh.has(a.id)), ...records].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const index: Index = { generatedAt: records.length ? now.toISOString() : old.generatedAt, wanted, articles };
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

async function main() {
  const refs = wantedRefs(codeTexts());
  const wanted = refs.map((r) => r.id);
  console.log(`받을 조문 ${refs.length}개: ${refs.map((r) => `${r.lawName} ${r.label}`).join(", ")}`);
  if (process.argv.includes("--list")) {
    writeLaws(OUT_DIR, wanted, [], new Date());
    console.log("목록만 data/laws/index.json에 적었습니다(인터넷 사용 안 함).");
    return;
  }
  const envPath = join(ROOT, ".env.local");
  const oc = existsSync(envPath) ? readOc(readFileSync(envPath, "utf8")) : null;
  if (!oc) {
    console.error("LAW_OC 값이 없습니다. v6/.env.local에 LAW_OC=○○○ 한 줄을 넣고 다시 실행하세요(docs/법령-갱신.md 2번).");
    process.exitCode = 1;
    return;
  }
  try {
    const { records, failed } = await fetchLaws(refs, { fetch, oc, now: () => new Date() });
    const index = writeLaws(OUT_DIR, wanted, records, new Date());
    console.log(`받은 조문 ${records.length}개, 앱에 든 조문 모두 ${index.articles.length}개(data/laws/).`);
    for (const f of failed) console.warn(`못 받음(예전 파일 유지): ${f.reason}`);
    if (failed.length) process.exitCode = 2;
  } catch (error) {
    if (!(error instanceof LawFetchError)) throw error;
    console.error(`멈춤 — ${error.message}`);
    console.error("data/laws/의 파일은 하나도 바꾸지 않았습니다.");
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
