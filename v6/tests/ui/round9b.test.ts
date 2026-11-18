import { describe, expect, it } from "vitest";
import { hasApiKey, keyState } from "@/lib/ai/anthropic";
import { LAW_NOT_CONNECTED, NOT_FOUND, verifyAnswer, type Answer } from "@/lib/ai/ask";
import { emptyClaim, type Claim } from "@/lib/claim/types";
import { calculate } from "@/lib/engine/dual-run";
import { clearLawCache, fetchLawArticles, parseAnnexes, parseArticle } from "@/lib/law/client";
import { buildReview } from "@/lib/report/review";
import { counterpartyOf, newProperty, setItem, setOtherCount, setPersonFacts, setVictimCount } from "@/lib/ui/flow";

// 라운드 9b: 키 만료, 법령 API(가짜 응답), 다친 사람의 위치에 따른 받을 곳, 차량가액 추정 표시.

describe("키 만료(AI_KEY_EXPIRES)", () => {
  const env = { ANTHROPIC_API_KEY: "x", AI_KEY_EXPIRES: "2026-11-21" };
  const at = (iso: string) => new Date(iso);
  it("8일 전은 ok, 7일 전부터 soon, 만료일 당일까지 쓸 수 있고 다음 날 expired", () => {
    expect(keyState(env, at("2026-11-13T12:00:00+09:00"))).toBe("ok");
    expect(keyState(env, at("2026-11-14T12:00:00+09:00"))).toBe("soon");
    expect(keyState(env, at("2026-11-21T23:00:00+09:00"))).toBe("soon");
    expect(keyState(env, at("2026-11-22T00:30:00+09:00"))).toBe("expired");
    expect(hasApiKey(env, at("2026-11-22T00:30:00+09:00"))).toBe(false);
    expect(hasApiKey(env, at("2026-11-18T12:00:00+09:00"))).toBe(true);
    expect(keyState({ ANTHROPIC_API_KEY: "x" })).toBe("ok");
  });
});

