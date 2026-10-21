import { OWN_DAMAGE_TERMS } from "@/lib/claim/standards";
import type { Deductible, Limit } from "@/lib/claim/types";
import { ownDamage } from "./legacy/coverages/own-damage";
import { liabilityBodily1 } from "./legacy/coverages/liability-bodily-1";
import { afterFault, excessOverCompulsory, type Claim as LegacyClaim } from "./legacy/fault";
import { lossByCategory, medicalCost, guaranteedCost, total } from "./legacy/loss-ledger";
import { won } from "./legacy/range";
import { scale, type Rules } from "./legacy/rules";
import type { VehicleDamage } from "./legacy/schemas/vehicle-claim";
import { CATEGORIES, type ByCategory, type Computation, type Scenario } from "./legacy/types";

// MASTER.md 6장 (4) 지급액 조정: 과실상계 → 치료관계비 하한 → 경상 구상 → 담보 한도 → 자기부담금.
// 대인 담보는 legacy(compass 이식) 함수를 그대로 부른다. 여기서는 그 결과(Computation)를 금액 하나와 계산식으로 바꾼다.
// 이식 코드는 최소·예상·최대 세 경우를 내지만, v6 입력은 금액이 하나이므로 "예상"을 쓴다(운전자 여부를 모를 때만 세 값이 갈린다).

export type Paid = { ok: true; amount: number; byCategory: ByCategory; formula: string; ruleIds: string[]; flags: string[] } | { ok: false; reason: string; missing: boolean };

const ZERO: ByCategory = { injury: 0, disability: 0, death: 0 };

export function fromComputation(computation: Computation): Paid {
  if (!computation.ok) return { ok: false, reason: computation.status === "insufficient_info" ? computation.missing.map((m) => m.message).join(" / ") : computation.reason, missing: computation.status === "insufficient_info" };
  const flags = [...computation.flags];
  if (computation.total.min !== computation.total.max) flags.push(`범위 ${won(computation.total.min)} ~ ${won(computation.total.max)}`);
  return {
    ok: true,
    amount: computation.total.expected,
    byCategory: { injury: computation.byCategory.injury.expected, disability: computation.byCategory.disability.expected, death: computation.byCategory.death.expected },
    formula: computation.steps.filter((step) => step.kind === "step").map((step) => step.formula).join(" → "),
    ruleIds: computation.ruleIds,
    flags,
  };
}

/** 대인배상Ⅰ(또는 정부보장사업의 대인Ⅰ 상당액). legacy liabilityBodily1 */
export function compulsoryBodily(claim: LegacyClaim): { paid: Paid; at: (scenario: Scenario) => ByCategory; raw: Computation } {
  const raw = liabilityBodily1(claim);
  const at = (scenario: Scenario): ByCategory => (raw.ok ? { injury: raw.byCategory.injury[scenario], disability: raw.byCategory.disability[scenario], death: raw.byCategory.death[scenario] } : ZERO);
  return { paid: fromComputation(raw), at, raw };
}

/** 대인배상Ⅱ·무보험자동차상해: legacy excessOverCompulsory(대인Ⅰ 지급 가능액·기수령액을 먼저 빼고 가입금액 한도) */
export function excess(claim: LegacyClaim, bodily1: (scenario: Scenario) => ByCategory, limit: Limit, alreadyReceived: number, limitLabel: string): { paid: Paid; raw: Computation } {
  const raw = excessOverCompulsory(claim, bodily1, limit, alreadyReceived, limitLabel);
  return { paid: fromComputation(raw), raw };
}

/**
 * 경상(12~14급) 차량운전자 본인 부담분(별표4 1.가.(3) 단서). legacy excessOverCompulsory 안의 식과 같은 값을
 * 따로 계산해 "자동차상해·자기신체사고에서 처리" 줄로 보여 준다(결정 기록 D-4). 해당이 없으면 0.
 */
