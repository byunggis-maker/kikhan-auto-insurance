import { describe, expect, it } from "vitest";
import { calculateAccident } from "@/lib/engine/accident";
import { summarize } from "@/lib/engine/summarize";
import type { CoverageKey, MatrixCell } from "@/lib/engine/types";
import { rulesFor } from "@/lib/rules/person-rules";
import { accidentClaimSchema, type AccidentClaim } from "@/lib/schemas/accident-claim";
import type { ProductLine } from "@/lib/schemas/rules";
import type { LegalClaim, OwnVehicleCoverage, PropertyLiable, VehicleClaim, VehicleDamage } from "@/lib/schemas/vehicle-claim";

// 차량 담보와 특약의 손 검산 사례. 금액은 data/rules의 값(현대해상 개인용 약관 2025-11-26)으로 계산했다.
// 차량과 금액은 모두 지어낸 가상 사례다.

function damage(change: Partial<VehicleDamage>): VehicleDamage {
  return {
    id: "v1",
    label: "가상 차량",
    ownerId: "p1",
    faultPercent: 0,
    repairCost: null,
    totalLoss: false,
    valueAtAccident: null,
    extendedRepairCap: false,
    firstRegisteredOn: null,
    commercialUse: false,
    rental: null,
    idle: null,
    towingCost: null,
    ...change,
  };
}

const INSURED: PropertyLiable = { status: "insured", propertyLimit: 100_000_000 };
const SINGLE: PropertyLiable = { status: "no_counterparty", propertyLimit: null };
const RATE_20 = { type: "rate" as const, ratePercent: 20, min: 200_000, max: 500_000 };
const OWN: OwnVehicleCoverage = { ownDamage: { limit: 25_000_000, deductible: RATE_20 }, rentalRider: { vehicleClass: "mid" } };

function run(vehicle: Partial<VehicleClaim> & { damage: VehicleDamage }, productLine: ProductLine = "personal", extra: Partial<AccidentClaim> = {}) {
  const claim = accidentClaimSchema.parse({ accidentDate: "2026-09-01", productLine, persons: [], vehicles: [{ side: "mine", liable: INSURED, own: OWN, ...vehicle }], legal: null, otherRiders: [], ...extra });
  const matrix = calculateAccident(claim, rulesFor(productLine));
  const cell = (key: CoverageKey) => matrix.cells.find((c) => c.coverage === key) as MatrixCell;
  const line = (key: CoverageKey, item: string) => cell(key).lines.find((l) => l.item === item);
  return { matrix, cell, line, summary: summarize(matrix) };
}

// 쌍방과실 기본 사례: 내 과실 30%, 수리비 500만원, 차량가액 2,000만원, 2025-03-01 출고, 렌트 10일(1일 10만원)
const twoSided = damage({ faultPercent: 30, repairCost: 5_000_000, valueAtAccident: 20_000_000, firstRegisteredOn: "2025-03-01", rental: { rented: true, days: 10, dailyRate: 100_000, longRepair: false } });

