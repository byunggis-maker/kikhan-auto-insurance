import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { emptyClaim, type Claim } from "@/lib/claim/types";
import { UNCALCULATED } from "@/lib/engine/calculate";
import { calculate } from "@/lib/engine/dual-run";
import { reviewToXlsx } from "@/lib/export/excel";
import { clearLawCache, fetchLawArticles, SITE } from "@/lib/law/client";
import { JOINT_NOTICE, RIDE_ALONG_NOTICE, TO_COUNTERPARTY_NOTE, buildReview } from "@/lib/report/review";
import { counterpartyOf, setItem, setOtherCount, setPersonFacts } from "@/lib/ui/flow";

// 라운드 9c: 상대 차량 동승자 안내(부진정연대·호의동승), 미계산 2건(상대 운전자 가족 동승자, 무보험 상대 차 동승자), 법령 API Referer.

const base = (status: "full" | "uninsured" = "full"): Claim => ({
  ...emptyClaim(),
  accident: { ...emptyClaim().accident, occurredAt: "2026-10-01", type: "car_car" },
  myPolicy: { ...emptyClaim().myPolicy, productLine: "personal", coverages: [{ coverage: "liability_bodily_1", limit: null, injuryLimit: null, deathLimit: null, disabilityLimit: null }, { coverage: "liability_bodily_2", limit: "unlimited", injuryLimit: null, deathLimit: null, disabilityLimit: null }] },
  counterpartyPolicy: counterpartyOf(emptyClaim(), status),
});
const passenger = (seat: "passenger" | "passenger_family", status: "full" | "uninsured" = "full") => {
  const c = setPersonFacts(setOtherCount(base(status), 1), "other-1", { seat });
  return setItem({ ...c, victims: c.victims.map((v) => ({ ...v, injuryGrade: 5 })) }, "other-1", "solatium_injury", { confirmed: 1_000_000 });
};
const reviewOf = (c: Claim) => buildReview(c, [calculate(c, 30)], 0);

describe("상대 차량 동승자 안내", () => {
  it("30:70 분담 아래 부진정연대 안내와 호의동승 안내, '상대방에게 줄 돈' 각주", () => {
    const r = reviewOf(passenger("passenger"));
    expect(r.cards[0].lines.filter((l) => l.confirmed > 0).map((l) => `${l.payer}:${l.confirmed}`)).toEqual(["내 보험:300000", "상대 보험:700000"]);
    expect(r.cards[0].notes.slice(0, 2)).toEqual([JOINT_NOTICE, RIDE_ALONG_NOTICE]);
    expect(r.top.toCounterparty).toBe(300_000);
    expect(TO_COUNTERPARTY_NOTE).toContain("구상");
    expect(r.uncalculated).toEqual([]);
  });

  it("보행자에게는 동승자 안내를 붙이지 않는다", () => {
    const c = setPersonFacts(setOtherCount(base(), 1), "other-1", { position: "pedestrian" });
    expect(reviewOf(c).cards[0].notes).not.toContain(RIDE_ALONG_NOTICE);
  });
});

describe("미계산 2건", () => {
  it("상대 운전자의 가족 동승자: 상대 쪽은 미계산(0원 아님), 내 과실분은 그대로", () => {
    const r = reviewOf(passenger("passenger_family"));
    const line = r.cards[0].lines.find((l) => l.payer === "상대 보험")!;
    expect(line).toMatchObject({ status: "미계산", formula: UNCALCULATED.family });
    expect(r.uncalculated).toEqual([{ payer: "상대 보험", card: "상대 차량 탑승자 1", label: "대인배상Ⅰ", text: UNCALCULATED.family }]);
    expect(r.cards[0].lines.find((l) => l.payer === "내 보험")?.confirmed).toBe(300_000);
    expect(r.cards[0].notes).not.toContain(JOINT_NOTICE);
  });

  it("무보험 상대 차 동승자: 정부보장사업 청구 대상 미계산", () => {
    const r = reviewOf(passenger("passenger", "uninsured"));
    expect(r.uncalculated).toEqual([{ payer: "정부보장사업", card: "상대 차량 탑승자 1", label: "대인Ⅰ 상당액(정부보장사업)", text: UNCALCULATED.government }]);
  });

  it("엑셀: 요약(받을 곳별)과 담보별 상세에 '미계산'", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await reviewToXlsx(reviewOf(passenger("passenger_family")))).buffer as ArrayBuffer);
    const values = (name: string) => book.getWorksheet(name)!.getSheetValues().flat().map(String);
    expect(values("요약")).toEqual(expect.arrayContaining(["상대 보험(상대 차량 탑승자 1 대인배상Ⅰ)", "미계산", UNCALCULATED.family]));
    const detail = book.getWorksheet("담보별 상세")!;
    const row = detail.getRows(2, detail.rowCount - 1)!.find((r) => r.getCell(3).value === "상대 보험")!;
    expect([row.getCell(4).value, row.getCell(5).value, row.getCell(6).value]).toEqual(["미계산", "미계산", "미계산"]);
  });
});

describe("법령 API 요청", () => {
  it("등록 도메인을 Referer로 싣는다", async () => {
    clearLawCache();
    const headers: unknown[] = [];
    const fetch = (async (_: unknown, init?: RequestInit) => {
      headers.push(init?.headers);
      return Response.json({});
    }) as typeof globalThis.fetch;
    await fetchLawArticles({ fetch, env: { LAW_API_OC: "test" }, now: () => 0 });
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((h) => (h as Record<string, string>).Referer === SITE)).toBe(true);
  });
});
