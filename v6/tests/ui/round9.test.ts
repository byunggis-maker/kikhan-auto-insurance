import { describe, expect, it } from "vitest";
import { ASK_NOTICE, NOT_FOUND, askTerms, verifyAnswer, type Answer, type AskCall } from "@/lib/ai/ask";
import { migrate } from "@/lib/claim/persist";
import { emptyClaim, type Property } from "@/lib/claim/types";
import { estimateVehicleValue, residualPercent } from "@/lib/claim/vehicleValue";
import { propertyLoss } from "@/lib/engine/losses";
import { parseArticle } from "@/lib/law/client";
import data from "@/lib/terms/data.json";
import { searchTerms, terms, type TermsData } from "@/lib/terms/search";
import { newProperty, setItem } from "@/lib/ui/flow";

// 라운드 9: 차량가액 추정, 수리비용 120% 한도, 약관 원문 검색, 약관 질의 근거 대조, 저장값 v8.

const book = data as TermsData;

describe("사고 직전 가액 추정(차종 등급·연식)", () => {
  it("대표 신차가격 × 잔존율, 만 원 단위로 내린다", () => {
    expect(residualPercent(0)).toBe(90);
    expect(residualPercent(3)).toBe(63);
    expect(residualPercent(15)).toBe(15);
    expect(residualPercent(40)).toBe(10);
    const e = estimateVehicleValue("mid", 2023, 2026);
    expect(e.value).toBe(20_790_000);
    expect(e.formula).toContain("추정");
  });
});

describe("수리비용 한도(별표2 1. 나.(3), 120%)", () => {
  const car = (value: number | null, repair: number): Property => {
    const p = { ...newProperty("counterparty_vehicle", 1), valueAtAccident: value, valueSource: "estimate" as const };
    const c = setItem({ ...emptyClaim(), properties: [p] }, p.id, "repair", { confirmed: repair });
    return c.properties[0];
  };

  it("120%를 넘으면 전부손해로 보고 사고 직전 가액으로 계산하고 근거를 붙인다", () => {
    const loss = propertyLoss(car(10_000_000, 13_000_000), "confirmed");
    expect(loss.total).toBe(10_000_000);
    expect(loss.notes.join()).toContain("전부손해 가능성");
    expect(loss.notes.join()).toContain("별표2");
  });

  it("가액은 넘지만 120% 이하이면 금액은 그대로, 경고만", () => {
    const loss = propertyLoss(car(10_000_000, 11_000_000), "confirmed");
    expect(loss.total).toBe(11_000_000);
    expect(loss.notes.join()).toContain("전부손해 가능성");
  });

  it("가액 이하이거나 가액을 모르면 아무것도 하지 않는다", () => {
    expect(propertyLoss(car(10_000_000, 5_000_000), "confirmed").notes).toEqual([]);
    expect(propertyLoss(car(null, 50_000_000), "confirmed").total).toBe(50_000_000);
  });
});

describe("약관 원문 검색", () => {
  it("4개 약관이 들어 있고 쪽은 인쇄 쪽 번호다", () => {
    expect(Object.keys(book)).toEqual(["personal", "business", "commercial", "motorcycle"]);
    // 별표2 수리비용 한도(개인용 인쇄 80쪽)
    expect(book.personal.pages.find((p) => p.p === 80)?.t).toContain("120%를 한도로");
  });

  it("조사를 떼고 검색어를 만든다", () => {
    expect(terms("무보험자동차에 의한 상해로 얼마 받나요?")).toEqual(expect.arrayContaining(["무보험자동차", "상해"]));
  });

  it("무보험자동차 질문이면 무보험자동차 조항이 있는 쪽을 찾는다", () => {
    const hits = searchTerms(book, "personal", "무보험자동차에 의한 상해 보상하는 손해", ["무보험자동차에 의한 상해", "공제액"], 10);
    expect(hits.length).toBe(10);
    expect(hits.some((h) => /무보험자동차에\s*의한\s*상해/.test(h.text))).toBe(true);
  });
});

