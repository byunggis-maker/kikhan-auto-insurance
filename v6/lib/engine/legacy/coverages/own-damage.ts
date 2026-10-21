// 이식 원본: compass/lib/engine/coverages/own-damage.ts 1–47행 전체 (compass 커밋 e58ffd1). 바꾼 것: import 경로만.
// MASTER.md 6장 이식 로직(부록 A). 아직 v6 엔진에 연결하지 않았다.
import type { Deductible, VehicleDamage } from "../schemas/vehicle-claim";
import { won } from "../range";
import { scale, type Rules } from "../rules";
import type { Step } from "../steps";

// 자기차량손해: 손해액(수리비 또는 전손 가액)을 가입금액·차량가액까지 인정하고 자기부담금을 뺀다.
// 과실이 양쪽에 있는 사고에서는 상대방 대물배상이 처리하는 금액을 먼저 빼고, 남은 금액(내 과실분)에 자기부담금 비율을 적용한다.
// 전손이거나 손해액이 가입금액 전액 이상이면 자기부담금을 빼지 않는다. 본인 과실비율을 다시 곱하지 않는다.
// 입력: 차량 손해, 가입금액, 증권의 자기부담금 조건, 상대 보험 처리분. 출력: 한 경우의 지급액과 단계.

export type OwnDamageTerms = { limit: number; deductible: Deductible; waivedOnTotalLoss: boolean; onNetOfRecovery: boolean };

/** loss: 수리비 또는 전손 가액. recovered: 상대방 대물배상이 이 손해에 지급하는 금액. 원 미만 처리 방식을 모르면 null */
export function ownDamage(damage: VehicleDamage, loss: number, terms: OwnDamageTerms, recovered: number, rules: Rules, used: string[]): { value: number; steps: Step[] } | null {
  const { limit, deductible } = terms;
  const value = damage.valueAtAccident;
  const capped = Math.min(loss, limit, value ?? loss);
  const steps: Step[] = [
    {
      item: "own_damage_loss",
      label: "인정 손해액",
      value: capped,
      formula: `${damage.totalLoss === true ? "전손 가액" : "수리비"} ${won(loss)}, 가입금액 ${won(limit)}${value === null ? "" : `, 사고 직전 차량가액 ${won(value)}`} 중 작은 금액 → ${won(capped)}`,
      ruleIds: [],
    },
  ];
  const net = Math.max(0, capped - recovered);
  steps.push({ item: "own_damage_net", label: "상대 보험 처리분 공제 후", value: net, formula: `${won(capped)} − 상대방 대물배상 처리분 ${won(recovered)} = ${won(net)}`, ruleIds: ["ownDamage.deductible.onNetOfRecovery"] });

  const waived = terms.waivedOnTotalLoss && (damage.totalLoss === true || capped >= limit);
  const base = terms.onNetOfRecovery ? net : capped;
  let charge = 0;
  let formula = "전손이거나 손해액이 가입금액 전액 이상이라 자기부담금을 빼지 않음";
  if (waived) charge = 0;
  else if (deductible.type === "fixed") {
    charge = Math.min(deductible.amount, net);
    formula = `증권의 정액 자기부담금 ${won(deductible.amount)}`;
  } else {
    const byRate = scale(rules, used, base, [[deductible.ratePercent, 100]]);
    if (byRate === null) return null;
    charge = Math.min(Math.max(byRate, deductible.min), deductible.max, net);
    formula = `${won(base)} × ${deductible.ratePercent}% = ${won(byRate)} → 최소 ${won(deductible.min)}·최대 ${won(deductible.max)} 적용 → ${won(charge)}`;
  }
  steps.push({ item: "own_damage_deductible", label: "자기부담금", value: charge, formula, ruleIds: ["ownDamage.deductible.waivedOnTotalLoss"] });
  steps.push({ item: "own_damage_paid", label: "지급 예상액", value: net - charge, formula: `${won(net)} − 자기부담금 ${won(charge)} = ${won(net - charge)}`, ruleIds: [] });
  return { value: net - charge, steps };
}
