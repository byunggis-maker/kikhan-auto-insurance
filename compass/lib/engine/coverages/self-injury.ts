import type { Claim } from "../fault";
import { blockers, hasCategory, lossByCategory, total } from "../loss-ledger";
import { won } from "../range";
import { CATEGORY_LABELS, combine, type Step } from "../steps";
import { CATEGORIES, type ByCategory, type Computation, type LossCategory, type MissingInfo, type Scenario } from "../types";
import type { Deduction } from "./auto-injury";

// 자기신체사고: 정액 한도형.
// - 부상: 상해급별 보험가입금액표의 금액이 한도. 후유장애: 장애급별 보험금액이 한도. 사망: 사망 가입금액이 한도.
// - 공제액(대인배상Ⅰ·Ⅱ, 무보험자동차상해, 제3자에게서 받은 금액)이 없으면
//   부상은 실제 지출한 치료비, 후유장애는 장애급별 보험금액, 사망은 사망 가입금액을 지급한다.
// - 공제액이 있으면 실제손해액(지급기준 산출액, 과실상계 전)에서 공제액을 뺀 금액을 위 한도까지 지급한다.
// 입력: 손해 장부, 상해급수·후유장애 급수, 가입금액 세 가지, 공제액. 출력: 구분별 지급액.

export type SelfInjuryLimits = { injuryLimit: number | null; deathLimit: number | null; disabilityLimit: number | null };

/** mayHaveDeduction: 공제액이 생길 수 있는 사고인지(배상의무자나 제3자가 있는지). 없으면 손해액 계산 없이 정해진 금액을 지급한다 */
export function selfInjury(claim: Claim, limits: SelfInjuryLimits, deductionFor: (scenario: Scenario) => Deduction, mayHaveDeduction: boolean): Computation {
  const { person, ledger, rules } = claim;
  const present = CATEGORIES.filter((category) => hasCategory(ledger, category));
  const used: string[] = [];
  const need: MissingInfo[] = [];
  const caps: Partial<Record<LossCategory, number | null>> = {};
  const capIds: Partial<Record<LossCategory, string>> = {};

  if (present.includes("injury")) {
    if (person.injury?.grade == null) need.push({ field: "injury.grade", message: "상해급수를 고르면 계산됩니다" });
    if (person.injury?.treatmentCost == null) need.push({ field: "injury.treatmentCost", message: "치료비를 입력하면 계산됩니다" });
    if (limits.injuryLimit === null) need.push({ field: "own.selfInjury.injuryLimit", message: "자기신체사고 부상 가입금액을 입력하면 계산됩니다" });
    else if (person.injury?.grade != null) {
      capIds.injury = `selfInjury.injury.limit.${limits.injuryLimit}.grade${person.injury.grade}`;
      caps.injury = rules.number(capIds.injury, used);
    }
  }
  if (present.includes("disability")) {
    if (person.disability?.grade == null) need.push({ field: "disability.grade", message: "후유장애 급수를 입력하면 계산됩니다" });
    if (limits.disabilityLimit === null) need.push({ field: "own.selfInjury.disabilityLimit", message: "자기신체사고 후유장애 가입금액을 입력하면 계산됩니다" });
    else if (person.disability?.grade != null) {
      capIds.disability = `selfInjury.disability.amount.${limits.disabilityLimit}.grade${person.disability.grade}`;
      caps.disability = rules.number(capIds.disability, used);
    }
  }
  if (present.includes("death")) {
    if (limits.deathLimit === null) need.push({ field: "own.selfInjury.deathLimit", message: "자기신체사고 사망 가입금액을 입력하면 계산됩니다" });
    else caps.death = limits.deathLimit;
  }
  // 공제액이 생길 수 있으면 실제손해액이 필요하므로 손해 장부의 필수 항목도 있어야 한다.
  const ledgerState = blockers(ledger);
  if (mayHaveDeduction) need.push(...ledgerState.missing);
  if (need.length > 0) return { ok: false, status: "insufficient_info", missing: need, ruleIds: used, reason: "정보 부족" };
  if (present.some((category) => caps[category] === null))
    return { ok: false, status: "needs_check", missing: [], ruleIds: used, reason: "이 가입금액의 급별 보험가입금액표를 확인하지 못했습니다" };
  if (mayHaveDeduction && ledgerState.needsCheck.length > 0)
    return { ok: false, status: "needs_check", missing: [], ruleIds: ledgerState.needsCheck.flatMap((line) => line.ruleIds), reason: ledgerState.needsCheck[0].formula };

  const treatment = person.injury?.treatmentCost ?? 0;
  return combine(
    (scenario) => {
      const loss = lossByCategory(ledger, scenario);
      const deduction = deductionFor(scenario);
      const none = !deduction.unknown && total(deduction.amounts) === 0;
      const byCategory: ByCategory = { injury: 0, disability: 0, death: 0 };
      const steps: Step[] = [];
      for (const category of present) {
        const name = CATEGORY_LABELS[category];
        const cap = caps[category] as number;
        // 공제액이 없을 때 지급하는 금액: 부상은 실제 치료비, 후유장애·사망은 한도 금액 그대로.
        const fixed = category === "injury" ? treatment : cap;
        const base = deduction.unknown ? 0 : none ? fixed : Math.max(0, loss[category] - deduction.amounts[category]);
        steps.push({
          item: `${category}_base`,
          label: `${name} 지급 기준액`,
          value: base,
          formula: none
            ? category === "injury"
              ? `공제액이 없으므로 실제 지출한 치료비 ${won(treatment)}`
              : `공제액이 없으므로 ${name} 보험금액 ${won(cap)}`
            : `${name} 실제손해액 ${won(loss[category])}(과실상계 없음) − 공제액 ${won(deduction.amounts[category])} = ${won(base)}`,
          ruleIds: [],
        });
        byCategory[category] = Math.min(base, cap);
        steps.push({
          item: `${category}_limit`,
          label: `${name} 지급 예상액`,
          value: byCategory[category],
          formula: `자기신체사고 ${name} 한도 ${won(cap)} 이내 → ${won(byCategory[category])}`,
          ruleIds: capIds[category] ? [capIds[category] as string] : [],
        });
      }
      return { byCategory, steps };
    },
    used,
    [],
  );
}
