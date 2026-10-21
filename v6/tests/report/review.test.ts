import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { Claim } from "@/lib/claim/types";
import { reviewToXlsx } from "@/lib/export/excel";
import { PDF_FONT_FILES, reviewToPdf } from "@/lib/export/pdf";
import { calculateScenarios } from "@/lib/engine/fault-scenarios";
import { findSensitive } from "@/lib/privacy/mask";
import { buildReview, type Review } from "@/lib/report/review";
import { CASES } from "../cases/cases";

// 라운드 6: 보상 검토서 모델·엑셀·PDF. 세 숫자는 엔진 결과와 같아야 하고, 어디에도 개인정보가 남지 않아야 한다.
// WRITE_SAMPLES=1 로 돌리면 사례 (1)(2)(5)의 엑셀·PDF를 docs/samples/에 쓴다.

const FONT_DIR = "node_modules/pretendard/dist/public/static/alternative";
const fonts = { regular: new Uint8Array(readFileSync(`${FONT_DIR}/${PDF_FONT_FILES.regular}`)), bold: new Uint8Array(readFileSync(`${FONT_DIR}/${PDF_FONT_FILES.bold}`)) };

const reviewOf = (claim: Claim) => buildReview(claim, calculateScenarios(claim), 0);
const caseClaim = (no: number) => CASES.find((c) => c.no === no)!.claim;

/** 검토서 모델 안의 모든 글자 */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

// 손 검산: (1) 3,180,000 × 70% = 2,226,000 + 자동차상해 954,000 / (2) 확정 1,200,000 + 800,000 + 230,000, 추정 1,200,000 + 1,038,000 + 1,200,000 + 292,000
// (5) 받을 돈 0(내 차 자기차량손해 면책), 사고부담금 대인Ⅰ 500,000 + 대인Ⅱ 530,000 + 대물 15,000,000(추정 16,000,000)
const SAMPLES = [
  { no: 1, file: "case1-9급-과실30", top: { receiveConfirmed: 3_180_000, receiveWithEstimates: 3_180_000, burdenWithEstimates: 0 } },
  { no: 2, file: "case2-가족동승자-과실40", top: { receiveConfirmed: 2_230_000, receiveWithEstimates: 3_730_000, burdenWithEstimates: 0 } },
  { no: 5, file: "case5-음주", top: { receiveConfirmed: 0, receiveWithEstimates: 0, burdenWithEstimates: 17_030_000 } },
];

describe("보상 검토서 모델", () => {
  it.each(SAMPLES)("사례 ($no): 맨 위 세 숫자가 엔진 결과·손 검산과 같다", ({ no, top }) => {
    const claim = caseClaim(no);
    const result = calculateScenarios(claim)[0];
    const review = reviewOf(claim);
    expect(review.top).toMatchObject(top);
    expect(review.top.receiveConfirmed).toBe(result.totals.receive.confirmed);
    expect(review.top.receiveWithEstimates).toBe(result.totals.receive.withEstimates);
    expect(review.top.burdenWithEstimates).toBe(result.totals.burden.withEstimates);
    expect(review.notice).toBe("추정액이며 확정 금액은 보험사가 정합니다.");
  });

  it("사례 (5) 음주: 사고부담금 세 줄과 확정 기준 내가 낼 돈 16,030,000원, 내 차 자기차량손해는 면책 사유", () => {
    const review = reviewOf(caseClaim(5));
    expect(review.top.burdenConfirmed).toBe(16_030_000);
    expect(review.burdens.map((b) => b.withEstimates)).toEqual([500_000, 530_000, 16_000_000]);
    const ownDamage = review.cards.find((c) => c.label === "내차")!.lines.find((l) => l.label.includes("자기차량손해"))!;
    expect(ownDamage.status).toBe("보상 안 됨");
    expect(ownDamage.exclusion).not.toBe("");
    expect(review.nextSteps.join()).toContain("사고부담금");
  });

  it("약관 판 대조 안내와 일용근로자 임금 적용일을 계산 기준에 적는다(라운드 6 지시 2)", () => {
    const base = CASES.find((c) => c.no === 20)!.claim;
    const homemaker = { ...base, victims: base.victims.map((v) => ({ ...v, occupation: "homemaker" as const })) };
    const review = reviewOf(homemaker);
    expect(review.standards[0]).toContain("2026-10-25 개정판");
    expect(review.standards[0]).toContain("대조가 필요");
    expect(review.standards[1]).toContain("1일 172,698원(2026-09-01 적용");
    // 같은 안내가 반복되지 않는다
    expect(new Set(review.notices).size).toBe(review.notices.length);
  });

  it("과실을 모르면 0·30·50·70% 시나리오 표, 화면 탭과 같은 순서", () => {
    const claim: Claim = { ...caseClaim(1), fault: { mode: "unknown" } };
    const review = buildReview(claim, calculateScenarios(claim), 1);
    expect(review.scenarios.map((s) => s.label)).toEqual(["내 과실 0%", "내 과실 30%", "내 과실 50%", "내 과실 70%"]);
    expect(review.faultPercent).toBe(30);
    expect(review.top.receiveConfirmed).toBe(3_180_000);
  });

  it("필요 서류는 받을 곳·담보별로 묶고 약관 제27조 호수를 단다", () => {
    const review = reviewOf(caseClaim(1));
    expect(review.checklist.map((g) => `${g.payer}:${g.coverage}`)).toEqual(["상대 보험:대인배상Ⅰ", "상대 보험:대인배상Ⅱ", "내 보험:자동차상해"]);
    for (const group of review.checklist) expect(group.docs.every((d) => d.clause27 > 0)).toBe(true);
  });
});

