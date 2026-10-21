import { describe, expect, it } from "vitest";
import { liabilityBodily1 } from "@/lib/engine/legacy/coverages/liability-bodily-1";
import { excessOverCompulsory, type Claim } from "@/lib/engine/legacy/fault";
import { openRules } from "@/lib/engine/legacy/rules";
import { ACCIDENT_DATE, RULE_ITEMS, at, expectOk, injuryClaim, line, person } from "./helpers";

// 치료관계비 하한과 경상(12~14급) 구상. 사례와 기대값은 compass/tests/person-coverage.test.ts의 손 검산을 그대로 옮겼다
// (원본 줄: 14급 60–77, 9급 30% 112–123, 9급 70% 125–134, 12급 146–166, 원 미만 219–228, 사망 95% 266–274, 무보험 5급 204–217).
// 원본은 V2 손해 산정으로 장부를 만들지만, 여기서는 그 결과 금액(치료관계비와 그 밖의 손해)으로 장부를 직접 만든다.
// 금액 기준은 현대해상 개인용 약관 2025-11-26 개정 별표4·시행령 별표1(대인Ⅰ 급별 한도)이다.

/** 대인배상Ⅱ(가입금액 무한). 원본 liability-bodily-2.ts와 같은 호출 */
function bodily2(claim: Claim, limit: number | "unlimited" = "unlimited") {
  return excessOverCompulsory(claim, at(liabilityBodily1(claim)), limit, 0, "대인배상Ⅱ 가입금액");
}

describe("대인배상Ⅰ·Ⅱ 치료관계비 하한", () => {
  it("14급, 과실 0%: 손해액 1,030,000 → 대인Ⅰ 14급 한도 500,000, 대인Ⅱ 530,000", () => {
    const claim = injuryClaim({ grade: 14, faultPercent: 0, medical: 800_000, other: 230_000 });
    expect(expectOk(liabilityBodily1(claim)).total.expected).toBe(500_000);
    expect(expectOk(bodily2(claim)).total.expected).toBe(530_000);
  });

  it("9급, 과실 30%: 3,180,000 × 70% = 2,226,000 (치료관계비 2,000,000 이상이라 하한 없음)", () => {
    const claim = injuryClaim({ grade: 9, faultPercent: 30, medical: 2_000_000, other: 1_180_000 });
    const b1 = expectOk(liabilityBodily1(claim));
    expect(b1.total.expected).toBe(2_226_000);
    expect(b1.steps.find((s) => s.item === "injury_medical_floor")?.formula).toBe("과실상계 후 금액이 치료관계비·간병비 이상이라 그대로");
    expect(expectOk(bodily2(claim)).total.expected).toBe(0);
  });

  it("9급, 과실 70%: 3,180,000 × 30% = 954,000 < 치료관계비 2,000,000 → 2,000,000 보장", () => {
    const claim = injuryClaim({ grade: 9, faultPercent: 70, medical: 2_000_000, other: 1_180_000 });
    const b1 = expectOk(liabilityBodily1(claim));
    expect(b1.total.expected).toBe(2_000_000);
    expect(b1.ruleIds).toContain("fault.medicalFloor");
    expect(expectOk(bodily2(claim)).total.expected).toBe(0);
  });

  it("사망, 과실 95%: 268,518,400 × 5% = 13,425,920 < 2,000만원 → 대인Ⅰ 20,000,000, 대인Ⅱ 0", () => {
    const claim: Claim = {
      person: person({ faultPercent: 95, death: { date: "2026-04-01" } }),
      accidentDate: ACCIDENT_DATE,
      ledger: { lines: [line("death_total", "death", 268_518_400)] },
      rules: openRules(RULE_ITEMS, ACCIDENT_DATE),
    };
    expect(expectOk(liabilityBodily1(claim)).total.expected).toBe(20_000_000);
    expect(expectOk(bodily2(claim)).total.expected).toBe(0);
  });
});

describe("경상(12~14급) 차량운전자 구상", () => {
  // 12급, 치료관계비 3,000,000 + 그 밖의 손해 310,000 = 3,310,000, 본인 과실 70%
  // 과실상계: 3,310,000 × 30% = 993,000 < 치료관계비 3,000,000
  const grade12 = (vehicleDriver: boolean | null) => injuryClaim({ grade: 12, faultPercent: 70, medical: 3_000_000, other: 310_000, vehicleDriver });

  it("차량운전자: 본인 부담 (3,000,000 − 대인Ⅰ 한도 1,200,000) × 70% = 1,260,000 → 대인Ⅱ 540,000", () => {
    const claim = grade12(true);
    expect(expectOk(liabilityBodily1(claim)).total.expected).toBe(1_200_000);
    const b2 = expectOk(bodily2(claim));
    expect(b2.total.expected).toBe(540_000);
    expect(b2.steps.find((s) => s.item === "medical_floor")?.formula).toContain("경상환자 본인 부담");
    expect(b2.ruleIds).toContain("fault.minorInjuryGrades");
  });

  it("차량운전자가 아니면(보행자·이륜차 운전자 등) 치료비 전액 보장 → 대인Ⅱ 1,800,000", () => {
    expect(expectOk(bodily2(grade12(false))).total.expected).toBe(1_800_000);
  });

  it("운전자인지 모르면 최소는 운전자인 경우, 예상·최대는 아닌 경우", () => {
    const b2 = expectOk(bodily2(grade12(null)));
    expect(b2.total).toEqual({ min: 540_000, expected: 1_800_000, max: 1_800_000 });
    expect(b2.flags).toContain("minor_injury_driver_unknown");
  });
});

describe("공제와 한도", () => {
  it("대인Ⅰ 지급 가능액을 먼저 빼고 그다음 가입금액을 적용한다: 14급 530,000 → 한도 300,000이면 300,000", () => {
    const claim = injuryClaim({ grade: 14, faultPercent: 0, medical: 800_000, other: 230_000 });
    const b2 = expectOk(bodily2(claim, 300_000));
    expect(b2.steps.find((s) => s.item === "minus_compulsory")?.amount?.expected).toBe(530_000);
    expect(b2.total.expected).toBe(300_000);
  });

  it("무보험자동차상해(상대 책임보험만), 5급 과실 0%: 12,388,360 − 대인Ⅰ 9,000,000 = 3,388,360", () => {
    const claim = injuryClaim({ grade: 5, faultPercent: 0, medical: 9_000_000, other: 3_388_360 });
    expect(expectOk(liabilityBodily1(claim)).total.expected).toBe(9_000_000);
    const uninsured = excessOverCompulsory(claim, at(liabilityBodily1(claim)), 200_000_000, 0, "무보험자동차상해 가입금액");
    expect(expectOk(uninsured).total.expected).toBe(3_388_360);
  });

  it("원 미만이 생기면 버리고 rounding.won을 기록한다: 1,150,001 × 67% = 770,500.67 → 770,500", () => {
    const claim = injuryClaim({ grade: 14, faultPercent: 33, medical: 1_000_001, other: 150_000, vehicleDriver: false });
    const b1 = expectOk(liabilityBodily1(claim));
    expect(b1.steps.find((s) => s.item === "injury_after_fault")?.amount?.expected).toBe(770_500);
    expect(b1.ruleIds).toContain("rounding.won");
    expect(b1.total.expected).toBe(500_000);
    expect(expectOk(bodily2(claim)).total.expected).toBe(500_001);
  });

  it("과실비율이 없으면 0원이 아니라 정보 부족", () => {
    const result = liabilityBodily1(injuryClaim({ grade: 9, faultPercent: null, medical: 2_000_000, other: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("insufficient_info");
  });
});
