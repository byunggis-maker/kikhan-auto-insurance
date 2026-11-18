import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { emptyClaim, type Claim } from "@/lib/claim/types";
import { calculate } from "@/lib/engine/dual-run";
import type { Result } from "@/lib/engine/types";
import { reviewToXlsx } from "@/lib/export/excel";
import { PDF_FONT_FILES, reviewToPdf } from "@/lib/export/pdf";
import { JOINT_NOTICE, PARTIAL_NOTE, buildReview, cardLaws, type Review } from "@/lib/report/review";
import { counterpartyOf, setItem, setOtherCount, setPersonFacts, setVictimCount } from "@/lib/ui/flow";

// 라운드 9e: '미계산' 표시 범위. 합계는 그 범위 안에 미계산 줄이 있을 때만 "+ 미계산"과 문구를 붙인다.
// 근거 법령은 그 판단을 실제로 쓴 카드에만 연결한다.

const base = (status: "full" | "uninsured" = "full"): Claim => ({
  ...emptyClaim(),
  accident: { ...emptyClaim().accident, occurredAt: "2026-10-01", type: "car_car" },
  myPolicy: { ...emptyClaim().myPolicy, productLine: "personal", coverages: [{ coverage: "liability_bodily_1", limit: null, injuryLimit: null, deathLimit: null, disabilityLimit: null }, { coverage: "liability_bodily_2", limit: "unlimited", injuryLimit: null, deathLimit: null, disabilityLimit: null }] },
  counterpartyPolicy: counterpartyOf(emptyClaim(), status),
});
/** 피보험자(나)와 상대 차량 동승자 1명이 다친 사고(둘 다 5급, 위자료 100만 원 확정), 내 과실 30% */
const accident = (seat: "passenger" | "passenger_family", status: "full" | "uninsured" = "full") => {
  const c = setPersonFacts(setOtherCount(setVictimCount(base(status), "driver", 1), 1), "other-1", { seat });
  const graded = { ...c, victims: c.victims.map((v) => ({ ...v, injuryGrade: 5 })) };
  return setItem(setItem(graded, "other-1", "solatium_injury", { confirmed: 1_000_000 }), "driver-1", "solatium_injury", { confirmed: 1_000_000 });
};
const FONT_DIR = "node_modules/pretendard/dist/public/static/alternative";
const fonts = { regular: new Uint8Array(readFileSync(`${FONT_DIR}/${PDF_FONT_FILES.regular}`)), bold: new Uint8Array(readFileSync(`${FONT_DIR}/${PDF_FONT_FILES.bold}`)) };
async function pdfText(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  let all = "";
  for (let i = 1; i <= doc.numPages; i++) all += (await (await doc.getPage(i)).getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join("") + "\n";
  return all.replace(/\s+/g, "");
}
async function summaryOf(review: Review) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await reviewToXlsx(review)).buffer as ArrayBuffer);
  const sheet = book.getWorksheet("요약")!;
  return { sheet, row: (label: string) => sheet.getRows(1, sheet.rowCount)!.find((r) => r.getCell(1).value === label) };
}

