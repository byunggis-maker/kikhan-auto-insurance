// 라운드 9·9b: 국가법령정보센터 Open API로 법령 원문을 가져온다(V2 compass/lib/law/client.ts를 줄여 옮김).
// 서버에서만 부른다. 인증값 LAW_API_OC가 없으면 아무것도 묻지 않고(lawConnected = false), 약관 질의 답변의 법령은 "법령 원문 연결 전"이다.
// 가져오는 것(정해 둔 것만. 아무 조문이나 받으면 우리 인증값으로 남이 조회할 수 있다):
// - 자동차손해배상 보장법 제3·5·10·30조
// - 같은 법 시행령 제3조와 별표 전부(책임보험금 한도·상해 구분 등)
// - 상법 보험편: 제680조(손해방지의무)·제682조(제3자에 대한 보험대위)·제724조(보험자와 제3자와의 관계)·제726조의2(자동차보험자의 책임)·제729조(제3자에 대한 보험대위의 금지)·제737조(상해보험자의 책임)
// 결과는 24시간 메모리에 둔다. 하나가 실패하면 그것만 빠진다.

const BASE = "https://www.law.go.kr/DRF";
const CACHE_MS = 24 * 60 * 60 * 1000;
/** open.law.go.kr에 등록할 도메인(이 앱의 배포 주소) */
export const SITE = "https://kikhan-auto-compass-v6.vercel.app";
/** 별표 한 개의 글자 수 상한(프롬프트가 너무 길어지지 않게) */
const MAX_TEXT = 6000;

/** 국가법령정보센터의 법령 ID. 상법은 ID를 이름으로 찾는다(LAW_SEARCH) */
const LAWS = {
  act: { id: "001746", name: "자동차손해배상 보장법" },
  decree: { id: "004594", name: "자동차손해배상 보장법 시행령" },
} as const;
const COMMERCIAL = "상법";

type Article = { article: number; branch?: number };
const ACT_ARTICLES: Article[] = [{ article: 3 }, { article: 5 }, { article: 10 }, { article: 30 }];
const DECREE_ARTICLES: Article[] = [{ article: 3 }];
const COMMERCIAL_ARTICLES: Article[] = [{ article: 680 }, { article: 682 }, { article: 724 }, { article: 726, branch: 2 }, { article: 729 }, { article: 737 }];

export type LawArticle = { lawName: string; heading: string; text: string; url: string };
type Env = Record<string, string | undefined>;
export type LawDeps = { fetch: typeof fetch; env: Env; now: () => number };

const cache = new Map<string, { at: number; value: unknown }>();
export function clearLawCache() {
  cache.clear();
}

export const lawConnected = (env: Env = process.env) => Boolean(env.LAW_API_OC?.trim());

const record = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const list = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(record).filter((x): x is Record<string, unknown> => x !== null);
const text = (v: unknown): string => (typeof v === "string" ? v.replace(/[ \t]+/g, " ").trim() : Array.isArray(v) ? v.flat(Infinity).filter((x) => typeof x === "string").join("\n").replace(/[ \t]+/g, " ").trim() : "");
const articleUrl = (name: string, label: string) => `https://www.law.go.kr/법령/${encodeURIComponent(name.replace(/\s/g, ""))}/${encodeURIComponent(label)}`;
const joCode = ({ article, branch = 0 }: Article) => `${String(article).padStart(4, "0")}${String(branch).padStart(2, "0")}`;
const label = ({ article, branch }: Article) => `제${article}조${branch ? `의${branch}` : ""}`;

/** 조문 응답(lawjosub)을 글자로 편다. 다른 법령·조문이면 null */
export function parseArticle(raw: unknown, name: string, article: number, branch = 0): LawArticle | null {
  const law = record(record(raw)?.["법령"]);
  const info = record(law?.["기본정보"]);
  const units = list(record(law?.["조문"])?.["조문단위"]);
  const unit = units.find((u) => u["조문여부"] === "조문") ?? units[0];
  if (!info || !unit || text(info["법령명_한글"]) !== name || text(unit["조문번호"]) !== String(article)) return null;
  if (Number(text(unit["조문가지번호"]) || 0) !== branch) return null;
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
  return { lawName: name, heading, text: body, url: articleUrl(name, label({ article, branch })) };
}

