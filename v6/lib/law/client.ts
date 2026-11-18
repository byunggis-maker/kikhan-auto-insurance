// 라운드 9: 국가법령정보센터 Open API로 법령 조문을 가져온다(V2 compass/lib/law/client.ts를 줄여 옮김).
// 서버에서만 부른다. 인증값 LAW_API_OC가 없거나 실패하면 빈 목록을 돌려주고, 약관 질의 답변은 "원문에서 확인되지 않음"으로 쓴다.
// 정해 둔 조문만 묻는다(아무 조문이나 받으면 우리 인증값으로 남이 조회할 수 있다). 결과는 24시간 메모리에 둔다.

const BASE = "https://www.law.go.kr/DRF";
const CACHE_MS = 24 * 60 * 60 * 1000;

const LAWS = {
  act: { id: "001746", name: "자동차손해배상 보장법" },
  decree: { id: "004594", name: "자동차손해배상 보장법 시행령" },
} as const;

/** 약관 질의에 붙일 수 있는 조문 */
export const LAW_ARTICLES = [
  { law: "act", article: 3, why: "자동차손해배상책임" },
  { law: "act", article: 5, why: "보험 가입 의무(책임보험·대물)" },
  { law: "act", article: 10, why: "보험회사에 대한 직접 청구" },
  { law: "act", article: 30, why: "무보험·뺑소니 사고의 정부보장사업" },
  { law: "decree", article: 3, why: "책임보험금 한도(사망·부상·후유장애, 대물)" },
] as const;

export type LawArticle = { lawName: string; heading: string; text: string; url: string };
type Env = Record<string, string | undefined>;
type Deps = { fetch: typeof fetch; env: Env; now: () => number };

const cache = new Map<string, { at: number; value: LawArticle }>();

const record = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const list = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(record).filter((x): x is Record<string, unknown> => x !== null);
const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : Array.isArray(v) ? v.flat(Infinity).filter((x) => typeof x === "string").join(" ").replace(/\s+/g, " ").trim() : "");

/** 조문 응답을 글자로 편다. 기대한 모양이 아니면 null */
export function parseArticle(raw: unknown, name: string, article: number): LawArticle | null {
  const law = record(record(raw)?.["법령"]);
  const info = record(law?.["기본정보"]);
  const units = list(record(law?.["조문"])?.["조문단위"]);
  const unit = units.find((u) => u["조문여부"] === "조문") ?? units[0];
  if (!info || !unit || text(info["법령명_한글"]) !== name || text(unit["조문번호"]) !== String(article)) return null;
  const head = text(unit["조문내용"]);
  const heading = /^제\d+조(?:의\d+)?(?:\([^)]*\))?/.exec(head)?.[0] ?? head;
  const lines = [head.slice(heading.length).trim()];
  for (const p of list(unit["항"])) {
    lines.push(text(p["항내용"]));
    for (const h of list(p["호"])) {
      lines.push(text(h["호내용"]));
      for (const m of list(h["목"])) lines.push(text(m["목내용"]));
    }
  }
  const body = lines.filter(Boolean).join("\n");
  if (!heading || !body) return null;
  return { lawName: name, heading, text: body, url: `https://www.law.go.kr/법령/${encodeURIComponent(name.replace(/\s/g, ""))}/제${article}조` };
}

/** 정해 둔 조문을 모두 가져온다. 인증값이 없거나 하나라도 실패하면 그 조문은 빠진다 */
export async function fetchLawArticles(deps: Deps = { fetch, env: process.env, now: Date.now }): Promise<LawArticle[]> {
  const oc = deps.env.LAW_API_OC?.trim();
  if (!oc) return [];
  const results = await Promise.all(
    LAW_ARTICLES.map(async ({ law, article }) => {
      const { id, name } = LAWS[law];
      const key = `${law}-${article}`;
      const hit = cache.get(key);
      if (hit && deps.now() - hit.at < CACHE_MS) return hit.value;
      try {
        const url = `${BASE}/lawService.do?${new URLSearchParams({ OC: oc, type: "JSON", target: "lawjosub", ID: id, JO: `${String(article).padStart(4, "0")}00` })}`;
        const response = await deps.fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!response.ok) return null;
        const parsed = parseArticle(await response.json(), name, article);
        if (parsed) cache.set(key, { at: deps.now(), value: parsed });
        return parsed;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((x): x is LawArticle => x !== null);
}
