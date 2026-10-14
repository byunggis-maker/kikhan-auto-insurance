import { afterFault } from "../fault";
import type { PropertyItem, PropertyLedger } from "../property-ledger";
import { won } from "../range";
import type { Rules } from "../rules";
import type { Scenario } from "../types";

// 대물배상: 지급기준(별표2)으로 산출한 손해액을 피해자 쪽 과실비율만큼 상계하고, 가입금액까지 지급한다.
// 입력: 물적 손해 장부, 피해 차량 쪽 과실비율, 대물배상 가입금액. 출력: 한 경우의 지급액과 항목별 지급액.

export type PropertyPayment = {
  loss: number;
  afterFault: number;
  paid: number;
  /** 지급액을 장부의 줄 순서대로 나눈 것. 자기차량손해와 렌트비용 특약의 공제에 쓴다 */
  byItem: Partial<Record<PropertyItem, number>>;
  formulas: { afterFault: string; limit: string };
};

/** limit이 "unlimited"이면 한도를 적용하지 않는다(상대방 가입금액을 모를 때의 가정 계산). 원 미만 처리 방식을 모르면 null */
export function liabilityProperty(ledger: PropertyLedger, faultPercent: number, limit: number | "unlimited", scenario: Scenario, rules: Rules, used: string[]): PropertyPayment | null {
  const rows = ledger.lines.filter((row) => row.status === "calculated" && row.amount);
  const loss = rows.reduce((sum, row) => sum + (row.amount?.[scenario] ?? 0), 0);
  const offset = afterFault(rules, used, loss, faultPercent);
  if (offset === null) return null;
  const paid = limit === "unlimited" ? offset : Math.min(offset, limit);
  const byItem: Partial<Record<PropertyItem, number>> = {};
  let left = paid;
  for (const row of rows) {
    const share = afterFault(rules, used, row.amount?.[scenario] ?? 0, faultPercent);
    if (share === null) return null;
    const part = Math.min(left, share);
    byItem[row.item] = part;
    left -= part;
  }
  return {
    loss,
    afterFault: offset,
    paid,
    byItem,
    formulas: {
      afterFault: `손해액 합계 ${won(loss)} × (100 − ${faultPercent})% = ${won(offset)}`,
      limit: `대물배상 가입금액 ${limit === "unlimited" ? "무한" : won(limit)} 이내 → ${won(paid)}`,
    },
  };
}
