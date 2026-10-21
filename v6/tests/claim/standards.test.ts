import { describe, expect, it } from "vitest";
import { SELF_INJURY, dailyWageFor } from "@/lib/claim/standards";

// 별표3(개인용 인쇄 82쪽) 가입금액 3천만원 열을 약관 PDF에서 옮긴 그대로 확인한다(라운드 4 보고서에 같은 표를 싣는다).
const man = (n: number) => n * 10_000;

describe("별표3 자기신체사고 가입금액 3천만원", () => {
  it("1) 상해구분 및 급별 보험가입금액표", () => {
    expect(Object.values(SELF_INJURY.injuryLimits[30_000_000])).toEqual([3000, 1600, 1500, 1400, 1000, 800, 500, 360, 280, 240, 200, 180, 130, 80].map(man));
  });
  it("2) 후유장애구분 및 급별 보험가입금액표", () => {
    expect(Object.values(SELF_INJURY.disabilityAmounts[30_000_000])).toEqual([3000, 2700, 2400, 2100, 1800, 1500, 1200, 900, 720, 540, 420, 300, 180, 120].map(man));
  });
});

describe("일용근로자 임금(별표1 인쇄 74쪽, 결정 기록 D-35)", () => {
  it("2026-10 사고: (172,698 + 95,767) ÷ 2 = 134,232원(원 미만 버림), 월 × 25일 = 3,355,800원", () => {
    const wage = dailyWageFor("2026-10-15")!;
    expect(wage.value).toBe(134_232);
    expect(wage.monthly).toBe(3_355_800);
    expect(wage.construction).toMatchObject({ effectiveFrom: "2026-09-01", value: 172_698, source: "대한건설협회" });
    expect(wage.manufacturing).toMatchObject({ effectiveFrom: "2026-07-01", value: 95_767, source: "중소기업중앙회" });
    expect(wage.formula).toBe("(보통인부 172,698원 + 단순노무 95,767원) ÷ 2 = 134,232원, 약관 별표1(인쇄 74쪽)");
  });

  it("2026-08 사고: 보통인부 172,068원(2026-01-01 적용분)과 평균 → 133,917원", () => {
    const wage = dailyWageFor("2026-08-20")!;
    expect(wage.construction.value).toBe(172_068);
    expect(wage.value).toBe(133_917);
    expect(wage.monthly).toBe(133_917 * 25);
  });

  it("단순노무 단가가 없는 날(2026-07-01 전)은 null", () => {
    expect(dailyWageFor("2026-06-30")).toBeNull();
  });
});
