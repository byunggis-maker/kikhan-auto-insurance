import { expect } from "vitest";
import faultFile from "@/lib/engine/legacy/data/fault.json";
import type { Claim } from "@/lib/engine/legacy/fault";
import { same } from "@/lib/engine/legacy/range";
import { openRules } from "@/lib/engine/legacy/rules";
import type { PersonClaim } from "@/lib/engine/legacy/schemas/person-claim";
import { ruleFileSchema, ruleItemSchema, type RuleItem } from "@/lib/engine/legacy/schemas/rules";
import type { ByCategory, Computation, LossCategory, LossLine, Scenario } from "@/lib/engine/legacy/types";
import bodilyLimits from "./fixtures/bodily-limits.json";

// 이식 로직 시험용 도구. compass 테스트는 V2 손해 산정(buildLedger)을 거쳐 장부를 만들지만,
// v6는 그 부분을 이식하지 않으므로 같은 사례의 손해 장부를 금액으로 직접 만든다.

export const ACCIDENT_DATE = "2026-09-01";

export const FAULT_ITEMS: RuleItem[] = ruleFileSchema.parse(faultFile).items;
export const RULE_ITEMS: RuleItem[] = [...FAULT_ITEMS, ...bodilyLimits.items.map((item) => ruleItemSchema.parse(item))];

/** 손해 장부의 계산된 한 줄 */
export function line(item: string, category: LossCategory, amount: number, kind: { medical?: boolean; guaranteed?: boolean } = {}): LossLine {
  const medical = kind.medical ?? false;
  return { item, category, label: item, status: "calculated", amount: same(amount), formula: "", ruleIds: [], missing: [], flags: [], required: false, medical, guaranteed: kind.guaranteed ?? medical };
}

export function person(change: Partial<PersonClaim>): PersonClaim {
  return {
    id: "p1",
    label: "가상 인물",
    age: 40,
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

/** 부상 사례: 급수와 과실, 치료관계비와 그 밖의 손해액 */
export function injuryClaim(options: { grade: number; faultPercent: number | null; medical: number; other: number; vehicleDriver?: boolean | null; thirdParty?: number }): Claim {
  const injury = { grade: options.grade, treatmentCost: options.medical, futureTreatmentCost: 0, hospitalDays: 0, outpatientDays: 0, daysOffWork: 0, dailyIncomeLoss: null, mealsNotProvided: 0, nursingProven: false };
  return {
    person: person({ faultPercent: options.faultPercent, vehicleDriver: options.vehicleDriver === undefined ? true : options.vehicleDriver, injury, receivedFromThirdParty: options.thirdParty ?? 0 }),
    accidentDate: ACCIDENT_DATE,
    ledger: { lines: [line("treatment", "injury", options.medical, { medical: true }), line("other_injury", "injury", options.other)] },
    rules: openRules(RULE_ITEMS, ACCIDENT_DATE),
  };
}

const ZERO: ByCategory = { injury: 0, disability: 0, death: 0 };

/** 원본 coordinate.ts의 bodily1At과 같은 일: 계산 결과의 한 경우를 구분별 금액으로 */
export function at(computation: Computation | null) {
  return (scenario: Scenario): ByCategory =>
    computation?.ok ? { injury: computation.byCategory.injury[scenario], disability: computation.byCategory.disability[scenario], death: computation.byCategory.death[scenario] } : ZERO;
}

export function expectOk(computation: Computation): Extract<Computation, { ok: true }> {
  expect(computation.ok, computation.ok ? "" : computation.reason).toBe(true);
  return computation as Extract<Computation, { ok: true }>;
}
