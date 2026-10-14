import { afterFault, liabilityBlocker, type Claim } from "../fault";
import { guaranteedCost, hasCategory, lossByCategory } from "../loss-ledger";
import { won } from "../range";
import { CATEGORY_LABELS, combine, type Step } from "../steps";
import { CATEGORIES, type ByCategory, type Computation, type LossCategory } from "../types";

// 대인배상Ⅰ: 사망·부상·후유장애 각각의 손해액을 과실상계한 뒤, 자동차손해배상보장법 시행령의 한도 안에서 지급한다.
// 입력: 손해 장부, 과실비율, 상해급수, 후유장애 급수. 출력: 구분별 지급액(최소·예상·최대).
// - 부상: 상계 후 금액이 치료관계비와 간병비의 합보다 적으면 한도 안에서 치료관계비(식대 포함)와 간병비를 보상한다.
// - 사망: 상계 후 금액이 최저 보상액보다 적으면 최저 보상액을 보상한다.

export function liabilityBodily1(claim: Claim): Computation {
  const { person, ledger, rules } = claim;
  const blocked = liabilityBlocker(claim);
  if (blocked) return blocked;
  const fault = person.faultPercent as number;
  const used: string[] = [];
  const present = CATEGORIES.filter((category) => hasCategory(ledger, category));

  if (present.includes("disability") && person.disability?.grade == null)
    return { ok: false, status: "insufficient_info", missing: [{ field: "disability.grade", message: "후유장애 급수를 입력하면 대인배상Ⅰ 한도를 알 수 있습니다" }], ruleIds: [], reason: "정보 부족" };

  const limitIds: Record<LossCategory, string> = {
    injury: `liability1.injury.limit.grade${person.injury?.grade}`,
    disability: `liability1.disability.limit.grade${person.disability?.grade}`,
    death: "liability1.death.limit",
  };
  const limits = Object.fromEntries(present.map((category) => [category, rules.number(limitIds[category], used)])) as Partial<Record<LossCategory, number | null>>;
  const floorOn = rules.flag("fault.medicalFloor", used);
  const deathMinimum = present.includes("death") ? rules.number("liability1.death.minimum", used) : 0;
  if (present.some((category) => limits[category] === null) || floorOn === null || deathMinimum === null)
    return { ok: false, status: "needs_check", missing: [], ruleIds: used, reason: "대인배상Ⅰ 한도를 확인하지 못했습니다" };

  return combine(
    (scenario) => {
      const loss = lossByCategory(ledger, scenario);
      const byCategory: ByCategory = { injury: 0, disability: 0, death: 0 };
      const steps: Step[] = [];
      for (const category of present) {
        const name = CATEGORY_LABELS[category];
        const limit = limits[category] as number;
        const offset = afterFault(rules, used, loss[category], fault);
        if (offset === null) return null;
        steps.push({ item: `${category}_after_fault`, label: `${name} 과실상계 후`, value: offset, formula: `${name} 손해액 ${won(loss[category])} × (100 − ${fault})% = ${won(offset)}`, ruleIds: [] });

        let payable = offset;
        if (category === "injury") {
          const guaranteed = guaranteedCost(ledger, scenario);
          const raised = floorOn && offset < guaranteed;
          if (raised) payable = guaranteed;
          steps.push({
            item: "injury_medical_floor",
            label: "부상 치료비 보장 적용 후",
            value: payable,
            formula: raised ? `과실상계 후 금액이 치료관계비·간병비 ${won(guaranteed)}보다 적어 ${won(guaranteed)}을 보장` : "과실상계 후 금액이 치료관계비·간병비 이상이라 그대로",
            ruleIds: ["fault.medicalFloor"],
          });
        }
        if (category === "death") {
          const raised = offset < deathMinimum;
          if (raised) payable = deathMinimum;
          steps.push({
            item: "death_minimum",
            label: "사망 최저 보상 적용 후",
            value: payable,
            formula: raised ? `과실상계 후 금액이 ${won(deathMinimum)}보다 적어 ${won(deathMinimum)}을 보상` : `과실상계 후 금액이 ${won(deathMinimum)} 이상이라 그대로`,
            ruleIds: ["liability1.death.minimum"],
          });
        }
        byCategory[category] = Math.min(payable, limit);
        steps.push({ item: `${category}_limit`, label: `${name} 지급 예상액`, value: byCategory[category], formula: `대인배상Ⅰ ${name} 한도 ${won(limit)} 이내 → ${won(byCategory[category])}`, ruleIds: [limitIds[category]] });
      }
      return { byCategory, steps };
    },
    used,
    [],
  );
}