describe("미계산 표시 범위(내 과실 30%)", () => {
  for (const [name, seat, status, payer] of [
    ["상대 운전자 가족 동승자", "passenger_family", "full", "상대 보험"],
    ["무보험 상대 차 동승자", "passenger", "uninsured", "정부보장사업"],
  ] as const) {
    it(`${name}: 나의 받을 돈은 숫자로 확정, 동승자 줄과 그 합계에만 '미계산'`, async () => {
      const review = buildReview(accident(seat, status), [calculate(accident(seat, status), 30)], 0);
      // 나(피보험자) 쪽 합계: 확정 숫자
      expect(review.top.receiveConfirmed).toBeGreaterThan(0);
      expect(review.top.receivePartial).toBe(false);
      expect(review.byPayer.every((p) => !p.partial)).toBe(true);
      expect(review.scenarios.every((s) => !s.receivePartial)).toBe(true);
      expect(review.top.toCounterpartyPartial).toBe(false);
      // 동승자 쪽: 줄은 미계산, 받는 사람은 상대 측
      expect(review.uncalculated).toEqual([expect.objectContaining({ card: "상대 차량 탑승자 1", mine: false, payer })]);
      const card = review.cards.find((c) => c.label === "상대 차량 탑승자 1")!;
      expect(card.lines.find((l) => l.payer === payer)?.status).toBe("미계산");

      // 엑셀: 확정 합계는 숫자 형식, 미계산 칸만 글자
      const { row } = await summaryOf(review);
      const receive = row("받을 돈")!;
      expect([receive.getCell(2).value, receive.getCell(3).value]).toEqual([review.top.receiveConfirmed, review.top.receiveWithEstimates]);
      expect(receive.getCell(2).numFmt).toBe("#,##0");
      expect(receive.getCell(4).value).toBe("");
      const mine = row(review.byPayer[0].payer)!;
      expect(typeof mine.getCell(3).value).toBe("number");
      const passenger = row(`${payer}(상대 차량 탑승자 1 ${card.lines.find((l) => l.payer === payer)!.label})`)!;
      expect([passenger.getCell(2).value, passenger.getCell(3).value]).toEqual(["미계산", "미계산"]);

      // PDF: 받을 돈에 "+ 미계산"·문구가 없고, 동승자 쪽에는 "미계산"
      const text = await pdfText(await reviewToPdf(review, fonts));
      expect(text).not.toContain("+미계산");
      expect(text).not.toContain(PARTIAL_NOTE.replace(/\s+/g, ""));
      expect(text).toContain("미계산");
    });
  }

  it("받는 사람이 피보험자 측인 미계산이면 그 합계·그 받을 곳·시나리오에만 붙는다(엑셀은 그 칸만 글자)", async () => {
    // 지금 엔진에는 피보험자 측 미계산이 없으므로, 내 대인배상Ⅰ(상대 보험) 줄 하나를 미계산으로 바꾼 결과로 규칙을 시험한다
    const claim = accident("passenger");
    const result = calculate(claim, 30);
    const line = result.lines.find((l) => l.cardId === "driver-1" && l.payer === "counterparty_insurer" && l.coverage === "liability_bodily_1")!;
    const changed: Result = { ...result, lines: result.lines.map((l) => (l === line ? { ...l, status: "not_implemented", formula: "시험용 미계산" } : l)) };
    const review = buildReview(claim, [changed], 0);
    expect(review.top.receivePartial).toBe(true);
    expect(review.byPayer.find((p) => p.payer === "상대 보험")?.partial).toBe(true);
    expect(review.scenarios[0].receivePartial).toBe(true);
    const { row } = await summaryOf(review);
    expect(row("받을 돈")!.getCell(2).value).toMatch(/원 \+ 미계산$/);
    expect(row("받을 돈")!.getCell(4).value).toBe(PARTIAL_NOTE);
    expect(await pdfText(await reviewToPdf(review, fonts))).toContain(PARTIAL_NOTE.replace(/\s+/g, ""));
  });
});

describe("근거 법령은 그 판단을 쓴 카드에만", () => {
  it("부진정연대 안내 카드 → 민법 제760조, 과실상계로 줄인 카드 → 민법 제396·763조", () => {
    const review = buildReview(accident("passenger"), [calculate(accident("passenger"), 30)], 0);
    const me = review.cards.find((c) => c.label === "피보험자(나)")!;
    const other = review.cards.find((c) => c.label === "상대 차량 탑승자 1")!;
    expect(other.notes).toContain(JOINT_NOTICE);
    expect(other.laws).toEqual(expect.arrayContaining(["civil-760", "civil-396", "civil-763", "decree-annex-1"]));
    // 나: 내 과실 30%로 줄였으므로 과실상계 조문은 있지만, 공동불법행위 안내가 없으므로 760조는 없다
    expect(me.laws).toEqual(expect.arrayContaining(["civil-396", "civil-763"]));
    expect(me.laws).not.toContain("civil-760");
  });

  it("과실 0%로 줄이지 않았으면 과실상계 조문을 붙이지 않는다", () => {
    const review = buildReview(accident("passenger"), [calculate(accident("passenger"), 0)], 0);
    const me = review.cards.find((c) => c.label === "피보험자(나)")!;
    expect(me.laws).not.toContain("civil-396");
    expect(cardLaws({ lines: [{ status: "지급", formula: "손해액 1,000원 × (100 − 0)% = 1,000원", basis: "별표4" }], notes: [] })).toEqual([]);
  });
});
