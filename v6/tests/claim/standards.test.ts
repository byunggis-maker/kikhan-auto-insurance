import { describe, expect, it } from "vitest";
import { SELF_INJURY } from "@/lib/claim/standards";

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
