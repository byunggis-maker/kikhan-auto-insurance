import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getLaw } from "@/app/api/laws/route";
import { GET as getPrecedents } from "@/app/api/laws/precedents/route";
import { COVERAGE_LAWS, LAW_ARTICLES, PRECEDENT_KEYWORDS, isLawRef, keywordsFor, lawOf } from "@/lib/law/catalog";
import { CACHE_MS, LAW_FAILED, clearLawCache, getArticle, parseArticle, parsePrecedents, searchPrecedents, type LawDeps } from "@/lib/law/client";

// 국가법령정보센터 Open API 연결. 응답 모양은 2026-10-14에 실제 응답에서 확인한 것을 줄여 옮겼다.

/** 시행령 제3조: 항·호가 배열로 온다 */
const DECREE_3 = {
  법령: {
    기본정보: { 법령명_한글: "자동차손해배상 보장법 시행령", 시행일자: "20260915", 법령ID: "004594" },
    조문: {
      조문단위: {
        조문번호: "3",
        조문시행일자: "20260915",
        조문여부: "조문",
        조문제목: "책임보험금 등",
        조문내용: "제3조(책임보험금 등)",
        항: [
          { 항번호: "① ", 항내용: '  ① 법 제5조제1항에 따라 … 책임보험금은 피해자 1명당 다음 각 호의 금액과 같다. <개정 2014.2.5>  ', 호: [{ 호번호: "1. ", 호내용: "  1. 사망한 경우에는 1억5천만원의 범위에서 피해자에게 발생한 손해액.  " }, { 호번호: "2. ", 호내용: "  2. 부상한 경우에는 별표 1에서 정하는 금액의 범위에서 …  " }] },
          { 항번호: "③ ", 항내용: "  ③ 법 제5조제2항에서 … 사고 1건당 2천만원의 범위에서 …  " },
        ],
      },
    },
  },
};
/** 법 제3조: 항이 하나라 객체로 오고 항내용이 없다 */
const ACT_3 = {
  법령: {
    기본정보: { 법령명_한글: "자동차손해배상 보장법", 시행일자: "20261002" },
    조문: {
      조문단위: {
        조문번호: "3",
        조문시행일자: "20261002",
        조문여부: "조문",
        조문내용: "제3조(자동차손해배상책임) 자기를 위하여 자동차를 운행하는 자는 … 그 손해를 배상할 책임을 진다. 다만, 다음 각 호의 어느 하나에 해당하면 그러하지 아니하다.",
        항: { 호: [{ 호번호: "1. ", 호내용: "  1. 승객이 아닌 자가 사망하거나 부상한 경우에 …  " }, { 호번호: "2. ", 호내용: "  2. 승객이 고의나 자살행위로 사망하거나 부상한 경우  " }] },
      },
    },
  },
};
const PRECEDENTS = {
  PrecSearch: {
    키워드: "교차로 과실비율",
    prec: [
      { 판례일련번호: "100001", 사건명: "구상금", 사건번호: "2025다000001", 법원명: "대법원", 선고일자: "2026.08.12", 판례상세링크: "/DRF/lawService.do?OC=secret-oc&target=prec&ID=100001&type=HTML" },
      { 판례일련번호: "100002", 사건명: "손해배상(자)", 사건번호: "2025나000002", 법원명: "가상지방법원", 선고일자: "2026.06.05", 판례상세링크: "/DRF/lawService.do?OC=secret-oc&target=prec&ID=100002&type=HTML" },
    ],
  },
};

function deps(respond: (url: string) => Response | Promise<Response>, start = 1_000_000) {
  let now = start;
  const fetchMock = vi.fn(async (url: string | URL | Request) => respond(String(url)));
  const value: LawDeps = { fetch: fetchMock as unknown as typeof fetch, now: () => now, env: { LAW_API_OC: "secret-oc" } };
  return { deps: value, fetchMock, advance: (ms: number) => (now += ms) };
}

