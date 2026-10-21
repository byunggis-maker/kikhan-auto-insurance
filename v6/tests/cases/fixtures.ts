import { lossItemDef } from "@/lib/claim/lossItems";
import { claimSchema, emptyClaim, type Accident, type Claim, type Coverage, type LossItem, type Policy, type PolicyCoverage, type Property, type Victim } from "@/lib/claim/types";

// 라운드 2 사례 입력을 만드는 도구. 사람·금액은 모두 지어낸 가상 사례다.

export function item(code: string, value: { c?: number; e?: number }): LossItem {
  const def = lossItemDef(code);
  if (!def) throw new Error(`없는 항목 코드: ${code}`);
  return {
    code,
    confirmed: value.c ?? null,
    evidence: value.c !== undefined ? "가상 서류" : null,
    estimated: value.e ?? null,
    source: { confirmed: value.c !== undefined ? "document" : null, estimated: value.e !== undefined ? "user_estimate" : null },
    requiredDocs: [...def.requiredDocs],
  };
}

export function victim(change: Partial<Victim> & Pick<Victim, "id" | "role">): Victim {
  return { label: change.id, relationToNamedInsured: null, vehicleDriver: null, age: 40, injuryGrade: null, disabilityGrade: null, died: false, rideAlongReductionPercent: 0, hospitalDays: null, outpatientDays: null, mealsNotProvided: null, daysOffWork: null, monthlyIncome: null, incomeProven: null, losses: [], userTotal: null, ...change };
}

export function property(change: Partial<Property> & Pick<Property, "id" | "role">): Property {
  return { label: change.id, valueAtAccident: null, firstRegisteredOn: null, commercialUse: false, losses: [], userTotal: null, ...change };
}

function coverage(key: Coverage, change: Partial<PolicyCoverage> = {}): PolicyCoverage {
  return { coverage: key, limit: null, injuryLimit: null, deathLimit: null, disabilityLimit: null, ...change };
}

/** 내 보험 기본: 개인용, 대인Ⅰ·대인Ⅱ 무한·대물 1억·자동차상해(부상 3천만·사망/후유장애 2억)·무보험차상해 2억·자기차량손해 2,500만(20%, 20만~50만) */
export function myPolicy(change: { without?: Coverage[]; set?: Partial<Record<Coverage, Partial<PolicyCoverage>>>; add?: PolicyCoverage[] } = {}): Policy {
  const all: PolicyCoverage[] = [
    coverage("liability_bodily_1"),
    coverage("liability_bodily_2", { limit: "unlimited" }),
    coverage("liability_property", { limit: 100_000_000 }),
    coverage("auto_injury", { injuryLimit: 30_000_000, deathLimit: 200_000_000 }),
    coverage("uninsured", { limit: 200_000_000 }),
    coverage("own_damage", { limit: 25_000_000 }),
  ];
  return {
    side: "mine",
    productLine: "personal",
    insurer: "가상 보험사",
    status: "full",
    coverages: [...all.filter((c) => !change.without?.includes(c.coverage)).map((c) => ({ ...c, ...change.set?.[c.coverage] })), ...(change.add ?? [])],
    driverScope: "family",
    deductible: { type: "rate", ratePercent: 20, min: 200_000, max: 500_000 },
    hasBodily2: true,
  };
}

/** 자기신체사고 가입(자동차상해 대신): 부상·사망·후유장애 가입금액 3천만원 */
export function selfInjuryPolicy(): Policy {
  return myPolicy({ without: ["auto_injury"], add: [coverage("self_injury", { injuryLimit: 30_000_000, deathLimit: 30_000_000, disabilityLimit: 30_000_000 })] });
}

/** 상대 보험: 종합보험(대인Ⅱ 무한·대물 1억) 또는 지정한 상태 */
export function counterpartyPolicy(status: Policy["status"] = "full"): Policy {
  const coverages = status === "full" ? [coverage("liability_bodily_1"), coverage("liability_bodily_2", { limit: "unlimited" }), coverage("liability_property", { limit: 100_000_000 })] : status === "mandatory_only" ? [coverage("liability_bodily_1"), coverage("liability_property", { limit: 20_000_000 })] : [];
  return { side: "counterparty", productLine: "personal", insurer: "상대 보험사", status, coverages, driverScope: null, deductible: null, hasBodily2: status === "full" };
}

export function claim(change: { accident?: Partial<Accident>; violations?: Partial<Accident["violations"]>; myPolicy?: Policy; counterpartyPolicy?: Policy | null; victims?: Victim[]; properties?: Property[]; myFault: number }): Claim {
  const base = emptyClaim();
  return claimSchema.parse({
    ...base,
    accident: { ...base.accident, occurredAt: "2026-09-01", type: "car_car", ...change.accident, violations: { ...base.accident.violations, ...change.violations } },
    myPolicy: change.myPolicy ?? myPolicy(),
    counterpartyPolicy: change.counterpartyPolicy === undefined ? counterpartyPolicy() : change.counterpartyPolicy,
    victims: change.victims ?? [],
    properties: change.properties ?? [],
    fault: { mode: "known", myPercent: change.myFault },
  });
}