describe("대물배상", () => {
  it("쌍방과실: 수리비 + 대차료 + 시세하락손해를 과실상계한다", () => {
    // 수리비 5,000,000 (한도: 차량가액 20,000,000 × 120% = 24,000,000 이내)
    // 대차료 100,000 × 10일 = 1,000,000 (한도 25일 이내)
    // 시세하락손해: 출고 후 1년 초과 2년 이하, 수리비 5,000,000 > 차량가액의 20% 4,000,000 → 5,000,000 × 15% = 750,000
    // 손해액 6,750,000 × (100 − 30)% = 4,725,000 → 가입금액 1억원 이내
    const { cell, line } = run({ damage: twoSided });
    expect(line("liability_property", "repair")?.amount?.expected).toBe(5_000_000);
    expect(line("liability_property", "rental")?.amount?.expected).toBe(1_000_000);
    expect(line("liability_property", "depreciation")?.amount?.expected).toBe(750_000);
    expect(cell("liability_property").amount).toEqual({ min: 4_725_000, expected: 4_725_000, max: 4_725_000 });
    expect(cell("liability_property").needsCheckRuleIds).toEqual([]);
    expect(cell("liability_property").basis.some((text) => text.includes("별표 82쪽"))).toBe(true);
  });

  it("한도 초과: 가입금액까지만 지급한다", () => {
    const { cell } = run({ liable: { status: "insured", propertyLimit: 20_000_000 }, damage: damage({ repairCost: 30_000_000, valueAtAccident: 50_000_000, rental: { rented: null, days: 0, dailyRate: null, longRepair: null } }) });
    expect(cell("liability_property").amount?.expected).toBe(20_000_000);
  });

  it("수리비는 사고 직전 차량가액의 120%까지. 한도가 넓어지는 차량인지 모르면 최대는 130%", () => {
    // 차량가액 3,000,000 × 120% = 3,600,000 / × 130% = 3,900,000, 수리비 4,000,000
    const { cell } = run({ side: "others", own: null, liable: { status: "insured", propertyLimit: 20_000_000 }, damage: damage({ repairCost: 4_000_000, valueAtAccident: 3_000_000, extendedRepairCap: null }) });
    expect(cell("liability_property").amount).toEqual({ min: 3_600_000, expected: 3_600_000, max: 3_900_000 });
    // 대차료·시세하락손해는 입력이 없어 빠졌다. 0원으로 본 것이 아니다.
    expect(cell("liability_property").flags).toContain("partial");
    expect(cell("liability_property").missing.map((m) => m.field)).toEqual(expect.arrayContaining(["vehicle.rental", "vehicle.firstRegisteredOn"]));
    expect(cell("liability_property").group).toBe("others");
  });

  it("렌트하지 않으면 통상 요금의 35%, 인정기간은 25일(전손이면 10일)까지", () => {
    // 100,000 × 35% × 25일 = 875,000
    const notRented = run({ damage: damage({ repairCost: 3_000_000, rental: { rented: false, days: 40, dailyRate: 100_000, longRepair: false } }) });
    expect(notRented.line("liability_property", "rental")?.amount?.expected).toBe(875_000);
    // 정비작업시간이 긴 경우인지 모르면 최대는 30일: 100,000 × 30일 = 3,000,000
    const unknown = run({ damage: damage({ repairCost: 3_000_000, rental: { rented: true, days: 40, dailyRate: 100_000, longRepair: null } }) });
    expect(unknown.line("liability_property", "rental")?.amount).toEqual({ min: 2_500_000, expected: 2_500_000, max: 3_000_000 });
    // 전손: 교환가액 8,000,000 + 100,000 × 10일 = 9,000,000
    const total = run({ damage: damage({ totalLoss: true, valueAtAccident: 8_000_000, rental: { rented: true, days: 15, dailyRate: 100_000, longRepair: null } }) });
    expect(total.cell("liability_property").amount?.expected).toBe(9_000_000);
  });

  it("시세하락손해: 출고 후 5년이 지났거나 수리비가 차량가액의 20%를 넘지 않으면 대상이 아니다", () => {
    const old = run({ damage: damage({ repairCost: 5_000_000, valueAtAccident: 20_000_000, firstRegisteredOn: "2021-08-31" }) });
    expect(old.line("liability_property", "depreciation")?.amount).toBeNull();
    expect(old.line("liability_property", "depreciation")?.formula).toContain("5년이 지난");
    // 출고 후 정확히 5년째 날(2021-09-01 → 2026-09-01)은 "5년 이하": 5,000,000 × 10% = 500,000
    expect(run({ damage: damage({ repairCost: 5_000_000, valueAtAccident: 20_000_000, firstRegisteredOn: "2021-09-01" }) }).line("liability_property", "depreciation")?.amount?.expected).toBe(500_000);
    // 수리비 4,000,000 = 차량가액의 20% → "초과"가 아니다
    expect(run({ damage: damage({ repairCost: 4_000_000, valueAtAccident: 20_000_000, firstRegisteredOn: "2026-03-01" }) }).line("liability_property", "depreciation")?.amount).toBeNull();
    // 출고 후 1년 이하: 4,000,001 × 20% = 800,000.2 → 원 미만 버림(확인 필요 규칙)
    const young = run({ damage: damage({ repairCost: 4_000_001, valueAtAccident: 20_000_000, firstRegisteredOn: "2026-03-01" }) });
    expect(young.line("liability_property", "depreciation")?.amount?.expected).toBe(800_000);
    expect(young.cell("liability_property").needsCheckRuleIds).toContain("rounding.won");
  });

  it("사업용자동차는 대차료 대신 휴차료: 30일까지", () => {
    // 80,000 × 30일 = 2,400,000, 수리비 2,000,000 → 4,400,000
    const { cell, line } = run({ damage: damage({ commercialUse: true, repairCost: 2_000_000, idle: { days: 40, dailyAmount: 80_000 }, rental: { rented: true, days: 40, dailyRate: 100_000, longRepair: false } }) });
    expect(line("liability_property", "idle")?.amount?.expected).toBe(2_400_000);
    expect(line("liability_property", "rental")?.amount).toBeNull();
    expect(cell("liability_property").amount?.expected).toBe(4_400_000);
  });

  it("정보 부족: 수리비가 없으면 0원이 아니라 '입력하면 계산됩니다'", () => {
    const { cell } = run({ damage: damage({}) });
    expect(cell("liability_property").status).toBe("insufficient_info");
    expect(cell("liability_property").amount).toBeNull();
    expect(cell("liability_property").reason).toContain("수리비를 입력하면 계산됩니다");
  });

  it("상대방 대물배상 가입금액을 모르면 '상대방 계약 확인 필요'이고, 내 증권의 한도를 대신 쓰지 않는다", () => {
    const { cell } = run({ liable: { status: "insured", propertyLimit: null }, damage: twoSided });
    expect(cell("liability_property").status).toBe("insufficient_info");
    expect(cell("liability_property").reason).toContain("상대방 계약 확인 필요");
    // 자기차량손해: 최소는 상대방이 과실분(수리비 3,500,000)을 처리하는 경우 1,200,000, 예상·최대는 처리분 없이 5,000,000 − 500,000 = 4,500,000
    expect(cell("own_damage").amount).toEqual({ min: 1_200_000, expected: 4_500_000, max: 4_500_000 });
    expect(cell("own_damage").flags).toContain("deduction_unknown");
  });

  it("사고일에 맞는 규칙이 없으면 '약관 확인 필요'", () => {
    const claim = accidentClaimSchema.parse({ accidentDate: "2025-01-01", productLine: "personal", persons: [], vehicles: [{ side: "mine", liable: INSURED, own: null, damage: damage({ repairCost: 1_000_000, valueAtAccident: 5_000_000 }) }], legal: null, otherRiders: [] });
    const cell = calculateAccident(claim, rulesFor("personal")).cells[0];
    expect(cell.status).toBe("needs_check");
    expect(cell.amount).toBeNull();
  });
});

