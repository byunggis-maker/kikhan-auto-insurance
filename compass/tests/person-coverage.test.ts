import { describe, expect, it } from "vitest";
import { calculatePersonCoverages } from "@/lib/engine/coordinate";
import type { CoverageCell, CoverageKey } from "@/lib/engine/types";
import { personRuleItems, personRules } from "@/lib/rules/person-rules";
import { personCoverageInputSchema, type PersonClaim, type PersonCoverageInput } from "@/lib/schemas/person-claim";
import type { RuleItem } from "@/lib/schemas/rules";

// 사람 담보 계산의 손 검산 사례. 금액은 data/rules/standard의 값(현대해상 개인용 약관 2025-11-26)으로 계산했다.
// 사람과 금액은 모두 지어낸 가상 사례다.

type Injury = NonNullable<PersonClaim["injury"]>;

function injury(change: Partial<Injury>): Injury {
  return { grade: null, treatmentCost: null, futureTreatmentCost: 0, hospitalDays: 0, outpatientDays: 0, daysOffWork: 0, dailyIncomeLoss: null, mealsNotProvided: 0, nursingProven: false, ...change };
}

function person(change: Partial<PersonClaim>): PersonClaim {
  return {
    id: "p1",
    label: "가상 인물",
    birthDate: "1986-09-01",
    faultPercent: 0,
    occupationType: "employee",
    monthlyIncome: null,
    incomeProven: null,
    vehicleDriver: true,
    injury: null,
    death: null,
    disability: null,
    receivedFromThirdParty: 0,
    receivedFromLiableParty: 0,
    ...change,
  };
}

const FULL = { status: "full" as const, bodily2Limit: "unlimited" as const };
const AUTO_INJURY = { autoInjury: { injuryLimit: 30_000_000, deathDisabilityLimit: 200_000_000 }, selfInjury: null, uninsured: { limit: 200_000_000 } };
const SELF_INJURY = { autoInjury: null, selfInjury: { injuryLimit: 30_000_000, deathLimit: 30_000_000, disabilityLimit: 30_000_000 }, uninsured: null };

function run(change: Partial<PersonCoverageInput> & { person: PersonClaim }, rules: RuleItem[] = personRuleItems) {
  const input = personCoverageInputSchema.parse({ accidentDate: "2026-09-01", side: "mine", liable: FULL, own: AUTO_INJURY, ...change });
  const result = calculatePersonCoverages(input, rules);
  const cell = (key: CoverageKey) => result.cells.find((c) => c.coverage === key) as CoverageCell;
  return { result, cell, expected: (key: CoverageKey) => cell(key).amount?.expected ?? null };
}

/** 약관에 숫자가 없는 일용근로자 임금을 시험용 가정값으로 채운 규칙 */
function withDailyWage(amount: number): RuleItem[] {
  return personRuleItems.map((item) => (item.id === "dailyWage.amount" ? { ...item, value: amount } : item));
}