describe("약관 질의 근거 대조", () => {
  const hits = [{ product: "개인용", page: 80, text: "(3) 한도 : 수리비 및 열처리 도장료의 합계액은 피해물의 사고 직전 가액의 120%를 한도로 지급함.", score: 1 }];
  const answer: Answer = {
    conclusion: "대략 1,000만 원",
    issues: ["전부손해 여부"],
    interpretation: "…",
    basis: [
      { kind: "지급기준", citation: "별표2 1. 수리비용 나.(3)", page: 80, quote: "사고 직전 가액의 120%를 한도로 지급함" },
      { kind: "약관", citation: "제99조", page: 999, quote: "지어낸 문구" },
      { kind: "법령", citation: "상법 제724조", page: null, quote: "" },
      { kind: "판례", citation: "대법원 2099다12345", page: null, quote: "" },
    ],
    nextSteps: ["견적서"],
  };

  it("보낸 쪽의 인용만 인정하고, 나머지는 '원문에서 확인되지 않음'. 판례 사건번호는 믿지 않는다", () => {
    const v = verifyAnswer(answer, hits, []);
    expect(v.basis[0]).toMatchObject({ verified: true, page: 80, quote: "사고 직전 가액의 120%를 한도로 지급함" });
    expect(v.basis[1]).toMatchObject({ verified: false, page: null, quote: "" });
    expect(v.basis[1].citation).toContain(NOT_FOUND);
    expect(v.basis[2].citation).toContain(NOT_FOUND);
    expect(v.basis[3].citation).toBe(`판례 — ${NOT_FOUND}`);
    expect(v.basis.some((b) => b.citation.includes("2099다12345"))).toBe(false);
    expect(v.notice).toBe(ASK_NOTICE);
  });

  it("원문에 없는 인용 문구는 지운다", () => {
    const v = verifyAnswer({ ...answer, basis: [{ ...answer.basis[0], quote: "원문에 없는 말" }] }, hits, []);
    expect(v.basis[0]).toMatchObject({ verified: true, quote: "" });
  });

  it("질문·사고 사실은 개인정보를 가린 뒤 보내고, 사고 사실과 약관 발췌를 함께 넣는다", async () => {
    const seen: string[] = [];
    const call: AskCall = async ({ text }) => {
      seen.push(text);
      return { parsed: { ...answer, basis: [] }, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
    };
    const { answer: a } = await askTerms({ question: "무보험자동차에 의한 상해 얼마? 제 번호 010-1234-5678", facts: "사고일: 2026-10-01\n과실비율: 피보험자(나) 30% : 상대 70%", productLine: "personal" }, { data: book, laws: [], call });
    expect(seen[0]).not.toContain("010-1234-5678");
    expect(seen[0]).toContain("[사고 사실]\n사고일: 2026-10-01");
    expect(seen[0]).toContain('<page product="개인용" print=');
    expect(a.basis.map((b) => b.kind)).toEqual(["법령", "판례"]);
  });
});

describe("법령 API 응답", () => {
  it("조문을 글자로 편다. 다른 법령이면 null", () => {
    const raw = { 법령: { 기본정보: { 법령명_한글: "자동차손해배상 보장법" }, 조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "30", 조문내용: "제30조(자동차손해배상 보장사업) 정부는 …", 항: [{ 항내용: "① 다음 각 호의 어느 하나에 해당하는 경우" }] }] } } };
    expect(parseArticle(raw, "자동차손해배상 보장법", 30)).toMatchObject({ heading: "제30조(자동차손해배상 보장사업)" });
    expect(parseArticle(raw, "상법", 30)).toBeNull();
  });
});

describe("저장값 v7 → v8", () => {
  it("이름을 지급기준 용어로 바꾸고 새 칸은 빈 목록", () => {
    const v7 = { ...emptyClaim(), victims: [], properties: [{ ...newProperty("counterparty_vehicle", 1), label: "상대 차 1" }] } as Record<string, unknown>;
    delete v7.policyRead;
    const result = migrate({ version: 7, data: v7 });
    expect(result.status).toBe("migrated");
    expect(result.claim.properties[0].label).toBe("상대 차량 1");
    expect(result.claim.policyRead).toEqual([]);
  });
});