// 국가법령정보센터 응답 모양(lawjosub·law·lawSearch)을 본뜬 가짜 응답
const article = (name: string, no: string, branch: string, head: string, para: string) => ({ 법령: { 기본정보: { 법령명_한글: name }, 조문: { 조문단위: [{ 조문여부: "조문", 조문번호: no, 조문가지번호: branch, 조문내용: head, 항: [{ 항내용: para }] }] } } });
function fakeLaw() {
  const seen: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    seen.push(url.search.replace(/OC=[^&]+/, "OC=…"));
    const p = Object.fromEntries(url.searchParams);
    let body: unknown = {};
    if (p.target === "lawSearch" || url.pathname.endsWith("lawSearch.do")) body = { LawSearch: { law: [{ 법령명한글: "상법 시행령", 법령ID: "1" }, { 법령명한글: "상법", 법령ID: "001702" }] } };
    else if (p.target === "law") body = { 법령: { 기본정보: { 법령명_한글: "자동차손해배상 보장법 시행령" }, 별표: { 별표단위: [{ 별표구분: "별표", 별표번호: "0001", 별표제목: "상해의 구분과 책임보험금의 한도금액(제3조제1항제2호 관련)", 별표내용: ["1급 한도금액 3천만원", "11급 한도금액 160만원"] }] } } };
    else if (p.ID === "001746" && p.JO === "000300") body = article("자동차손해배상 보장법", "3", "", "제3조(자동차손해배상책임) 자기를 위하여 자동차를 운행하는 자는", "그 운행으로 다른 사람을 사망하게 하거나 부상하게 한 경우에는 그 손해를 배상할 책임을 진다.");
    else if (p.ID === "001702" && p.JO === "072602") body = article("상법", "726", "2", "제726조의2(자동차보험자의 책임) 자동차보험계약의 보험자는", "피보험자가 자동차를 소유, 사용 또는 관리하는 동안에 발생한 사고로 인하여 생긴 손해를 보상할 책임이 있다.");
    else return new Response("{}", { status: 200 });
    return Response.json(body);
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

describe("법령 API(LAW_API_OC)", () => {
  it("인증값이 없으면 아무것도 묻지 않는다", async () => {
    const { fetch, seen } = fakeLaw();
    expect(await fetchLawArticles({ fetch, env: {}, now: () => 0 })).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("자배법 조문·시행령 별표·상법 보험편 조문을 가져온다(상법 ID는 이름으로 찾는다)", async () => {
    clearLawCache();
    const { fetch, seen } = fakeLaw();
    const laws = await fetchLawArticles({ fetch, env: { LAW_API_OC: "test" }, now: () => 0 });
    expect(laws.map((l) => `${l.lawName} ${l.heading}`)).toEqual(["자동차손해배상 보장법 제3조(자동차손해배상책임)", "자동차손해배상 보장법 시행령 별표1(상해의 구분과 책임보험금의 한도금액(제3조제1항제2호 관련))", "상법 제726조의2(자동차보험자의 책임)"]);
    expect(seen.some((q) => q.includes("JO=072602"))).toBe(true);
    expect(seen.every((q) => q.includes("OC=…"))).toBe(true);
  });

  it("다른 조문(가지번호가 다름)이나 다른 법령이면 버린다", () => {
    const raw = article("상법", "726", "", "제726조(준용규정) …", "…");
    expect(parseArticle(raw, "상법", 726, 2)).toBeNull();
    expect(parseAnnexes({ 법령: { 기본정보: { 법령명_한글: "다른 법" } } }, "자동차손해배상 보장법 시행령")).toEqual([]);
  });

  it("가져온 원문으로 인용 문구를 대조한다(시행령을 자배법으로 잘못 맞추지 않는다)", async () => {
    clearLawCache();
    const laws = await fetchLawArticles({ fetch: fakeLaw().fetch, env: { LAW_API_OC: "test" }, now: () => 0 });
    const answer: Answer = {
      conclusion: "",
      issues: [],
      interpretation: "",
      basis: [
        { kind: "법령", citation: "자동차손해배상 보장법 제3조", page: null, quote: "그 손해를 배상할 책임을 진다" },
        { kind: "법령", citation: "자동차손해배상보장법 시행령 별표 1", page: null, quote: "11급 한도금액 160만원" },
        { kind: "법령", citation: "상법 제726조의2", page: null, quote: "원문에 없는 문구" },
        { kind: "법령", citation: "상법 제999조", page: null, quote: "" },
      ],
      nextSteps: [],
    };
    const v = verifyAnswer(answer, [], laws, true);
    expect(v.basis[0]).toMatchObject({ verified: true, quote: "그 손해를 배상할 책임을 진다" });
    expect(v.basis[0].url).toContain("law.go.kr");
    expect(v.basis[1]).toMatchObject({ verified: true, quote: "11급 한도금액 160만원" });
    expect(v.basis[1].url).toContain(encodeURIComponent("자동차손해배상보장법시행령"));
    expect(v.basis[2]).toMatchObject({ verified: true, quote: "" });
    expect(v.basis[3]).toMatchObject({ verified: false, citation: `상법 제999조 — ${NOT_FOUND}` });
  });

  it("인증값이 없으면 법령·판례는 '법령 원문 연결 전'('원문에서 확인되지 않음'과 구분)", () => {
    const v = verifyAnswer({ conclusion: "", issues: [], interpretation: "", basis: [{ kind: "법령", citation: "상법 제724조", page: null, quote: "" }], nextSteps: [] }, [], [], false);
    expect(v.basis.map((b) => b.citation)).toEqual([`상법 제724조 — ${LAW_NOT_CONNECTED}`, `자동차손해배상 보장법·시행령 별표, 상법 — ${LAW_NOT_CONNECTED}`, `관련 판례 — ${LAW_NOT_CONNECTED}`]);
  });
});

describe("다친 사람의 위치(내 차 동승자 / 상대 차량 탑승자 / 보행자)", () => {
  const base = (): Claim => ({
    ...emptyClaim(),
    accident: { ...emptyClaim().accident, occurredAt: "2026-10-01", type: "car_car" },
    myPolicy: { ...emptyClaim().myPolicy, productLine: "personal", coverages: [{ coverage: "liability_bodily_1", limit: null, injuryLimit: null, deathLimit: null, disabilityLimit: null }, { coverage: "liability_bodily_2", limit: "unlimited", injuryLimit: null, deathLimit: null, disabilityLimit: null }] },
    counterpartyPolicy: counterpartyOf(emptyClaim(), "full"),
  });
  // 치료비만 넣으면 치료관계비 하한(별표4)으로 과실과 관계없이 전액이라, 위자료로 과실 나눔을 본다
  const withLoss = (c: Claim) => setItem({ ...c, victims: c.victims.map((v) => (v.id === "other-1" ? { ...v, injuryGrade: 5 } : v)) }, "other-1", "solatium_injury", { confirmed: 1_000_000 });
  const payers = (c: Claim) =>
    calculate(c, 30)
      .lines.filter((l) => l.cardId === "other-1" && l.status === "paid" && l.confirmed > 0)
      .map((l) => `${l.payer}:${l.coverage}:${l.confirmed}`);

  it("새 사람은 상대 차량 탑승자(차대사람이면 보행자), 위치를 바꾸면 역할·이름이 바뀐다", () => {
    let c = setOtherCount(setVictimCount(base(), "driver", 1), 1);
    expect(c.victims[1]).toMatchObject({ id: "other-1", role: "counterparty", position: "counterparty_vehicle", label: "상대 차량 탑승자 1" });
    c = setPersonFacts(c, "other-1", { position: "my_vehicle", relationToNamedInsured: "spouse" });
    expect(c.victims[1]).toMatchObject({ role: "family_passenger", label: "내 차 동승자 1", vehicleDriver: false });
    c = setPersonFacts(c, "other-1", { relationToNamedInsured: "none" });
    expect(c.victims[1].role).toBe("other_passenger");
    expect(setOtherCount({ ...base(), accident: { ...base().accident, type: "car_person" } }, 1).victims[0]).toMatchObject({ position: "pedestrian", label: "보행자 1" });
  });

  it("보행자·상대 차량 운전자: 내 대인배상이 내 과실분만", () => {
    const c = withLoss(setPersonFacts(setOtherCount(base(), 1), "other-1", { position: "pedestrian" }));
    expect(payers(c)).toEqual(["own_insurer:liability_bodily_1:300000"]);
    const driver = withLoss(setPersonFacts(setOtherCount(base(), 1), "other-1", { seat: "driver", vehicleDriver: true }));
    expect(payers(driver)).toEqual(["own_insurer:liability_bodily_1:300000"]);
  });

  it("상대 차량 동승자: 내 과실분은 내 대인배상, 상대 운전자 과실분은 상대 대인배상. '상대방에게 줄 돈'에는 내 보험분만", () => {
    const c = withLoss(setPersonFacts(setOtherCount(base(), 1), "other-1", { seat: "passenger" }));
    expect(payers(c)).toEqual(["own_insurer:liability_bodily_1:300000", "counterparty_insurer:liability_bodily_1:700000"]);
    expect(calculate(c, 30).totals.toCounterparty.confirmed).toBe(300_000);
  });

  it("내 차 동승자(가족 아님): 상대 대인배상 상대 과실분 + 내 대인배상 나머지", () => {
    const c = withLoss(setPersonFacts(setOtherCount(base(), 1), "other-1", { position: "my_vehicle", relationToNamedInsured: "none" }));
    expect(payers(c)).toEqual(["counterparty_insurer:liability_bodily_1:700000", "own_insurer:liability_bodily_1:300000"]);
  });
});

describe("차량가액 추정 표시", () => {
  it("검토서 카드에 '앱 자체 추정치' 한 줄", () => {
    const p = { ...newProperty("counterparty_vehicle", 1), valueAtAccident: 8_250_000, valueSource: "estimate" as const };
    const c: Claim = { ...emptyClaim(), accident: { ...emptyClaim().accident, occurredAt: "2026-10-01", type: "car_car" }, properties: [p] };
    const review = buildReview(c, [calculate(c, 30)], 0);
    expect(review.cards[0].notes[0]).toBe("사고 직전 가액(추정) 8,250,000원 — 보험개발원 차량기준가액이 아닌 앱 자체 추정치입니다");
  });
});