describe("자기차량손해", () => {
  it("회귀 사례: 수리비 5,000,000원, 자기부담금 500,000원 → 4,500,000원", () => {
    const { cell } = run({ liable: SINGLE, own: { ownDamage: { limit: 25_000_000, deductible: { type: "fixed", amount: 500_000 } }, rentalRider: null }, damage: damage({ faultPercent: 100, repairCost: 5_000_000 }) });
    expect(cell("own_damage").amount).toEqual({ min: 4_500_000, expected: 4_500_000, max: 4_500_000 });
    expect(cell("liability_property").status).toBe("not_applicable");
    expect(cell("rider_rental").status).toBe("not_applicable");
  });

  it("약관의 예시: 수리비 200만원·20%(20만~50만원) → 자기부담금 40만원 / 수리비 400만원·30%(30만~100만원) → 100만원", () => {
    const first = run({ liable: SINGLE, damage: damage({ repairCost: 2_000_000 }) });
    expect(first.line("own_damage", "own_damage_deductible")?.amount?.expected).toBe(400_000);
    expect(first.cell("own_damage").amount?.expected).toBe(1_600_000);
    const second = run({ liable: SINGLE, own: { ownDamage: { limit: 25_000_000, deductible: { type: "rate", ratePercent: 30, min: 300_000, max: 1_000_000 } }, rentalRider: null }, damage: damage({ repairCost: 4_000_000 }) });
    expect(second.line("own_damage", "own_damage_deductible")?.amount?.expected).toBe(1_000_000);
    expect(second.cell("own_damage").amount?.expected).toBe(3_000_000);
    expect(second.cell("own_damage").flags).toEqual([]);
  });

  it("쌍방과실: 상대 보험 처리분을 빼고, 남은 내 과실분에 자기부담금 비율을 적용한다", () => {
    // 수리비 5,000,000 − 상대방 대물배상 수리비 처리분 3,500,000 = 1,500,000 (= 수리비 × 내 과실 30%)
    // 자기부담금 1,500,000 × 20% = 300,000 (최소 200,000·최대 500,000 사이) → 지급 1,200,000
    const { cell, line } = run({ damage: twoSided });
    expect(line("own_damage", "own_damage_net")?.amount?.expected).toBe(1_500_000);
    expect(line("own_damage", "own_damage_deductible")?.amount?.expected).toBe(300_000);
    expect(cell("own_damage").amount).toEqual({ min: 1_200_000, expected: 1_200_000, max: 1_200_000 });
  });

  it("내 과실분이 작으면 최소 자기부담금을 적용한다", () => {
    // 내 과실 10%: 5,000,000 − 4,500,000 = 500,000, 20% = 100,000 → 최소 200,000 → 지급 300,000
    const { cell } = run({ damage: { ...twoSided, faultPercent: 10 } });
    expect(cell("own_damage").amount?.expected).toBe(300_000);
  });

  it("전손이거나 손해액이 가입금액 전액 이상이면 자기부담금을 빼지 않는다", () => {
    const total = run({ liable: SINGLE, own: { ownDamage: { limit: 10_000_000, deductible: RATE_20 }, rentalRider: null }, damage: damage({ totalLoss: true, valueAtAccident: 8_000_000 }) });
    expect(total.cell("own_damage").amount?.expected).toBe(8_000_000);
    // 수리비 12,000,000이 가입금액 10,000,000을 넘음 → 10,000,000 전액
    const over = run({ liable: SINGLE, own: { ownDamage: { limit: 10_000_000, deductible: RATE_20 }, rentalRider: null }, damage: damage({ repairCost: 12_000_000 }) });
    expect(over.cell("own_damage").amount?.expected).toBe(10_000_000);
  });

  it("정보 부족: 증권의 자기부담금 조건이 없으면 계산하지 않는다", () => {
    const { cell } = run({ liable: SINGLE, own: { ownDamage: { limit: 25_000_000, deductible: null }, rentalRider: null }, damage: damage({ repairCost: 2_000_000 }) });
    expect(cell("own_damage").status).toBe("insufficient_info");
    expect(cell("own_damage").missing.map((m) => m.field)).toContain("own.ownDamage.deductible");
  });

  it("약관의 안내표에 없는 자기부담금 조합은 계산하되 표시를 붙인다", () => {
    const { cell } = run({ liable: SINGLE, own: { ownDamage: { limit: 25_000_000, deductible: { type: "rate", ratePercent: 25, min: 100_000, max: 700_000 } }, rentalRider: null }, damage: damage({ repairCost: 2_000_000 }) });
    expect(cell("own_damage").amount?.expected).toBe(1_500_000);
    expect(cell("own_damage").flags).toContain("deductible_not_in_table");
  });
});

