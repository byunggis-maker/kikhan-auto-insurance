import type { Limit } from "@/lib/schemas/person-claim";
import type { Claim } from "../fault";
import { blockers, hasCategory, lossByCategory } from "../loss-ledger";
import { won } from "../range";
import { CATEGORY_LABELS, combine, type Step } from "../steps";
import { CATEGORIES, type ByCategory, type Computation, type LossCategory, type MissingInfo, type Scenario } from "../types";

// 자동차상해(특별약관): 실손형. 대인배상 지급기준으로 산출한 실제손해액(과실상계와 한도를 적용하기 전)에서
// 공제액을 빼고, 가입금액까지 지급한다. 본인 과실로 줄이지 않는다.
// 입력: 손해 장부, 부상·사망/후유장애 가입금액, 공제액(대인배상Ⅰ·Ⅱ, 무보험자동차상해, 제3자에게서 받은 금액).
// 출력: 구분별 지급액.

/** 한 경우의 공제액. unknown이면 공제액을 알 수 없어 전부 공제될 수도 있다는 뜻이다 */
export type Deduction = { amounts: ByCategory; unknown: boolean };
export type AutoInjuryLimits = { injuryLimit: Limit | null; deathDisabilityLimit: Limit | null };

export function autoInjury(claim: Claim, limits: AutoInjuryLimits, deductionFor: (scenario: Scenario) => Deduction): Computation {
  const { ledger } = claim;
  const { missing, needsCheck } = blockers(ledger);
  const present = CATEGORIES.filter((category) => hasCategory(ledger, category));
  const limitOf: Record<LossCategory, Limit | null> = { injury: limits.injuryLimit, disability: limits.deathDisabilityLimit, death: limits.deathDisabilityLimit };
  const need: MissingInfo[] = [...missing];
  if (present.includes("injury") && limits.injuryLimit === null) need.push({ field: "own.autoInjury.injuryLimit", message: "자동차상해 부상 가입금액을 입력하면 계산됩니다" });
  if (present.some((category) => category !== "injury") && limits.deathDisabilityLimit === null)
    need.push({ field: "own.autoInjury.deathDisabilityLimit", message: "자동차상해 사망·후유장애 가입금액을 입력하면 계산됩니다" });
  if (need.length > 0) return { ok: false, status: "insufficient_info", missing: need, ruleIds: [], reason: "정보 부족" };
  if (needsCheck.length > 0) return { ok: false, status: "needs_check", missing: [], ruleIds: needsCheck.flatMap((line) => line.ruleIds), reason: needsCheck[0].formula };

  return combine(
    (scenario) => {
      const loss = lossByCategory(ledger, scenario);
      const deduction = deductionFor(scenario);
      const byCategory: ByCategory = { injury: 0, disability: 0, death: 0 };
      const steps: Step[] = [];
      for (const category of present) {
        const name = CATEGORY_LABELS[category];
        const limit = limitOf[category] as Limit;
        const net = deduction.unknown ? 0 : Math.max(0, loss[category] - deduction.amounts[category]);
        steps.push({
          item: `${category}_net`,
          label: `${name} 실제손해액 − 공제액`,
          value: net,
          formula: `${name} 실제손해액 ${won(loss[category])}(과실상계 없음) − 공제액 ${won(deduction.amounts[category])} = ${won(net)}`,
          ruleIds: [],
        });
        byCategory[category] = limit === "unlimited" ? net : Math.min(net, limit);
        steps.push({ item: `${category}_limit`, label: `${name} 지급 예상액`, value: byCategory[category], formula: `자동차상해 ${name} 가입금액 ${limit === "unlimited" ? "무한" : won(limit)} 이내 → ${won(byCategory[category])}`, ruleIds: [] });
      }
      return { byCategory, steps };
    },
    [],
    [],
  );
}
