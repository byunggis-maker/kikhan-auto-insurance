import { describe, expect, it } from "vitest";
import type { ClaimReading } from "@/lib/ai/documents";
import { DAILY_AI_LIMIT } from "@/lib/ai/limits";
import { emptyClaim, type Claim, type Recognition } from "@/lib/claim/types";
import { setVictimCount } from "@/lib/ui/flow";
import { addRecognitions, claimRecognitions, confirmRecognition, factReadings, hasPretax, taxFormula } from "@/lib/ui/recognize";
import { pdfUseNotice } from "@/lib/ui/upload";

// 라운드 8d 지시 1·3: 세후 소득(세전 − 소득세 − 지방소득세), 세금 줄이 없으면 세전 금액 안내, 남은 횟수 표시 삭제.

let n = 0;
const makeId = () => `t${++n}`;
const base = (): Claim => {
  const c = setVictimCount({ ...emptyClaim(), accident: { ...emptyClaim().accident, occurredAt: "2026-09-01", type: "car_car" } }, "driver", 1);
  return { ...c, victims: c.victims.map((v) => ({ ...v, injuryGrade: 9 })) };
};
const facts: ClaimReading["facts"] = { hospitalDays: null, outpatientDays: null, daysOffWork: null, hospitalPeriods: null, outpatientDates: null, daysOffWorkPeriods: null, incomeMonth: null, monthlyIncome: null, incomeTax: null, localIncomeTax: null };
const slip = (f: Partial<ClaimReading["facts"]>): ClaimReading => ({ documentType: "급여명세서", issuer: null, documentDate: null, amounts: [], facts: { ...facts, ...f }, note: "" });
const read = (...docs: ClaimReading[]) => docs.reduce((c, d) => addRecognitions(c, claimRecognitions(c, "driver-1", d, makeId).recognitions), base());
const income = (c: Claim) => c.recognized.find((r): r is Extract<Recognition, { kind: "fact" }> => r.kind === "fact" && r.field === "monthlyIncome")!;

describe("월 소득: 세금 줄을 빼고 계산식을 보여 준다", () => {
  it("세전 3,000,000 − 소득세 84,850 − 지방소득세 8,480 = 2,906,670. 확인하면 세후 값이 들어간다", () => {
    const c = read(slip({ monthlyIncome: 3_000_000, incomeTax: 84_850, localIncomeTax: 8_480 }));
    const r = income(c);
    expect(r.value).toBe(2_906_670);
    expect(taxFormula(factReadings(r)[0])).toBe("세전 3,000,000원 − 소득세 84,850원 − 지방소득세 8,480원 = 2,906,670원");
    expect(hasPretax(r)).toBe(false);
    expect(confirmRecognition(c, r.id).victims[0].monthlyIncome).toBe(2_906_670);
  });

  it("소득세 줄만 있으면 지방소득세 0원으로 뺀다", () => {
    const r = income(read(slip({ monthlyIncome: 3_000_000, incomeTax: 84_850 })));
    expect(r.value).toBe(2_915_150);
    expect(taxFormula(factReadings(r)[0])).toBe("세전 3,000,000원 − 소득세 84,850원 − 지방소득세 0원 = 2,915,150원");
  });

  it("세금 줄이 없으면 그대로 넣고 '세전 금액' 표시", () => {
    const r = income(read(slip({ monthlyIncome: 3_000_000 })));
    expect(r.value).toBe(3_000_000);
    expect(taxFormula(factReadings(r)[0])).toBeNull();
    expect(hasPretax(r)).toBe(true);
  });

  it("세금이 세전 금액 이상이면 잘못 읽은 것으로 보고 세전 금액으로 둔다", () => {
    const r = income(read(slip({ monthlyIncome: 100_000, incomeTax: 100_000, localIncomeTax: 10_000 })));
    expect(r.value).toBe(100_000);
    expect(hasPretax(r)).toBe(true);
  });

  it("급여명세서 3장은 서류마다 세금을 뺀 뒤 3개월 평균. 한 장이라도 세금 줄이 없으면 '세전 금액' 표시", () => {
    const withTax = read(
      slip({ monthlyIncome: 3_000_000, incomeTax: 90_000, localIncomeTax: 9_000, incomeMonth: "2026-06" }),
      slip({ monthlyIncome: 3_100_000, incomeTax: 90_000, localIncomeTax: 9_000, incomeMonth: "2026-07" }),
      slip({ monthlyIncome: 3_200_000, incomeTax: 90_000, localIncomeTax: 9_000, incomeMonth: "2026-08" }),
    );
    const r = income(withTax);
    // (2,901,000 + 3,001,000 + 3,101,000) ÷ 3 = 3,001,000
    expect(r.value).toBe(3_001_000);
    expect(r.formula).toMatch(/^6월·7월·8월 평균 \(2,901,000 \+ 3,001,000 \+ 3,101,000\) ÷ 3 = 3,001,000원/);
    expect(factReadings(r).map(taxFormula)).toHaveLength(3);
    expect(hasPretax(r)).toBe(false);

    const mixed = income(read(slip({ monthlyIncome: 3_000_000, incomeTax: 90_000, localIncomeTax: 9_000, incomeMonth: "2026-07" }), slip({ monthlyIncome: 3_100_000, incomeMonth: "2026-08" })));
    expect(mixed.value).toBe(Math.floor((2_901_000 + 3_100_000) / 2));
    expect(hasPretax(mixed)).toBe(true);
  });

  it("날수 칸에는 세금이 붙지 않는다", () => {
    const c = read(slip({ hospitalDays: 5, incomeTax: 1_000 }));
    const days = c.recognized.find((r): r is Extract<Recognition, { kind: "fact" }> => r.kind === "fact" && r.field === "hospitalDays")!;
    expect(days.value).toBe(5);
    expect(hasPretax(days)).toBe(false);
  });
});

describe("큰 PDF 안내: 남은 횟수는 보여 주지 않는다", () => {
  it("'이 PDF는 ○회를 씁니다'만 남기고, 서버 한도 30회는 그대로", () => {
    const notice = pdfUseNotice({ pages: 7, uses: 5 });
    expect(notice).toBe("이 PDF는 5회를 씁니다. 전체 7쪽 중 앞 5쪽을 한 쪽씩 사진으로 바꿔 읽습니다.");
    expect(notice).not.toContain("남은");
    expect(DAILY_AI_LIMIT).toBe(30);
  });
});