// ── 개인정보: 사용자가 자유 입력란에 번호를 적어도 검토서·엑셀·PDF에 남지 않는다 ──
const leaky = (): Claim => {
  const claim = caseClaim(5);
  return {
    ...claim,
    accident: { ...claim.accident, narrative: "상대 차 12가3456 운전자(010-1234-5678)와 충돌, 내 주민번호 900101-1234567", place: "서울 02-345-6789 앞" },
    myPolicy: { ...claim.myPolicy, insurer: "가상 보험사 증권 2026-123456789" },
    victims: claim.victims.map((v) => ({ ...v, label: "상대 운전자 010 9876 5432" })),
  };
};

describe("개인정보 가림(라운드 6 지시 5)", () => {
  it("검토서 모델의 모든 글자", () => {
    const all = strings(reviewOf(leaky())).join("\n");
    expect(findSensitive(all)).toEqual([]);
    expect(all).toContain("●●●●●●●");
  });

  it("엑셀 세 시트의 모든 칸", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await reviewToXlsx(reviewOf(leaky()))).buffer as ArrayBuffer);
    const cells: string[] = [];
    book.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value ?? "")))));
    expect(cells.join("\n")).toContain("●●●");
    // 칸마다 따로 본다(칸을 이어 붙이면 금액 두 칸이 주민번호 모양이 될 수 있다)
    expect(cells.flatMap(findSensitive)).toEqual([]);
  });
});

describe("엑셀 저장(시트 3개, 금액은 숫자)", () => {
  it("요약·담보별 상세·필요 서류, 금액 칸은 숫자 + #,##0", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await reviewToXlsx(reviewOf(caseClaim(1)))).buffer as ArrayBuffer);
    expect(book.worksheets.map((s) => s.name)).toEqual(["요약", "담보별 상세", "필요 서류"]);
    const summary = book.getWorksheet("요약")!;
    let receive: ExcelJS.Row | undefined;
    summary.eachRow((row) => {
      if (row.getCell(1).value === "받을 돈") receive = row;
    });
    expect(receive!.getCell(2).value).toBe(3_180_000);
    expect(receive!.getCell(2).numFmt).toBe("#,##0");
    const detail = book.getWorksheet("담보별 상세")!;
    const auto = detail.getRows(2, detail.rowCount - 1)!.find((r) => String(r.getCell(2).value).includes("자동차상해"))!;
    expect(auto.getCell(5).value).toBe(954_000);
    expect(typeof auto.getCell(8).value).toBe("string");
    expect(String(auto.getCell(9).value)).toContain("쪽");
  });
});

describe("PDF 저장(A4 세로, 한글 글꼴)", () => {
  it("A4 세로 쪽, 글꼴을 넣고(subset) 파일로 만든다", async () => {
    const bytes = await reviewToPdf(reviewOf(caseClaim(2)), fonts);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    for (const page of doc.getPages()) expect(page.getSize()).toEqual({ width: 595.28, height: 841.89 });
    // 넣은 글꼴 이름(pdf-lib subset은 "Pretendard-Regular-205"처럼 뒤에 번호가 붙는다)
    const fontNames = doc.context
      .enumerateIndirectObjects()
      .map(([, object]) => (object instanceof PDFDict ? object.get(PDFName.of("BaseFont")) : undefined))
      .filter((name): name is PDFName => name instanceof PDFName)
      .map((name) => name.decodeText());
    expect(fontNames.some((n) => /^Pretendard-Regular-\d+$/.test(n))).toBe(true);
    expect(fontNames.some((n) => /^Pretendard-Bold-\d+$/.test(n))).toBe(true);
    expect(bytes.length).toBeLessThan(300_000);
  });

  it("글리프가 모두 그려진다: 넣은 subset 글꼴의 모든 글리프를 읽을 수 있다(fontkit subset 정렬 버그 회귀 시험)", async () => {
    const doc = await PDFDocument.load(await reviewToPdf(reviewOf(caseClaim(5)), fonts));
    const files = doc.context
      .enumerateIndirectObjects()
      .map(([, object]) => (object instanceof PDFDict ? object.get(PDFName.of("FontFile2")) : undefined))
      .filter((ref): ref is PDFRef => ref instanceof PDFRef)
      .map((ref) => decodePDFRawStream(doc.context.lookup(ref) as PDFRawStream).decode());
    expect(files).toHaveLength(2);
    for (const bytes of files) {
      const font = fontkit.create(Buffer.from(bytes));
      expect(font.numGlyphs).toBeGreaterThan(100);
      let drawn = 0;
      for (let id = 0; id < font.numGlyphs; id++) if (font.getGlyph(id).path.toSVG() !== "") drawn++;
      // 빈 글리프는 .notdef·띄어쓰기 정도뿐
      expect(font.numGlyphs - drawn).toBeLessThanOrEqual(3);
    }
  });

  it("글꼴에 없는 글자(이모지)가 있어도 멈추지 않는다", async () => {
    const review: Review = { ...reviewOf(caseClaim(1)), accident: { ...reviewOf(caseClaim(1)).accident, narrative: "비 오는 날 🚗💥 교차로" } };
    await expect(reviewToPdf(review, fonts)).resolves.toBeInstanceOf(Uint8Array);
  });
});

if (process.env.WRITE_SAMPLES) {
  describe("샘플 파일(docs/samples)", () => {
    it("사례 (1)(2)(5) 엑셀·PDF", async () => {
      mkdirSync("docs/samples", { recursive: true });
      for (const sample of SAMPLES) {
        const review = reviewOf(caseClaim(sample.no));
        writeFileSync(`docs/samples/${sample.file}.xlsx`, await reviewToXlsx(review));
        writeFileSync(`docs/samples/${sample.file}.pdf`, await reviewToPdf(review, fonts));
      }
    });
  });
}