describe("부상", () => {
  it("경상 통원: 14급, 치료비 80만원, 통원 10일, 무직, 과실 0%", () => {
    // 치료관계비 800,000
    // 위자료 14급 150,000
    // 통원 10일 × 8,000 = 80,000
    // 휴업손해: 무직자 → 0
    // 손해액 합계 = 1,030,000
    // 대인배상Ⅰ: 14급 한도 500,000 → 500,000
    // 대인배상Ⅱ: 1,030,000 − 500,000 = 530,000
    // 자동차상해: 1,030,000 − (500,000 + 530,000) = 0
    const { cell, expected } = run({ person: person({ occupationType: "unemployed", injury: injury({ grade: 14, treatmentCost: 800_000, outpatientDays: 10 }) }) });
    expect(expected("liability_bodily_1")).toBe(500_000);
    expect(expected("liability_bodily_2")).toBe(530_000);
    expect(expected("auto_injury")).toBe(0);
    expect(cell("liability_bodily_1").needsCheckRuleIds).toEqual([]);
    expect(cell("liability_bodily_1").basis.some((text) => text.includes("14급") && text.includes("90쪽"))).toBe(true);
    expect(cell("self_injury").status).toBe("not_applicable");
    expect(cell("uninsured").status).toBe("not_applicable");
  });

  it("입원+수술: 5급, 치료비 900만원, 입원 20일(식대 12끼), 통원 5일, 30일 휴업(1일 10만원 증명), 과실 0%", () => {
    // 치료관계비 9,000,000
    // 위자료 5급 750,000
    // 휴업손해 100,000 × 30일 × 85% = 2,550,000
    // 통원 5일 × 8,000 = 40,000
    // 식대 12끼 × 4,030 = 48,360
    // 손해액 합계 = 12,388,360
    // 대인배상Ⅰ: 5급 한도 9,000,000 → 9,000,000
    // 대인배상Ⅱ: 12,388,360 − 9,000,000 = 3,388,360
    const { cell, expected } = run({
      person: person({ incomeProven: true, injury: injury({ grade: 5, treatmentCost: 9_000_000, hospitalDays: 20, mealsNotProvided: 12, outpatientDays: 5, daysOffWork: 30, dailyIncomeLoss: 100_000 }) }),
    });
    expect(expected("liability_bodily_1")).toBe(9_000_000);
    expect(expected("liability_bodily_2")).toBe(3_388_360);
    expect(expected("auto_injury")).toBe(0);
    expect(cell("liability_bodily_2").lines.find((line) => line.item === "lost_income")?.amount?.expected).toBe(2_550_000);
    expect(cell("liability_bodily_2").lines.find((line) => line.item === "meals")?.amount?.expected).toBe(48_360);
  });

  it("단독사고 자동차상해(원본 앱 회귀 사례): 7급, 치료비 550만원, 통원 3일 → 5,924,000원", () => {
    // 5,500,000 + 위자료 7급 400,000 + 통원 3일 × 8,000 = 5,924,000 (부상 가입금액 3천만원 이내, 공제 없음)
    const { cell } = run({ liable: { status: "no_counterparty", bodily2Limit: null }, person: person({ faultPercent: 100, injury: injury({ grade: 7, treatmentCost: 5_500_000, outpatientDays: 3 }) }) });
    expect(cell("auto_injury").amount).toEqual({ min: 5_924_000, expected: 5_924_000, max: 5_924_000 });
    expect(cell("liability_bodily_1").status).toBe("not_applicable");
    expect(cell("auto_injury").basis.some((text) => text.includes("자동차상해 특별약관"))).toBe(true);
  });

  // 9급, 치료비 200만원, 통원 10일, 월소득 300만원(증명) 10일 휴업
  // 치료관계비 2,000,000 / 위자료 9급 250,000 / 통원 80,000
  // 휴업손해 3,000,000 ÷ 30일 × 10일 × 85% = 850,000 → 손해액 합계 3,180,000
  const grade9 = (faultPercent: number) =>
    person({ faultPercent, monthlyIncome: 3_000_000, incomeProven: true, injury: injury({ grade: 9, treatmentCost: 2_000_000, outpatientDays: 10, daysOffWork: 10 }) });

  it("과실 30%: 과실상계 후 금액이 치료비보다 많은 경우", () => {
    // 과실상계: 3,180,000 × 70% = 2,226,000 (치료관계비 2,000,000 이상 → 그대로)
    // 대인배상Ⅰ: 9급 한도 2,400,000 이내 → 2,226,000
    // 대인배상Ⅱ: 2,226,000 − 2,226,000 = 0
    // 자동차상해: 3,180,000(과실상계 없음) − 2,226,000 = 954,000
    const { cell, expected } = run({ person: grade9(30) });
    expect(expected("liability_bodily_1")).toBe(2_226_000);
    expect(expected("liability_bodily_2")).toBe(0);
    expect(expected("auto_injury")).toBe(954_000);
    // 월소득을 30일로 나누는 기준은 약관에 없어 "약관 확인 필요"로 남는다.
    expect(cell("auto_injury").needsCheckRuleIds).toContain("lostIncome.daysPerMonth");
  });

  it("과실 70%: 치료비 보장 — 과실상계 후 금액이 치료비보다 적으면 치료비를 보상", () => {
    // 과실상계: 3,180,000 × 30% = 954,000 < 치료관계비 2,000,000 → 2,000,000
    // 대인배상Ⅰ: 9급 한도 2,400,000 이내 → 2,000,000
    // 대인배상Ⅱ: 2,000,000 − 2,000,000 = 0
    // 자동차상해: 3,180,000 − 2,000,000 = 1,180,000
    const { expected } = run({ person: grade9(70) });
    expect(expected("liability_bodily_1")).toBe(2_000_000);
    expect(expected("liability_bodily_2")).toBe(0);
    expect(expected("auto_injury")).toBe(1_180_000);
  });

  it("자기신체사고(공제액 있음): 같은 9급 사례, 과실 30%", () => {
    // 실제손해액 3,180,000 − 대인배상 2,226,000 = 954,000
    // 가입금액 3천만원의 9급 한도 2,800,000 이내 → 954,000
    const { cell, expected } = run({ own: SELF_INJURY, person: grade9(30) });
    expect(expected("self_injury")).toBe(954_000);
    expect(cell("auto_injury").status).toBe("not_applicable");
  });

  // 12급, 치료비 300만원, 통원 20일, 무직, 본인 과실 70%
  // 치료관계비 3,000,000 / 위자료 12급 150,000 / 통원 160,000 → 손해액 합계 3,310,000
  // 과실상계: 3,310,000 × 30% = 993,000 < 치료관계비 3,000,000
  const grade12 = (vehicleDriver: boolean | null) =>
    person({ faultPercent: 70, occupationType: "unemployed", vehicleDriver, injury: injury({ grade: 12, treatmentCost: 3_000_000, outpatientDays: 20 }) });

  it("경상환자(12급) 차량운전자: 대인배상Ⅰ 한도를 넘는 치료비에는 본인 과실만큼 부담", () => {
    // 대인배상Ⅰ: 치료비 보장 3,000,000 → 12급 한도 1,200,000
    // 본인 부담: (3,000,000 − 1,200,000) × 70% = 1,260,000
    // 대인배상Ⅱ: (3,000,000 − 1,260,000) − 1,200,000 = 540,000
    const { expected } = run({ person: grade12(true) });
    expect(expected("liability_bodily_1")).toBe(1_200_000);
    expect(expected("liability_bodily_2")).toBe(540_000);
  });

  it("같은 12급이라도 차량운전자가 아니면(보행자 등) 치료비 전액 보장", () => {
    // 대인배상Ⅱ: 3,000,000 − 1,200,000 = 1,800,000
    expect(run({ person: grade12(false) }).expected("liability_bodily_2")).toBe(1_800_000);
    // 운전자인지 모르면 최소는 운전자인 경우, 예상·최대는 아닌 경우
    const unknown = run({ person: grade12(null) }).cell("liability_bodily_2");
    expect(unknown.amount).toEqual({ min: 540_000, expected: 1_800_000, max: 1_800_000 });
    expect(unknown.flags).toContain("minor_injury_driver_unknown");
  });

  it("과실 100%: 상대방 대인배상은 해당 없음, 자동차상해는 과실과 상관없이 전액", () => {
    // 손해액 3,180,000 → 자동차상해 3,180,000 (부상 가입금액 3천만원 이내)
    const { cell, expected } = run({ person: grade9(100) });
    expect(cell("liability_bodily_1").status).toBe("not_applicable");
    expect(cell("liability_bodily_2").status).toBe("not_applicable");
    expect(cell("liability_bodily_1").amount).toBeNull();
    expect(expected("auto_injury")).toBe(3_180_000);
  });

  it("과실 100% 자기신체사고: 공제액이 없으면 실제 치료비를 급별 한도까지", () => {
    // 12급, 치료비 3,000,000. 가입금액 3천만원의 12급 한도 1,800,000 → 1,800,000
    const { cell, expected } = run({ own: SELF_INJURY, liable: { status: "no_counterparty", bodily2Limit: null }, person: grade12(true) });
    expect(expected("self_injury")).toBe(1_800_000);
    expect(cell("self_injury").basis.some((text) => text.includes("12급") && text.includes("82쪽"))).toBe(true);
    // 치료비가 한도보다 적으면 치료비만: 9급 한도 2,800,000, 치료비 2,000,000 → 2,000,000
    expect(run({ own: SELF_INJURY, liable: { status: "no_counterparty", bodily2Limit: null }, person: grade9(100) }).expected("self_injury")).toBe(2_000_000);
  });

  it("무직자 휴업손해는 0원(계산된 0원이며 정보 부족이 아니다)", () => {
    const { cell } = run({ person: person({ occupationType: "unemployed", injury: injury({ grade: 9, treatmentCost: 1_000_000, daysOffWork: 20 }) }) });
    const line = cell("liability_bodily_1").lines.find((l) => l.item === "lost_income");
    expect(line?.amount).toEqual({ min: 0, expected: 0, max: 0 });
    expect(line?.formula).toContain("수입의 감소가 없는 것으로");
    expect(line?.ruleIds).toContain("lostIncome.noLossOccupations");
  });

  it("소득을 증명하지 못한 휴업손해: 최소·예상 0원, 최대는 증명했을 때의 금액", () => {
    // 최대: 3,000,000 ÷ 30 × 10일 × 85% = 850,000
    // 손해액: 최소·예상 2,000,000 + 250,000 = 2,250,000, 최대 3,100,000
    // 대인배상Ⅰ(9급 한도 2,400,000): 최소·예상 2,250,000, 최대 2,400,000
    // 대인배상Ⅱ: 최소·예상 0, 최대 3,100,000 − 2,400,000 = 700,000
    const { cell } = run({ person: person({ monthlyIncome: 3_000_000, incomeProven: false, injury: injury({ grade: 9, treatmentCost: 2_000_000, daysOffWork: 10 }) }) });
    expect(cell("liability_bodily_1").amount).toEqual({ min: 2_250_000, expected: 2_250_000, max: 2_400_000 });
    expect(cell("liability_bodily_2").amount).toEqual({ min: 0, expected: 0, max: 700_000 });
  });

  it("무보험자동차상해: 상대 차량이 책임보험만 가입, 5급 사례", () => {
    // 손해액 12,388,360, 과실 0%
    // 대인배상Ⅰ 9,000,000 / 대인배상Ⅱ 해당 없음
    // 무보험자동차상해: 12,388,360 − 9,000,000 = 3,388,360 (가입금액 2억원 이내)
    // 자동차상해: 12,388,360 − 9,000,000 − 3,388,360 = 0
    const { cell, expected } = run({
      liable: { status: "mandatory_only", bodily2Limit: null },
      person: person({ incomeProven: true, injury: injury({ grade: 5, treatmentCost: 9_000_000, hospitalDays: 20, mealsNotProvided: 12, outpatientDays: 5, daysOffWork: 30, dailyIncomeLoss: 100_000 }) }),
    });
    expect(expected("liability_bodily_1")).toBe(9_000_000);
    expect(cell("liability_bodily_2").status).toBe("not_applicable");
    expect(expected("uninsured")).toBe(3_388_360);
    expect(expected("auto_injury")).toBe(0);
  });

  it("원 미만이 생기면 버리고 '약관 확인 필요'를 붙인다", () => {
    // 치료비 1,000,001 + 위자료 14급 150,000 = 1,150,001, 과실 33%
    // 1,150,001 × 67% = 770,500.67 → 770,500 < 치료비 1,000,001 → 치료비 보장 1,000,001 → 14급 한도 500,000
    // 자동차상해: 1,150,001 − 대인Ⅰ 500,000 − 대인Ⅱ (1,000,001 − 500,000 = 500,001) = 150,000
    const { cell, expected } = run({ person: person({ faultPercent: 33, vehicleDriver: false, occupationType: "unemployed", injury: injury({ grade: 14, treatmentCost: 1_000_001 }) }) });
    expect(cell("liability_bodily_1").lines.find((l) => l.item === "injury_after_fault")?.amount?.expected).toBe(770_500);
    expect(cell("liability_bodily_1").needsCheckRuleIds).toContain("rounding.won");
    expect(expected("auto_injury")).toBe(150_000);
  });
});