describe("특약", () => {
  it("렌트비용지원: 차종별 1일 한도 안에서, 상대방 대물배상의 대차료 처리분을 뺀다", () => {
    // 1일 100,000(중형 한도 110,000 이내) × 10일 = 1,000,000 − 상대방 대차료 처리분 700,000 = 300,000
    const { cell, summary } = run({ damage: twoSided });
    expect(cell("rider_rental").amount).toEqual({ min: 300_000, expected: 300_000, max: 300_000 });
    // 내가 받을 합계: 대물배상 4,725,000 + 자기차량손해 1,200,000 + 렌트비용 300,000 = 6,225,000
    expect(summary.groups[0].total.expected).toBe(6_225_000);
  });

  it("렌트비용지원: 렌트하지 않으면 요금과 한도의 35%, 전손이면 10일", () => {
    // 요금 100,000 × 35% = 35,000, (초)소형 한도 70,000 × 35% = 24,500 → 24,500 × 10일 = 245,000
    const { cell } = run({
      liable: SINGLE,
      own: { ownDamage: { limit: 10_000_000, deductible: RATE_20 }, rentalRider: { vehicleClass: "small" } },
      damage: damage({ totalLoss: true, valueAtAccident: 8_000_000, rental: { rented: false, days: 15, dailyRate: 100_000, longRepair: null } }),
    });
    expect(cell("rider_rental").amount?.expected).toBe(245_000);
  });

  const legal = (change: Partial<LegalClaim>): LegalClaim => ({ insuredId: "p1", insuredLabel: "가상 운전자", plan: "basic", lawyerIncluded: true, fineIncluded: true, settlements: [], lawyerEligible: null, lawyerFee: null, fine: null, schoolZone: null, ...change });
  const withLegal = (claim: LegalClaim, productLine: ProductLine = "personal") => {
    const matrix = calculateAccident(accidentClaimSchema.parse({ accidentDate: "2026-09-01", productLine, persons: [], vehicles: [], legal: claim, otherRiders: [] }), rulesFor(productLine));
    return matrix.cells[0];
  };

  it("법률비용 지원: 형사합의금·변호사선임비용·벌금을 항목별 한도까지", () => {
    // 기본형: 사망 합의금 40,000,000 → 한도 30,000,000 / 4급 합의금 3,000,000 → 한도 5,000,000 이내 / 9급 → 기본형은 보상하지 않음(0)
    // 변호사선임비용 7,000,000 → 한도 5,000,000 / 벌금 25,000,000 → 한도 20,000,000(어린이 보호구역이면 30,000,000)
    const cell = withLegal(
      legal({
        settlements: [
          { id: "a", label: "피해자 가", kind: "death", victimGrade: null, amount: 40_000_000 },
          { id: "b", label: "피해자 나", kind: "gross_negligence_injury", victimGrade: 4, amount: 3_000_000 },
          { id: "c", label: "피해자 다", kind: "gross_negligence_injury", victimGrade: 9, amount: 2_000_000 },
        ],
        lawyerEligible: true,
        lawyerFee: 7_000_000,
        fine: 25_000_000,
      }),
    );
    expect(cell.lines.map((l) => l.amount?.expected)).toEqual([30_000_000, 3_000_000, 0, 5_000_000, 20_000_000]);
    expect(cell.amount).toEqual({ min: 58_000_000, expected: 58_000_000, max: 63_000_000 });
    expect(cell.basis.some((text) => text.includes("133쪽"))).toBe(true);
  });

  it("법률비용 지원: 가입 유형을 모르거나 금액이 없으면 정보 부족, 제외한 항목은 계산하지 않는다", () => {
    const unknownPlan = withLegal(legal({ plan: null, settlements: [{ id: "a", label: "피해자 가", kind: "death", victimGrade: null, amount: 10_000_000 }] }));
    expect(unknownPlan.status).toBe("insufficient_info");
    expect(unknownPlan.amount).toBeNull();
    expect(withLegal(legal({})).status).toBe("insufficient_info");
    const excluded = withLegal(legal({ fineIncluded: false, fine: 5_000_000, lawyerEligible: true, lawyerFee: 1_000_000 }));
    expect(excluded.amount?.expected).toBe(1_000_000);
    // 중상해로 송치·공소제기된 사고는 가입 유형과 관계없이 3천만원 한도
    expect(withLegal(legal({ plan: null, settlements: [{ id: "a", label: "피해자 가", kind: "serious_injury", victimGrade: null, amount: 35_000_000 }] })).amount?.expected).toBe(30_000_000);
  });

  it("법률비용 지원: 가입 유형과 한도는 보험 종류의 약관을 따른다", () => {
    const death = [{ id: "a", label: "피해자 가", kind: "gross_negligence_injury" as const, victimGrade: 1, amount: 40_000_000 }];
    // 이륜차 약관은 가입 유형을 나누지 않는다(1급 2,000만원). 어린이 보호구역 사고여도 벌금 한도는 2,000만원이다.
    const motorcycle = withLegal(legal({ plan: null, settlements: death, fine: 25_000_000, schoolZone: true }), "motorcycle");
    expect(motorcycle.lines.map((l) => l.amount?.expected ?? null)).toEqual([20_000_000, null, 20_000_000]);
    expect(motorcycle.status).toBe("calculated");
    // 영업용 약관에는 최고급형이 없다.
    const commercial = withLegal(legal({ plan: "top", settlements: death }), "commercial");
    expect(commercial.status).toBe("needs_check");
    expect(commercial.amount).toBeNull();
    // 영업용의 고보장형(premium): 1급 3,000만원
    expect(withLegal(legal({ plan: "premium", settlements: death }), "commercial").amount?.expected).toBe(30_000_000);
  });

  it("그 밖의 특약은 금액 없이 '증권에 있으나 계산 규칙 미등록'으로 표시하고 합계에 넣지 않는다", () => {
    const { matrix, summary } = run({ liable: SINGLE, damage: damage({ faultPercent: 100, repairCost: 2_000_000 }) }, "personal", { otherRiders: [{ name: "긴급출동서비스 특약", insuredId: "p1", insuredLabel: "가상 운전자" }] });
    const cell = matrix.cells.find((c) => c.coverage === "rider_other") as MatrixCell;
    expect(cell).toMatchObject({ status: "needs_check", amount: null, inTotal: false, columnId: "rider_other:긴급출동서비스 특약" });
    expect(cell.reason).toBe("증권에 있으나 계산 규칙 미등록: 긴급출동서비스 특약");
    expect(matrix.columns.at(-1)).toMatchObject({ label: "긴급출동서비스 특약", coverage: "rider_other" });
    // 합계는 자기차량손해 1,600,000뿐이다.
    expect(summary.groups[0].total.expected).toBe(1_600_000);
  });
});