/** 법령 전체 응답(target=law)에서 별표를 꺼낸다. 별표내용이 글자로 온 것만 */
export function parseAnnexes(raw: unknown, name: string): LawArticle[] {
  const law = record(record(raw)?.["법령"]);
  if (text(record(law?.["기본정보"])?.["법령명_한글"]) !== name) return [];
  return list(record(law?.["별표"])?.["별표단위"])
    .filter((u) => !u["별표구분"] || text(u["별표구분"]) === "별표")
    .map((u) => {
      const no = Number(text(u["별표번호"])) || 0;
      const branch = Number(text(u["별표가지번호"])) || 0;
      const title = text(u["별표제목"]);
      const body = text(u["별표내용"]).slice(0, MAX_TEXT);
      const heading = `별표${no}${branch ? `의${branch}` : ""}${title ? `(${title.replace(/^\[별표\s*\d+[^\]]*\]\s*/, "")})` : ""}`;
      return { lawName: name, heading, text: body, url: articleUrl(name, `별표${no}`) };
    })
    .filter((a) => a.text.length > 0);
}

/** 법령 검색 응답(lawSearch, target=law)에서 이름이 꼭 같은 법령의 ID */
export function parseLawId(raw: unknown, name: string): string | null {
  const hit = list(record(record(raw)?.["LawSearch"])?.["law"]).find((x) => text(x["법령명한글"]) === name);
  return hit ? text(hit["법령ID"]) || null : null;
}

async function call(path: string, params: Record<string, string>, deps: LawDeps): Promise<unknown> {
  const key = `${path}?${new URLSearchParams(params)}`;
  const hit = cache.get(key);
  if (hit && deps.now() - hit.at < CACHE_MS) return hit.value;
  const url = `${BASE}/${path}?${new URLSearchParams({ OC: deps.env.LAW_API_OC!.trim(), type: "JSON", ...params })}`;
  // 라운드 9c: 신청 때 등록한 도메인을 Referer로 싣는다(도메인을 등록했어도 Referer가 없어 거절된 사례가 있음). IP 검사는 reports/round9c.md 4번
  const response = await deps.fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { Referer: SITE } });
  if (!response.ok) throw new Error("law");
  const value = await response.json();
  cache.set(key, { at: deps.now(), value });
  return value;
}

const quiet = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await work();
  } catch {
    return fallback;
  }
};

/** 정해 둔 법령 원문을 모두 가져온다. 인증값이 없으면 빈 목록 */
export async function fetchLawArticles(deps: LawDeps = { fetch, env: process.env, now: Date.now }): Promise<LawArticle[]> {
  if (!lawConnected(deps.env)) return [];
  const articles = (id: string, name: string, items: Article[]) =>
    items.map((a) => quiet(async () => parseArticle(await call("lawService.do", { target: "lawjosub", ID: id, JO: joCode(a) }, deps), name, a.article, a.branch ?? 0), null));
  const commercialId = quiet(async () => parseLawId(await call("lawSearch.do", { target: "law", query: COMMERCIAL, display: "20" }, deps), COMMERCIAL), null);
  const results = await Promise.all([
    ...articles(LAWS.act.id, LAWS.act.name, ACT_ARTICLES),
    ...articles(LAWS.decree.id, LAWS.decree.name, DECREE_ARTICLES),
    quiet(async () => parseAnnexes(await call("lawService.do", { target: "law", ID: LAWS.decree.id }, deps), LAWS.decree.name), []),
    commercialId.then(async (id) => (id ? Promise.all(articles(id, COMMERCIAL, COMMERCIAL_ARTICLES)) : [])),
  ]);
  return results.flat().filter((x): x is LawArticle => x !== null);
}
