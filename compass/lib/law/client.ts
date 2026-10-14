import { ApiError } from "@/lib/guard/http";
import { lawOf, type LawRef, type PrecedentKeyword } from "./catalog";

// 국가법령정보센터 Open API 조회. 서버에서만 부른다(인증값 OC를 브라우저에 보내지 않는다).
// 결과는 24시간 동안 메모리에 둔다. 법령 원문은 공개 자료라 개인정보가 없다.

/** 화면에 그대로 보여 주는 문구 */
export const LAW_FAILED = "법령 정보를 불러오지 못했습니다";
const BASE = "https://www.law.go.kr/DRF";
export const CACHE_MS = 24 * 60 * 60 * 1000;
/** 화면에 보여 줄 판례 수 */
const MAX_PRECEDENTS = 5;

export type LawLine = { text: string; level: 0 | 1 | 2 | 3 };
export type LawArticle = {
  ref: LawRef;
  lawName: string;
  /** "제3조(책임보험금 등)" */
  heading: string;
  /** 이 조문의 시행일 YYYY-MM-DD */
  effectiveDate: string | null;
  lines: LawLine[];
  /** 국가법령정보센터의 공개 화면 주소(인증값 없음) */
  url: string;
};
export type Precedent = { id: string; title: string; caseNumber: string; court: string; date: string; url: string };

export type LawDeps = { fetch: typeof fetch; now: () => number; env: Record<string, string | undefined> };
const defaults = (): LawDeps => ({ fetch, now: Date.now, env: process.env });

const cache = new Map<string, { at: number; value: unknown }>();
/** 테스트용 */
export function clearLawCache() {
  cache.clear();
}

function failed(): ApiError {
  return new ApiError(502, "LAW_FAILED", LAW_FAILED);
}

/** 24시간 안에 같은 것을 물었으면 저장해 둔 값을 준다. 실패한 결과는 저장하지 않는다 */
async function cached<T>(key: string, deps: LawDeps, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && deps.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: deps.now(), value });
  return value;
}

async function request(path: string, params: Record<string, string>, deps: LawDeps): Promise<unknown> {
  const oc = deps.env.LAW_API_OC?.trim();
  // 설정이 없어도 화면에는 같은 문구만 보여 준다.
  if (!oc) throw new ApiError(503, "LAW_CONFIG", LAW_FAILED);
  const url = `${BASE}/${path}?${new URLSearchParams({ OC: oc, type: "JSON", ...params })}`;
  let response: Response;
  try {
    response = await deps.fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  } catch {
    throw failed();
  }
  if (!response.ok) throw failed();
  // 인증에 실패해도 200으로 안내문을 돌려주는 API라, 기대한 모양인지는 부르는 쪽에서 확인한다.
  return response.json().catch(() => {
    throw failed();
  });
}

const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
/** 하나일 때는 객체, 여럿일 때는 배열로 오는 칸을 배열로 맞춘다 */
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).map(record).filter((item): item is Record<string, unknown> => item !== null);
const text = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : Array.isArray(value) ? value.flat(Infinity).filter((part) => typeof part === "string").join(" ").replace(/\s+/g, " ").trim() : "");
const dateText = (value: unknown) => {
  const match = /^(\d{4})\.?(\d{2})\.?(\d{2})$/.exec(text(value));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
};

/** 조문 응답을 화면에 보여 줄 줄로 편다. 기대한 모양이 아니면 null */
export function parseArticle(raw: unknown, ref: LawRef): LawArticle | null {
  const law = record(record(raw)?.["법령"]);
  const info = record(law?.["기본정보"]);
  const unit = list(record(law?.["조문"])?.["조문단위"]).find((item) => item["조문여부"] === "조문") ?? list(record(law?.["조문"])?.["조문단위"])[0];
  if (!info || !unit) return null;
  const { name, article } = lawOf(ref);
  const heading = text(unit["조문내용"]);
  if (text(info["법령명_한글"]) !== name || text(unit["조문번호"]) !== String(article) || !heading) return null;

  const lines: LawLine[] = [];
  const push = (value: unknown, level: LawLine["level"]) => {
    const line = text(value);
    if (line) lines.push({ text: line, level });
  };
  // 조문내용은 "제3조(제목) 본문…" 꼴이다. 제목까지는 heading으로 쓰고 나머지 본문을 첫 줄로 둔다.
  const title = /^제\d+조(?:의\d+)?(?:\([^)]*\))?/.exec(heading)?.[0] ?? heading;
  push(heading.slice(title.length), 0);
  for (const paragraph of list(unit["항"])) {
    push(paragraph["항내용"], 1);
    for (const item of list(paragraph["호"])) {
      push(item["호내용"], 2);
      for (const sub of list(item["목"])) push(sub["목내용"], 3);
    }
  }
  if (lines.length === 0) return null;
  return {
    ref,
    lawName: name,
    heading: title,
    effectiveDate: dateText(unit["조문시행일자"]) ?? dateText(info["시행일자"]),
    lines,
    url: `https://www.law.go.kr/법령/${encodeURIComponent(name.replace(/\s/g, ""))}/제${article}조`,
  };
}

export async function getArticle(ref: LawRef, deps: LawDeps = defaults()): Promise<LawArticle> {
  return cached(`article:${ref}`, deps, async () => {
    const { id, article } = lawOf(ref);
    // JO는 조 번호 네 자리 + 가지번호 두 자리다(제3조 → 000300).
    const parsed = parseArticle(await request("lawService.do", { target: "lawjosub", ID: id, JO: `${String(article).padStart(4, "0")}00` }, deps), ref);
    if (!parsed) throw failed();
    return parsed;
  });
}

/** 판례 검색 응답에서 목록을 꺼낸다. 기대한 모양이 아니면 null. 결과가 없으면 빈 목록 */
export function parsePrecedents(raw: unknown): Precedent[] | null {
  const search = record(record(raw)?.["PrecSearch"]);
  if (!search) return null;
  const seen = new Set<string>();
  return list(search["prec"])
    // 과실비율은 손해배상(민사) 사건에서 다툰다. 형사·행정 사건은 뺀다. 사건 종류가 적혀 있지 않으면 그대로 둔다.
    .filter((item) => !text(item["사건종류명"]) || text(item["사건종류명"]) === "민사")
    .map((item) => ({ id: text(item["판례일련번호"]), title: text(item["사건명"]), caseNumber: text(item["사건번호"]), court: text(item["법원명"]), date: text(item["선고일자"]).replace(/\./g, "-") }))
    .filter((item) => /^\d+$/.test(item.id) && item.title)
    // 같은 사건이 두 번 실려 오는 경우가 있다.
    .filter((item) => {
      const key = `${item.court}|${item.caseNumber}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_PRECEDENTS)
    // 응답의 상세 링크에는 인증값이 들어 있어 쓰지 않는다. 공개 화면 주소를 만든다.
    .map((item) => ({ ...item, url: `https://www.law.go.kr/precInfoP.do?precSeq=${item.id}` }));
}

export async function searchPrecedents(keyword: PrecedentKeyword, deps: LawDeps = defaults()): Promise<Precedent[]> {
  return cached(`prec:${keyword}`, deps, async () => {
    // search=2: 판례 본문에서 찾는다. 최근 선고 순으로 넉넉히 받아 민사 사건만 추린다.
    const parsed = parsePrecedents(await request("lawSearch.do", { target: "prec", query: keyword, search: "2", display: "30" }, deps));
    if (!parsed) throw failed();
    return parsed;
  });
}