describe("보험 종류", () => {
  const person = {
    side: "mine" as const,
    liable: { status: "no_counterparty" as const, bodily2Limit: null },
    own: { autoInjury: { injuryLimit: 30_000_000, deathDisabilityLimit: 200_000_000 }, selfInjury: null, uninsured: null },
    person: {
      id: "p1",
      label: "가상 운전자",
      birthDate: "1986-09-01",
      faultPercent: 100,
      occupationType: "unemployed" as const,
      monthlyIncome: null,
      incomeProven: null,
      vehicleDriver: false,
      injury: { grade: 14, treatmentCost: 800_000, futureTreatmentCost: 0, hospitalDays: 0, outpatientDays: 0, daysOffWork: 0, dailyIncomeLoss: null, mealsNotProvided: 0, nursingProven: false },
      death: null,
      disability: null,
      receivedFromThirdParty: 0,
      receivedFromLiableParty: 0,
    },
  };

  it("이륜자동차보험: 약관에 없는 자동차상해는 '해당 없음', 렌트비용지원 특약은 '계산 규칙 미등록'", () => {
    const { cell } = run({ liable: SINGLE, damage: damage({ faultPercent: 100, repairCost: 2_000_000, rental: { rented: true, days: 3, dailyRate: 50_000, longRepair: false } }) }, "motorcycle", { persons: [person] });
    expect(cell("auto_injury").status).toBe("not_applicable");
    expect(cell("auto_injury").reason).toBe("이 보험 종류의 약관에 없는 담보입니다");
    expect(cell("rider_rental")).toMatchObject({ status: "needs_check", amount: null, inTotal: false });
    expect(cell("rider_rental").flags).toContain("rule_not_registered");
    // 자기차량손해는 같은 엔진으로 계산하되, 개인용 약관의 값이라 '약관 확인 필요'가 붙는다.
    expect(cell("own_damage").amount?.expected).toBe(1_600_000);
    expect(cell("own_damage").needsCheckRuleIds).toContain("ownDamage.deductible.waivedOnTotalLoss");
  });

  it("업무용·영업용: 같은 엔진으로 계산하고 값은 '약관 확인 필요'. 영업용에는 렌트비용지원 특약이 없다", () => {
    const business = run({ damage: twoSided }, "business");
    expect(business.cell("liability_property").amount?.expected).toBe(4_725_000);
    expect(business.cell("liability_property").needsCheckRuleIds).toContain("property.repair.capPercent");
    expect(business.cell("rider_rental").amount?.expected).toBe(300_000);
    const commercial = run({ damage: twoSided }, "commercial", { persons: [person] });
    expect(commercial.cell("rider_rental").flags).toContain("rule_not_registered");
    expect(commercial.cell("auto_injury").status).toBe("calculated");
  });

  it("보험 종류 네 가지의 규칙 묶음에 담보 구성이 있다", () => {
    for (const line of ["personal", "business", "commercial", "motorcycle"] as const) {
      const items = rulesFor(line).filter((item) => item.id === "product.coverages" || item.id === "product.riders");
      expect(items.map((item) => item.id).sort(), line).toEqual(["product.coverages", "product.riders"]);
      expect(items.every((item) => item.productLines.includes(line))).toBe(true);
    }
  });
});