describe("사망", () => {
  // 약관 용어해설 105의 예시와 같은 조건(사고일만 규칙 시행일 뒤로 옮김):
  // 1970-08-15생, 2026-04-01 사망(만 55세), 월현실소득 300만원(증명)
  // 취업가능월수: 2026-04-01 ~ 2035-08-15(65세) = 9년 4개월 14일 → 112개월, 호프만 계수 91.7592
  // 상실수익액 3,000,000 × (1 − 1/3) × 91.7592 = 183,518,400
  // 장례비 5,000,000 + 위자료(65세 미만) 80,000,000 + 183,518,400 = 268,518,400
  const dead = (faultPercent: number) => person({ birthDate: "1970-08-15", faultPercent, monthlyIncome: 3_000_000, incomeProven: true, death: { date: "2026-04-01" } });

  it("과실 0%: 대인배상Ⅰ 1억5천만원, 나머지는 대인배상Ⅱ", () => {
    // 대인배상Ⅰ: 사망 한도 150,000,000
    // 대인배상Ⅱ: 268,518,400 − 150,000,000 = 118,518,400
    const { cell, expected } = run({ accidentDate: "2026-04-01", person: dead(0) });
    expect(cell("liability_bodily_1").lines.find((l) => l.item === "lost_earnings_death")?.amount?.expected).toBe(183_518_400);
    expect(expected("liability_bodily_1")).toBe(150_000_000);
    expect(expected("liability_bodily_2")).toBe(118_518_400);
    expect(expected("auto_injury")).toBe(0);
  });

  it("과실 20%", () => {
    // 268,518,400 × 80% = 214,814,720
    // 대인배상Ⅰ 150,000,000 / 대인배상Ⅱ 214,814,720 − 150,000,000 = 64,814,720
    // 자동차상해(사망 2억원): 268,518,400 − 214,814,720 = 53,703,680
    const { expected } = run({ accidentDate: "2026-04-01", person: dead(20) });
    expect(expected("liability_bodily_1")).toBe(150_000_000);
    expect(expected("liability_bodily_2")).toBe(64_814_720);
    expect(expected("auto_injury")).toBe(53_703_680);
  });

  it("과실 95%: 대인배상Ⅰ 사망 최저 보상 2,000만원", () => {
    // 268,518,400 × 5% = 13,425,920 < 20,000,000 → 대인배상Ⅰ 20,000,000
    // 대인배상Ⅱ: 13,425,920 − 20,000,000 → 0
    // 자동차상해: 268,518,400 − 20,000,000 = 248,518,400 → 사망 가입금액 200,000,000
    const { expected } = run({ accidentDate: "2026-04-01", person: dead(95) });
    expect(expected("liability_bodily_1")).toBe(20_000_000);
    expect(expected("liability_bodily_2")).toBe(0);
    expect(expected("auto_injury")).toBe(200_000_000);
  });

  it("71세 사망: 위자료 5천만원, 취업가능월수 24개월", () => {
    // 1955-03-10생, 2026-04-01 사망(만 71세) → 67세부터 76세 미만: 24개월, 호프만 계수 22.8290
    // 상실수익액 2,400,000 × 2/3 × 22.8290 = 36,526,400
    // 5,000,000 + 50,000,000 + 36,526,400 = 91,526,400 → 대인배상Ⅰ 한도 이내
    const { expected } = run({ accidentDate: "2026-04-01", person: person({ birthDate: "1955-03-10", monthlyIncome: 2_400_000, incomeProven: true, death: { date: "2026-04-01" } }) });
    expect(expected("liability_bodily_1")).toBe(91_526_400);
    expect(expected("liability_bodily_2")).toBe(0);
  });

  it("자기신체사고 단독사고 사망: 공제액이 없으면 사망 가입금액", () => {
    const { cell } = run({ own: SELF_INJURY, liable: { status: "no_counterparty", bodily2Limit: null }, person: dead(100) });
    expect(cell("self_injury").amount).toEqual({ min: 30_000_000, expected: 30_000_000, max: 30_000_000 });
  });
});