beforeEach(() => clearLawCache());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("법령 조문", () => {
  it("조문을 화면에 보여 줄 줄로 편다 (항·호가 배열이든 객체든)", () => {
    const decree = parseArticle(DECREE_3, "decree-3");
    expect(decree).toMatchObject({ lawName: "자동차손해배상 보장법 시행령", heading: "제3조(책임보험금 등)", effectiveDate: "2026-09-15" });
    expect(decree?.lines.map((line) => line.level)).toEqual([1, 2, 2, 1]);
    expect(decree?.lines[1].text).toBe("1. 사망한 경우에는 1억5천만원의 범위에서 피해자에게 발생한 손해액.");
    expect(decree?.url).toBe(`https://www.law.go.kr/법령/${encodeURIComponent("자동차손해배상보장법시행령")}/제3조`);
    const act = parseArticle(ACT_3, "act-3");
    expect(act?.heading).toBe("제3조(자동차손해배상책임)");
    expect(act?.lines.map((line) => line.level)).toEqual([0, 2, 2]);
    expect(act?.lines[0].text.startsWith("자기를 위하여 자동차를 운행하는 자는")).toBe(true);
  });

  it("기대한 모양이 아니거나 다른 법령·다른 조문이 오면 쓰지 않는다", () => {
    expect(parseArticle({ result: "사용자 정보 검증에 실패하였습니다." }, "act-3")).toBeNull();
    expect(parseArticle(DECREE_3, "act-3")).toBeNull();
    expect(parseArticle(ACT_3, "act-5")).toBeNull();
    expect(parseArticle(null, "act-3")).toBeNull();
  });

  it("서버가 인증값을 붙여 부르고, 24시간 동안은 다시 부르지 않는다", async () => {
    const { deps: d, fetchMock, advance } = deps(() => Response.json(DECREE_3));
    const first = await getArticle("decree-3", d);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://www.law.go.kr/DRF/lawService.do");
    expect(Object.fromEntries(url.searchParams)).toEqual({ OC: "secret-oc", type: "JSON", target: "lawjosub", ID: "004594", JO: "000300" });
    // 돌려주는 값에는 인증값이 없다.
    expect(JSON.stringify(first)).not.toContain("secret-oc");

    advance(CACHE_MS - 1);
    expect(await getArticle("decree-3", d)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(2);
    await getArticle("decree-3", d);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("실패는 저장하지 않고, 오류에 제공자의 응답이나 인증값을 싣지 않는다", async () => {
    let fail = true;
    const { deps: d, fetchMock } = deps(() => (fail ? new Response("제공자 오류 원문 secret-oc", { status: 500 }) : Response.json(ACT_3)));
    await expect(getArticle("act-3", d)).rejects.toMatchObject({ code: "LAW_FAILED", publicMessage: LAW_FAILED });
    fail = false;
    expect((await getArticle("act-3", d)).heading).toBe("제3조(자동차손해배상책임)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 인증에 실패하면 200으로 안내문이 온다. 이것도 실패다.
    clearLawCache();
    const denied = deps(() => Response.json({ result: "사용자 정보 검증에 실패하였습니다.", msg: "…" }));
    await expect(getArticle("act-3", denied.deps)).rejects.toMatchObject({ publicMessage: LAW_FAILED });
    // 연결 자체가 안 되는 경우와 인증값이 없는 경우
    const down = deps(() => Promise.reject(new Error("network")));
    await expect(getArticle("act-5", down.deps)).rejects.toMatchObject({ publicMessage: LAW_FAILED });
    await expect(getArticle("act-5", { ...down.deps, env: {} })).rejects.toMatchObject({ code: "LAW_CONFIG", publicMessage: LAW_FAILED });
  });
});

describe("참고 판례", () => {
  it("목록을 꺼내고, 인증값이 든 상세 링크 대신 공개 화면 주소를 만든다", async () => {
    const list = parsePrecedents(PRECEDENTS);
    expect(list).toEqual([
      { id: "100001", title: "구상금", caseNumber: "2025다000001", court: "대법원", date: "2026-08-12", url: "https://www.law.go.kr/precInfoP.do?precSeq=100001" },
      { id: "100002", title: "손해배상(자)", caseNumber: "2025나000002", court: "가상지방법원", date: "2026-06-05", url: "https://www.law.go.kr/precInfoP.do?precSeq=100002" },
    ]);
    expect(JSON.stringify(list)).not.toContain("secret-oc");
    // 결과가 하나면 객체로, 없으면 prec 없이 온다.
    expect(parsePrecedents({ PrecSearch: { prec: PRECEDENTS.PrecSearch.prec[0] } })).toHaveLength(1);
    expect(parsePrecedents({ PrecSearch: { totalCnt: "0" } })).toEqual([]);
    // 형사 사건과 같은 사건의 중복은 빼고, 다섯 건까지만 보여 준다.
    const base = PRECEDENTS.PrecSearch.prec[0];
    const many = Array.from({ length: 8 }, (_, index) => ({ ...base, 판례일련번호: String(200 + index), 사건번호: `2025다00${index}`, 사건종류명: "민사" }));
    const mixed = [{ ...base, 판례일련번호: "101", 사건종류명: "형사", 사건명: "도로교통법위반" }, { ...base, 판례일련번호: "102", 사건종류명: "민사" }, { ...base, 판례일련번호: "103", 사건종류명: "민사" }, ...many];
    const filtered = parsePrecedents({ PrecSearch: { prec: mixed } }) ?? [];
    expect(filtered.map((item) => item.id)).toEqual(["102", "200", "201", "202", "203"]);
    expect(parsePrecedents({ result: "실패" })).toBeNull();
  });

  it("정해 둔 검색어로 본문 검색을 하고 24시간 저장한다", async () => {
    const { deps: d, fetchMock } = deps(() => Response.json(PRECEDENTS));
    await searchPrecedents("교차로 과실비율", d);
    await searchPrecedents("교차로 과실비율", d);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ target: "prec", query: "교차로 과실비율", search: "2", type: "JSON" });
  });

  it("사고 유형에 맞는 검색어를 앞에 두고, 모두 정해 둔 목록 안의 것이다", () => {
    expect(keywordsFor("car_person")[0]).toBe("보행자 과실상계");
    expect(keywordsFor("motorcycle")[0]).toBe("이륜자동차 과실비율");
    for (const kind of ["car_car", "car_person", "motorcycle", "single", ""] as const) for (const keyword of keywordsFor(kind)) expect(PRECEDENT_KEYWORDS).toContain(keyword);
  });
});

describe("조문 목록", () => {
  it("담보에 붙인 조문은 모두 목록에 있고, 책임보험금 한도는 시행령 제3조다", () => {
    for (const refs of Object.values(COVERAGE_LAWS)) for (const ref of refs ?? []) expect(isLawRef(ref)).toBe(true);
    expect(COVERAGE_LAWS.liability_bodily_1).toContain("decree-3");
    expect(lawOf("decree-3")).toMatchObject({ id: "004594", article: 3, label: "자동차손해배상 보장법 시행령 제3조" });
    expect(Object.keys(LAW_ARTICLES)).toHaveLength(5);
  });
});

describe("API 라우트", () => {
  const call = (handler: (request: Request) => Promise<Response>, path: string) => handler(new Request(`http://localhost${path}`));

  it("/api/laws: 조문을 돌려주고 응답 어디에도 인증값이 없다", async () => {
    vi.stubEnv("LAW_API_OC", "secret-oc");
    const upstream = vi.fn(async () => Response.json(DECREE_3));
    vi.stubGlobal("fetch", upstream);
    const response = await call(getLaw, "/api/laws?ref=decree-3");
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(body).article.heading).toBe("제3조(책임보험금 등)");
    expect(body).not.toContain("secret-oc");
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
  });

  it("목록에 없는 조문이나 검색어는 국가법령정보센터를 부르지 않고 거절한다", async () => {
    vi.stubEnv("LAW_API_OC", "secret-oc");
    const upstream = vi.fn(async () => Response.json(DECREE_3));
    vi.stubGlobal("fetch", upstream);
    expect((await call(getLaw, "/api/laws?ref=act-999")).status).toBe(400);
    expect((await call(getLaw, "/api/laws")).status).toBe(400);
    expect((await call(getPrecedents, `/api/laws/precedents?q=${encodeURIComponent("아무 검색어")}`)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("API가 실패하면 '법령 정보를 불러오지 못했습니다'만 돌려준다", async () => {
    vi.stubEnv("LAW_API_OC", "secret-oc");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("제공자 오류 원문", { status: 503 })));
    for (const response of [await call(getLaw, "/api/laws?ref=act-3"), await call(getPrecedents, `/api/laws/precedents?q=${encodeURIComponent("교차로 과실비율")}`)]) {
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "법령 정보를 불러오지 못했습니다", code: "LAW_FAILED" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    // 인증값을 설정하지 않은 경우에도 같은 문구다.
    vi.stubEnv("LAW_API_OC", "");
    expect(await (await call(getLaw, "/api/laws?ref=act-5")).json()).toMatchObject({ error: "법령 정보를 불러오지 못했습니다" });
  });

  it("/api/laws/precedents: 판례 목록을 돌려준다", async () => {
    vi.stubEnv("LAW_API_OC", "secret-oc");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(PRECEDENTS)));
    const response = await call(getPrecedents, `/api/laws/precedents?q=${encodeURIComponent("교차로 과실비율")}`);
    const body = await response.text();
    expect(JSON.parse(body).precedents).toHaveLength(2);
    expect(body).not.toContain("secret-oc");
  });
});

// 실제 API 확인용. 평소에는 건너뛴다: LAW_LIVE=1 LAW_API_OC=<인증값> npx vitest run tests/law.test.ts
describe.skipIf(!process.env.LAW_LIVE)("실제 국가법령정보센터 응답", () => {
  it("목록의 조문을 모두 읽고 판례를 찾는다", async () => {
    for (const ref of Object.keys(LAW_ARTICLES)) {
      if (!isLawRef(ref)) continue;
      const article = await getArticle(ref);
      console.log(ref, article.heading, article.effectiveDate, article.lines.length);
      expect(article.lines.length).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    const found = await searchPrecedents("교차로 과실비율");
    console.log(found.slice(0, 3));
    expect(found.length).toBeGreaterThan(0);
  }, 60000);
});
