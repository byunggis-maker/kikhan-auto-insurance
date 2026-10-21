import { describe, expect, it, vi } from "vitest";
import type { ClaimReading } from "@/lib/ai/documents";
import { claimSchema, emptyClaim, type Claim, type Recognition } from "@/lib/claim/types";
import { calculate } from "@/lib/engine/dual-run";
import { buildReview } from "@/lib/report/review";
import { setVictimCount, toggleCoverage } from "@/lib/ui/flow";
import { addRecognitions, claimRecognitions, confirmLossGroup, confirmRecognition, duplicateIds, factDiffers, factReadings, groupTotal, lossGroup, setExcluded } from "@/lib/ui/recognize";
import { MAX_PDF_PAGES, UPLOAD_LIMIT, prepareUploads } from "@/lib/ui/upload";

// 라운드 8b 지시 2·3: 여러 서류가 같은 칸을 읽을 때. 금액은 서류별 줄 + 합계, 일수는 더하지 않고 큰 값.
// 모든 값은 "확인해 주세요" 상태로 들어간다(확인 전에는 계산에 쓰지 않는다).

let n = 0;
const makeId = () => `m${++n}`;
const base = (): Claim => {
  let c: Claim = { ...emptyClaim(), accident: { ...emptyClaim().accident, occurredAt: "2026-09-01", type: "car_car" }, fault: { mode: "known", myPercent: 30 } };
  c = toggleCoverage(c, "auto_injury", true);
  c = setVictimCount(c, "driver", 1);
  return { ...c, victims: c.victims.map((v) => ({ ...v, injuryGrade: 9 })) };
};
const noFacts = { hospitalDays: null, outpatientDays: null, daysOffWork: null, monthlyIncome: null };
const doc = (documentType: string, issuer: string | null, documentDate: string | null, treatment: number | null, facts: Partial<ClaimReading["facts"]> = {}): ClaimReading => ({
  documentType,
  issuer,
  documentDate,
  amounts: treatment === null ? [] : [{ code: "treatment", amount: treatment, basis: "진료비 총액" }],
  facts: { ...noFacts, ...facts },
  note: "",
});
/** 서류를 차례로 읽어 넣는다(화면에서 여러 장을 올린 것과 같다) */
const read = (...docs: ClaimReading[]) => docs.reduce((c, d) => addRecognitions(c, claimRecognitions(c, "driver-1", d, makeId).recognitions), base());

describe("금액 칸: 서류별 줄과 합계", () => {
  it("영수증 2장은 덮어쓰지 않고 두 줄로 두고 합계를 낸다. 확인하면 합계가 확정 칸에 들어간다", () => {
    const c = read(doc("진료비 영수증", "가상의료원", "2026-09-12", 2_000_000), doc("약제비 영수증", "가상약국", "2026-09-13", 350_000));
    const rows = lossGroup(c, "driver-1", "treatment");
    expect(rows.map((r) => [r.source, r.issuer, r.docDate, r.value])).toEqual([
      ["진료비 영수증", "가상의료원", "2026-09-12", 2_000_000],
      ["약제비 영수증", "가상약국", "2026-09-13", 350_000],
    ]);
    expect(groupTotal(rows)).toBe(2_350_000);
    expect(duplicateIds(rows).size).toBe(0);
    // 확인 전에는 계산에 쓰지 않는다
    expect(calculate(claimSchema.parse(c), 30).cards[0].actualLoss.confirmed).toBe(0);
    const done = claimSchema.parse(confirmLossGroup(c, "driver-1", "treatment"));
    expect(done.victims[0].losses.find((i) => i.code === "treatment")).toMatchObject({ confirmed: 2_350_000, evidence: "서류 인식 확인: 진료비 영수증 + 약제비 영수증" });
    expect(done.recognized).toEqual([]);
  });

  it("줄마다 뺄 수 있다(체크 해제). 뺀 줄은 합계·확정에서 빠지고 되돌릴 수 있다", () => {
    let c = read(doc("진료비 영수증", "가상의료원", "2026-09-12", 2_000_000), doc("약제비 영수증", "가상약국", "2026-09-13", 350_000));
    const [, second] = lossGroup(c, "driver-1", "treatment");
    c = setExcluded(c, second.id, true);
    expect(groupTotal(lossGroup(c, "driver-1", "treatment"))).toBe(2_000_000);
    // 검토서 '확인 필요'에는 뺀 줄도 표시와 함께 남는다
    expect(buildReview(claimSchema.parse(c), [calculate(claimSchema.parse(c), 30)], 0).missing.filter((m) => m.includes("(뺀 서류)"))).toHaveLength(1);
    expect(groupTotal(lossGroup(setExcluded(c, second.id, false), "driver-1", "treatment"))).toBe(2_350_000);
    expect(confirmLossGroup(c, "driver-1", "treatment").victims[0].losses.find((i) => i.code === "treatment")?.confirmed).toBe(2_000_000);
  });

  it("같은 영수증을 2번 올리면 두 줄 모두 '같은 서류로 보여요' 경고. 하나를 빼면 한 장 값만 확정된다", () => {
    const receipt = doc("진료비 영수증", "가상의료원", "2026-09-12", 2_000_000);
    let c = read(receipt, receipt);
    const rows = lossGroup(c, "driver-1", "treatment");
    expect(rows).toHaveLength(2);
    expect([...duplicateIds(rows)]).toEqual(rows.map((r) => r.id));
    expect(groupTotal(rows)).toBe(4_000_000);
    c = setExcluded(c, rows[1].id, true);
    expect(confirmLossGroup(c, "driver-1", "treatment").victims[0].losses.find((i) => i.code === "treatment")?.confirmed).toBe(2_000_000);
  });

  it("날짜·금액·기관명 중 하나라도 다르면 경고하지 않는다", () => {
    for (const other of [doc("진료비 영수증", "가상의료원", "2026-09-19", 2_000_000), doc("진료비 영수증", "다른의원", "2026-09-12", 2_000_000), doc("진료비 영수증", "가상의료원", "2026-09-12", 2_000_001)]) {
      const c = read(doc("진료비 영수증", "가상의료원", "2026-09-12", 2_000_000), other);
      expect(duplicateIds(lossGroup(c, "driver-1", "treatment")).size).toBe(0);
    }
  });

  it("뺀 줄만 남기고 확인하면 아무것도 넣지 않고 줄만 지운다", () => {
    let c = read(doc("진료비 영수증", "가상의료원", "2026-09-12", 2_000_000), doc("약제비 영수증", "가상약국", "2026-09-13", 350_000));
    for (const r of lossGroup(c, "driver-1", "treatment")) c = setExcluded(c, r.id, true);
    const done = confirmLossGroup(c, "driver-1", "treatment");
    expect(done.victims[0].losses.some((i) => i.code === "treatment")).toBe(false);
    expect(done.recognized).toEqual([]);
  });
});