describe("후유장애", () => {
  // 1986-09-01생(만 40세), 사고·판정 2026-09-01, 월소득 400만원(증명), 노동능력상실률 30%, 후유장애 9급, 상해 7급 치료비 1,000만원
  // 취업가능월수: 2026-09-01 ~ 2051-09-01 = 300개월, 호프만 계수 194.3457
  // 상실수익액 4,000,000 × 30% × 194.3457 = 233,214,840
  // 후유장애 위자료: 27% 이상 35% 미만 → 2,000,000 (부상 위자료 7급 400,000보다 많으므로 최소·예상은 이 금액 하나만. 최대는 둘 다 합산)
  // 부상 손해액 10,000,000 / 후유장애 손해액 235,214,840 / 합계 245,214,840
  const disabled = (faultPercent: number, lossRatePercent = "30") =>
    person({ faultPercent, monthlyIncome: 4_000_000, incomeProven: true, injury: injury({ grade: 7, treatmentCost: 10_000_000 }), disability: { lossRatePercent, grade: 9, determinedOn: null } });

  it("과실 0%: 구분별 대인배상Ⅰ 한도와 대인배상Ⅱ", () => {
    // 대인배상Ⅰ: 부상 7급 한도 5,000,000 + 후유장애 9급 한도 38,000,000 = 43,000,000
    // 대인배상Ⅱ: 245,214,840 − 43,000,000 = 202,214,840
    const { cell, expected } = run({ person: disabled(0) });
    expect(cell("liability_bodily_1").lines.find((l) => l.item === "lost_earnings_disability")?.amount?.expected).toBe(233_214_840);
    expect(cell("liability_bodily_1").lines.find((l) => l.item === "solatium_disability")?.amount?.expected).toBe(2_000_000);
    expect(cell("liability_bodily_1").lines.find((l) => l.item === "solatium_injury")?.amount).toEqual({ min: 0, expected: 0, max: 400_000 });
    expect(expected("liability_bodily_1")).toBe(43_000_000);
    expect(expected("liability_bodily_2")).toBe(202_214_840);
    // 일용근로자 임금과 위자료 중복 처리는 확인되지 않은 규칙이다.
    expect(cell("liability_bodily_2").needsCheckRuleIds).toEqual(expect.arrayContaining(["dailyWage.amount", "solatium.disability.overlap"]));
  });

  it("위자료 중복: 최소·예상은 큰 금액 하나만, 최대는 둘 다 합산하고 '해석에 따라 금액 차이 있음'을 붙인다", () => {
    // 최소·예상 손해액 245,214,840 / 최대 손해액 245,214,840 + 부상 위자료 400,000 = 245,614,840
    // 대인배상Ⅰ은 한도(부상 5,000,000 + 후유장애 38,000,000)에 걸려 세 값이 같다.
    // 대인배상Ⅱ: 최소·예상 202,214,840 / 최대 245,614,840 − 43,000,000 = 202,614,840
    const { cell } = run({ person: disabled(0) });
    expect(cell("liability_bodily_1").amount).toEqual({ min: 43_000_000, expected: 43_000_000, max: 43_000_000 });
    expect(cell("liability_bodily_2").amount).toEqual({ min: 202_214_840, expected: 202_214_840, max: 202_614_840 });
    const line = cell("liability_bodily_2").lines.find((l) => l.item === "solatium_injury");
    expect(line?.flags).toEqual(["interpretation_varies"]);
    expect(line?.formula).toContain("해석에 따라 금액 차이 있음");
    expect(cell("liability_bodily_2").flags).toContain("interpretation_varies");
    expect(cell("liability_bodily_2").needsCheckRuleIds).toEqual(expect.arrayContaining(["solatium.disability.overlap", "solatium.disability.overlapMax"]));
  });

  it("위자료 중복: 부상 위자료가 더 크면 그 금액이 후유장애 위자료가 되고, 최대에는 작은 쪽을 더한다", () => {
    // 상해 1급 위자료 2,000,000 / 노동능력상실률 3%(5% 미만) 위자료 500,000
    // 최소·예상: 큰 금액 2,000,000 하나만 / 최대: 2,000,000 + 500,000 = 2,500,000
    const { result } = run({
      person: person({ monthlyIncome: 4_000_000, incomeProven: true, injury: injury({ grade: 1, treatmentCost: 10_000_000 }), disability: { lossRatePercent: "3", grade: 14, determinedOn: null } }),
    });
    const amount = (item: string) => result.ledger.lines.find((l) => l.item === item)?.amount;
    expect(amount("solatium_disability")).toEqual({ min: 2_000_000, expected: 2_000_000, max: 2_000_000 });
    expect(amount("solatium_injury")).toEqual({ min: 0, expected: 0, max: 500_000 });
  });

  it("위자료 중복: 후유장애가 없으면 부상 위자료는 그대로이고 표시가 없다", () => {
    const { result, cell } = run({ person: person({ occupationType: "unemployed", injury: injury({ grade: 7, treatmentCost: 1_000_000 }) }) });
    expect(result.ledger.lines.find((l) => l.item === "solatium_injury")?.amount).toEqual({ min: 400_000, expected: 400_000, max: 400_000 });
    expect(cell("liability_bodily_1").flags).not.toContain("interpretation_varies");
  });

  it("과실 40%: 자동차상해는 구분별 가입금액까지", () => {
    // 과실상계: 245,214,840 × 60% = 147,128,904
    // 대인배상Ⅰ: 부상 10,000,000 × 60% = 6,000,000 → 한도 5,000,000 / 후유장애 235,214,840 × 60% = 141,128,904 → 한도 38,000,000 → 합계 43,000,000
    // 대인배상Ⅱ: 147,128,904 − 43,000,000 = 104,128,904 (부상 1,000,000 + 후유장애 103,128,904)
    // 자동차상해 부상: 10,000,000 − (5,000,000 + 1,000,000) = 4,000,000 (3천만원 이내)
    // 자동차상해 후유장애: 235,214,840 − (38,000,000 + 103,128,904) = 94,085,936 (2억원 이내)
    // 자동차상해 합계 98,085,936. 세 칸의 합 = 245,214,840 = 손해액 합계
    const { expected } = run({ person: disabled(40) });
    expect(expected("liability_bodily_1")).toBe(43_000_000);
    expect(expected("liability_bodily_2")).toBe(104_128_904);
    expect(expected("auto_injury")).toBe(98_085_936);
  });

  it("노동능력상실률 60%: 위자료 4,500만원 × 60% × 85% = 22,950,000", () => {
    const { cell } = run({ person: disabled(0, "60") });
    expect(cell("liability_bodily_1").lines.find((l) => l.item === "solatium_disability")?.amount?.expected).toBe(22_950_000);
  });

  it("자기신체사고 단독사고 후유장애 9급: 가입금액 3천만원의 9급 보험금액 720만원 + 부상 치료비(7급 한도 500만원)", () => {
    const { expected } = run({ own: SELF_INJURY, liable: { status: "no_counterparty", bodily2Limit: null }, person: disabled(100) });
    expect(expected("self_injury")).toBe(7_200_000 + 5_000_000);
  });
});