export function minorInjuryShare(claim: LegacyClaim, bodily1Limit: number | null): number {
  const { person, ledger, rules } = claim;
  const grade = person.injury?.grade ?? null;
  const fault = person.faultPercent;
  if (grade === null || grade < 12 || person.vehicleDriver !== true || fault === null || bodily1Limit === null) return 0;
  const used: string[] = [];
  const offset = afterFault(rules, used, total(lossByCategory(ledger, "expected")), fault);
  const medical = medicalCost(ledger, "expected");
  const guaranteed = guaranteedCost(ledger, "expected");
  if (offset === null || offset >= guaranteed || medical <= bodily1Limit) return 0;
  const share = scale(rules, used, medical - bodily1Limit, [[fault, 100]]) ?? 0;
  // 실제로 덜 받는 금액: 하한(치료관계비·간병비) − max(과실상계 후, 하한 − 본인 부담). 과실상계 후 금액이 더 크면 그만큼 줄어든다.
  return Math.min(share, guaranteed - offset);
}

/** 앞 순위 지급액을 부상 → 후유장애 → 사망 순서로 구분에 나눠 넣는다(legacy fault.ts 88–98행과 같은 순서) */
export function allocate(loss: ByCategory, amount: number): ByCategory {
  const out: ByCategory = { ...ZERO };
  let left = amount;
  for (const category of CATEGORIES) {
    const room = Math.min(left, loss[category]);
    out[category] = room;
    left -= room;
  }
  out.injury += left;
  return out;
}

const limitText = (limit: Limit) => (limit === "unlimited" ? "무한" : won(limit));
const capAt = (amount: number, limit: Limit) => (limit === "unlimited" ? amount : Math.min(amount, limit));

/**
 * 자동차상해: 실제손해액(과실상계 전) − 공제액, 구분별 가입금액 한도(자동차상해 특별약관 2.(2)).
 * 부상은 부상 가입금액, 후유장애·사망은 사망·후유장애 가입금액. 공제액은 legacy makeDeduction이 낸 금액에 v6가 더한 앞 순위 지급액을 합친 것.
 */
export function autoInjury(claim: LegacyClaim, deduction: ByCategory, injuryLimit: Limit, deathDisabilityLimit: Limit): Paid {
  const loss = lossByCategory(claim.ledger, "expected");
  const injury = capAt(Math.max(0, loss.injury - deduction.injury), injuryLimit);
  const rest = capAt(Math.max(0, loss.disability + loss.death - deduction.disability - deduction.death), deathDisabilityLimit);
  const lossTotal = total(loss);
  const deductionTotal = total(deduction);
  return {
    ok: true,
    amount: injury + rest,
    byCategory: { injury, disability: rest, death: 0 },
    formula: `실제손해액 ${won(lossTotal)}(과실상계 없음) − 공제액 ${won(deductionTotal)} = ${won(Math.max(0, lossTotal - deductionTotal))} → 부상 가입금액 ${limitText(injuryLimit)}·사망/후유장애 가입금액 ${limitText(deathDisabilityLimit)} 이내 ${won(injury + rest)}`,
    ruleIds: [],
    flags: [],
  };
}

/** 대물배상: 손해액 × (100 − 피해자 측 과실)% → 가입금액 한도. 과실상계는 legacy afterFault */
export function propertyLiability(rules: Rules, loss: number, victimFault: number, limit: number): Paid & { offset?: number } {
  const used: string[] = [];
  const offset = afterFault(rules, used, loss, victimFault);
  if (offset === null) return { ok: false, reason: "원 미만 처리 방식을 확인하지 못했습니다", missing: false };
  const amount = Math.min(offset, limit);
  return {
    ok: true,
    amount,
    byCategory: ZERO,
    offset,
    formula: `손해액 ${won(loss)} × (100 − ${victimFault})% = ${won(offset)} → 가입금액 ${won(limit)} 이내 ${won(amount)}`,
    ruleIds: used,
    flags: [],
  };
}

/** 자기차량손해: legacy ownDamage(상대 대물 처리분 공제 후 자기부담금) */
export function ownDamagePay(rules: Rules, vehicle: VehicleDamage, loss: number, limit: number, deductible: Deductible, recovered: number): Paid {
  const used: string[] = [];
  const result = ownDamage(vehicle, loss, { limit, deductible, waivedOnTotalLoss: OWN_DAMAGE_TERMS.waivedOnTotalLoss, onNetOfRecovery: OWN_DAMAGE_TERMS.onNetOfRecovery }, recovered, rules, used);
  if (result === null) return { ok: false, reason: "원 미만 처리 방식을 확인하지 못했습니다", missing: false };
  return { ok: true, amount: result.value, byCategory: ZERO, formula: result.steps.map((step) => step.formula).join(" → "), ruleIds: used, flags: [] };
}

export { won };