describe("일수 칸: 더하지 않고 큰 값", () => {
  const fact = (c: Claim, field: string) => c.recognized.find((r): r is Extract<Recognition, { kind: "fact" }> => r.kind === "fact" && r.field === field)!;

  it("진단서 입원 5일 + 영수증 입원 5일은 10일이 아니라 5일. 값이 같으면 '다르다' 표시 없음", () => {
    const c = read(doc("진단서", "가상의료원", "2026-09-05", null, { hospitalDays: 5 }), doc("진료비 영수증", "가상의료원", "2026-09-12", 2_000_000, { hospitalDays: 5 }));
    const days = fact(c, "hospitalDays");
    expect(c.recognized.filter((r) => r.kind === "fact" && r.field === "hospitalDays")).toHaveLength(1);
    expect(days.value).toBe(5);
    expect(factDiffers(days)).toBe(false);
    expect(confirmRecognition(c, days.id).victims[0].hospitalDays).toBe(5);
  });

  it("서류마다 다르면 큰 값을 넣고 각 값을 남긴다(입원·통원·휴업)", () => {
    const c = read(
      doc("진단서", "가상의료원", "2026-09-05", null, { hospitalDays: 5, outpatientDays: 3, daysOffWork: 14 }),
      doc("진료비 영수증", "가상의료원", "2026-09-12", 2_000_000, { hospitalDays: 7, outpatientDays: 4, daysOffWork: 10 }),
    );
    for (const [field, value, readings] of [
      ["hospitalDays", 7, [5, 7]],
      ["outpatientDays", 4, [3, 4]],
      ["daysOffWork", 14, [14, 10]],
    ] as const) {
      const r = fact(c, field);
      expect(r.value).toBe(value);
      expect(factDiffers(r)).toBe(true);
      expect(factReadings(r)).toEqual([
        { source: "진단서", value: readings[0] },
        { source: "진료비 영수증", value: readings[1] },
      ]);
      expect(r.source).toBe("진단서 · 진료비 영수증");
    }
    // 확인 전에는 사람 칸이 비어 있다
    expect(c.victims[0].hospitalDays).toBeNull();
    expect(confirmRecognition(c, fact(c, "daysOffWork").id).victims[0].daysOffWork).toBe(14);
  });
});

describe("큰 PDF(5MB)는 쪽마다 사진으로", () => {
  const pdf = (bytes: number) => {
    const data = new Uint8Array(bytes);
    data.set(new TextEncoder().encode("%PDF-1.7\n"));
    return new File([data], "big.pdf", { type: "application/pdf" });
  };
  const jpeg = () => new Blob([new Uint8Array(300_000)], { type: "image/jpeg" });

  it("5MB PDF는 앞 5쪽까지 사진으로 바꿔 쪽마다 보낸다(7쪽이면 5쪽만, 전체 쪽 수를 알려 준다)", async () => {
    const render = vi.fn(async (_file: Blob, max: number) => ({ images: Array.from({ length: Math.min(7, max) }, jpeg), pageCount: 7 }));
    const file = pdf(5 * 1024 * 1024);
    const parts = await prepareUploads(file, render);
    expect(render).toHaveBeenCalledWith(file, MAX_PDF_PAGES);
    expect(MAX_PDF_PAGES).toBe(5);
    expect(parts.map((p) => [p.page, p.pages])).toEqual([1, 2, 3, 4, 5].map((page) => [page, 7]));
    expect(parts.every((p) => p.blob.type === "image/jpeg" && p.blob.size <= UPLOAD_LIMIT)).toBe(true);
  });

  it("4MB 이하 PDF는 그대로 한 건으로 보낸다(그리지 않는다)", async () => {
    const render = vi.fn();
    const file = pdf(1024 * 1024);
    expect(await prepareUploads(file, render)).toEqual([{ blob: file }]);
    expect(render).not.toHaveBeenCalled();
  });

  it("PDF를 열지 못하면 예외(화면이 '사진으로 찍어 올려 주세요' 안내)", async () => {
    await expect(prepareUploads(pdf(5 * 1024 * 1024), async () => Promise.reject(new Error("broken")))).rejects.toThrow();
  });
});