describe("정보 부족과 약관 확인 필요", () => {
  it("치료비를 입력하지 않으면 0원이 아니라 정보 부족", () => {
    const { result } = run({ person: person({ injury: injury({ grade: 9 }) }) });
    for (const cell of result.cells.filter((c) => c.status !== "not_applicable")) {
      expect(cell.status).toBe("insufficient_info");
      expect(cell.amount).toBeNull();
      expect(cell.inTotal).toBe(false);
      expect(cell.missing).toContainEqual({ field: "injury.treatmentCost", message: "치료비를 입력하면 계산됩니다" });
      expect(cell.reason).toContain("정보 부족: 치료비를 입력하면 계산됩니다");
    }
  });

  it("과실비율이 없으면 대인배상은 정보 부족, 자동차상해는 최소 0원 ~ 최대 전액", () => {
    const { cell } = run({ person: person({ faultPercent: null, occupationType: "unemployed", injury: injury({ grade: 14, treatmentCost: 800_000 }) }) });
    expect(cell("liability_bodily_1").status).toBe("insufficient_info");
    expect(cell("auto_injury").amount).toEqual({ min: 0, expected: 950_000, max: 950_000 });
    expect(cell("auto_injury").flags).toContain("deduction_unknown");
  });

  it("상대방 대인배상Ⅱ 가입금액을 모르면 '상대방 계약 확인 필요'이고, 내 증권의 한도를 대신 쓰지 않는다", () => {
    // 5급 사례(손해액 12,388,360). 대인배상Ⅰ 9,000,000은 법정 한도라 계산된다.
    // 자동차상해: 최소는 대인배상Ⅱ가 무한일 때 12,388,360 − 9,000,000 − 3,388,360 = 0, 예상·최대는 12,388,360 − 9,000,000 = 3,388,360
    const { cell } = run({
      liable: { status: "full", bodily2Limit: null },
      person: person({ incomeProven: true, injury: injury({ grade: 5, treatmentCost: 9_000_000, hospitalDays: 20, mealsNotProvided: 12, outpatientDays: 5, daysOffWork: 30, dailyIncomeLoss: 100_000 }) }),
    });
    expect(cell("liability_bodily_1").amount?.expected).toBe(9_000_000);
    expect(cell("liability_bodily_2").status).toBe("insufficient_info");
    expect(cell("liability_bodily_2").reason).toContain("상대방 계약 확인 필요");
    expect(cell("auto_injury").amount).toEqual({ min: 0, expected: 3_388_360, max: 3_388_360 });
  });

  it("선택 항목이 비어 있으면 계산은 하되 '입력하면 더해집니다'로 알린다", () => {
    const { cell } = run({ person: person({ occupationType: "unemployed", injury: injury({ grade: 14, treatmentCost: 800_000, outpatientDays: null }) }) });
    expect(cell("liability_bodily_1").status).toBe("calculated");
    expect(cell("liability_bodily_1").flags).toContain("partial");
    expect(cell("liability_bodily_1").missing).toContainEqual({ field: "injury.outpatientDays", message: "통원일수를 입력하면 더해집니다" });
  });

  it("가사종사자 휴업손해: 일용근로자 임금이 비어 있어 그 줄만 빼고 계산하고 '일용근로자 임금 입력 필요'를 붙인다", () => {
    const homemaker = person({ occupationType: "homemaker", injury: injury({ grade: 9, treatmentCost: 2_000_000, daysOffWork: 10 }) });
    const { cell } = run({ person: homemaker });
    const line = cell("liability_bodily_1").lines.find((l) => l.item === "lost_income");
    expect(line?.amount).toBeNull();
    expect(line?.flags).toEqual(["daily_wage_required"]);
    expect(line?.formula).toContain("일용근로자 임금 입력 필요");
    expect(cell("liability_bodily_1").flags).toEqual(expect.arrayContaining(["daily_wage_required", "partial"]));
    expect(cell("liability_bodily_1").needsCheckRuleIds).toContain("dailyWage.amount");
    expect(cell("liability_bodily_1").amount?.expected).toBe(2_250_000);
    // 시험용 가정값 150,000원을 넣으면: 150,000 × 10일 × 85% = 1,275,000
    const filled = run({ person: homemaker }, withDailyWage(150_000));
    expect(filled.cell("liability_bodily_2").lines.find((l) => l.item === "lost_income")?.amount?.expected).toBe(1_275_000);
    expect(filled.cell("liability_bodily_2").flags).not.toContain("daily_wage_required");
  });

  it("간병비(시험용 임금 가정): 2급, 입원 90일 → 인정 60일, 과실 80%여도 치료비와 간병비는 보장", () => {
    // 임금 가정 150,000원 × 60일 = 9,000,000
    // 치료관계비 20,000,000 + 위자료 2급 1,760,000 + 간병비 9,000,000 = 30,760,000
    // 과실상계: 30,760,000 × 20% = 6,152,000 < 치료관계비+간병비 29,000,000 → 29,000,000
    // 대인배상Ⅰ: 2급 한도 15,000,000 / 대인배상Ⅱ: 29,000,000 − 15,000,000 = 14,000,000
    const { expected } = run(
      { person: person({ faultPercent: 80, occupationType: "unemployed", injury: injury({ grade: 2, treatmentCost: 20_000_000, hospitalDays: 90, nursingProven: true }) }) },
      withDailyWage(150_000),
    );
    expect(expected("liability_bodily_1")).toBe(15_000_000);
    expect(expected("liability_bodily_2")).toBe(14_000_000);
  });

  it("사고일이 규칙 시행일보다 앞이면 그 규칙을 쓰지 않는다", () => {
    const { cell } = run({ accidentDate: "2025-01-01", person: person({ occupationType: "unemployed", injury: injury({ grade: 14, treatmentCost: 800_000 }) }) });
    expect(cell("liability_bodily_1").status).toBe("needs_check");
    expect(cell("liability_bodily_1").amount).toBeNull();
  });

  it("자기신체사고 급별 한도표에 없는 가입금액은 '약관 확인 필요'", () => {
    const { cell } = run({
      own: { ...SELF_INJURY, selfInjury: { injuryLimit: 100_000_000, deathLimit: 100_000_000, disabilityLimit: 100_000_000 } },
      liable: { status: "no_counterparty", bodily2Limit: null },
      person: person({ injury: injury({ grade: 9, treatmentCost: 2_000_000 }) }),
    });
    expect(cell("self_injury").status).toBe("needs_check");
  });

  it("개인용이 아닌 보험 종류는 같은 값으로 계산하되 모두 '약관 확인 필요'", () => {
    const { cell } = run({ person: person({ occupationType: "unemployed", injury: injury({ grade: 14, treatmentCost: 800_000, outpatientDays: 10 }) }) }, personRules("motorcycle"));
    expect(cell("liability_bodily_1").amount?.expected).toBe(500_000);
    expect(cell("liability_bodily_1").needsCheckRuleIds).toContain("solatium.injury.grade14");
    expect(run({ person: person({ occupationType: "unemployed", injury: injury({ grade: 14, treatmentCost: 800_000 }) }) }, personRules("personal")).cell("liability_bodily_1").needsCheckRuleIds).toEqual([]);
  });

  it("상대방 쪽 사람은 내 보험의 대인배상 칸만 가진다", () => {
    const { result } = run({ side: "others", own: null, person: person({ occupationType: "unemployed", injury: injury({ grade: 14, treatmentCost: 800_000, outpatientDays: 10 }) }) });
    expect(result.recipientGroup).toBe("others");
    expect(result.cells.map((c) => c.coverage)).toEqual(["liability_bodily_1", "liability_bodily_2"]);
  });
});

describe("불변식", () => {
  const grades = [1, 5, 9, 12, 14];
  const faults = [0, 10, 33, 50, 70, 99, 100];
  const costs = [0, 300_000, 2_000_000, 40_000_000];
  const liables = [FULL, { status: "full" as const, bodily2Limit: 50_000_000 }, { status: "full" as const, bodily2Limit: null }, { status: "mandatory_only" as const, bodily2Limit: null }, { status: "unknown" as const, bodily2Limit: null }];
  const owns = [AUTO_INJURY, SELF_INJURY];

  it("모든 칸에서 최소 ≤ 예상 ≤ 최대이고, 계산되지 않은 칸은 금액이 null이다", () => {
    for (const grade of grades)
      for (const faultPercent of faults)
        for (const treatmentCost of costs)
          for (const liable of liables)
            for (const own of owns) {
              const { result } = run({
                liable,
                own,
                person: person({ faultPercent, monthlyIncome: 3_000_000, incomeProven: null, vehicleDriver: null, injury: injury({ grade, treatmentCost, futureTreatmentCost: 500_000, outpatientDays: 7, daysOffWork: 14 }) }),
              });
              for (const cell of result.cells) {
                if (cell.status !== "calculated") expect(cell.amount).toBeNull();
                else {
                  const amount = cell.amount as NonNullable<typeof cell.amount>;
                  expect(amount.min).toBeGreaterThanOrEqual(0);
                  expect(amount.min).toBeLessThanOrEqual(amount.expected);
                  expect(amount.expected).toBeLessThanOrEqual(amount.max);
                }
                expect(cell.inTotal).toBe(cell.status === "calculated");
              }
            }
  });

  it("대인배상Ⅱ와 자동차상해가 모두 무한이면 세 칸의 합이 손해액 합계와 같다(겹치지 않는다)", () => {
    for (const grade of grades)
      for (const faultPercent of faults.filter((f) => f < 100))
        for (const treatmentCost of costs) {
          const { result, expected } = run({
            own: { autoInjury: { injuryLimit: "unlimited", deathDisabilityLimit: "unlimited" }, selfInjury: null, uninsured: null },
            person: person({ faultPercent, monthlyIncome: 3_000_000, incomeProven: true, vehicleDriver: false, injury: injury({ grade, treatmentCost, outpatientDays: 7, daysOffWork: 14 }) }),
          });
          const loss = result.ledger.lines.reduce((sum, line) => sum + (line.amount?.expected ?? 0), 0);
          expect((expected("liability_bodily_1") ?? 0) + (expected("liability_bodily_2") ?? 0) + (expected("auto_injury") ?? 0)).toBe(loss);
        }
  });
});

describe("엔진 코드 규칙", () => {
  it("lib/engine 안에 금액 상수가 없고, 허용된 것만 import한다", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const files = (readdirSync("lib/engine", { recursive: true }) as string[]).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);
    for (const name of files) {
      const code = readFileSync(`lib/engine/${name}`, "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
        .join("\n");
      // 네 자리 이상의 숫자(금액)는 data/rules에만 둔다.
      expect(code.match(/\b\d[\d_]{3,}\b/g) ?? [], name).toEqual([]);
      for (const [, from] of code.matchAll(/from "([^"]+)"/g)) expect(/^(\.{1,2}\/|@\/lib\/schemas\/|@\/lib\/engine\/|decimal\.js$)/.test(from), `${name}: ${from}`).toBe(true);
      expect(/process\.env|Date\.now|new Date\(|fetch\(/.test(code), name).toBe(false);
    }
  });
});
