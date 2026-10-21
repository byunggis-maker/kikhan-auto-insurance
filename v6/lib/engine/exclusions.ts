import type { Accident } from "@/lib/claim/types";

// MASTER.md 6장 (1) 면책·제한 확인(결정 기록 D-3, D-11).
// 모르는 사실(null)은 위반이 없는 것으로 계산하고, 그 사실이 결과를 바꾸는 경우에만 표시한다.

export type Exclusions = {
  /** 고의 사고: 계산하지 않고 안내만 */
  blocked: string | null;
  /** 사고부담금 대상(음주·무면허·마약·조치의무 위반) */
  burden: boolean;
  burdenReasons: string[];
  /** 운전자 범위 위반 */
  outsideScope: boolean;
  /** 자기차량손해: 지급 / 면책 / 운전자 관계를 몰라 두 경우 모두 계산 */
  ownDamage: "paid" | "excluded" | "relation_unknown";
};

const DUI_RELATIONS = ["policyholder_or_named", "long_term_lessee", "cohabiting_relative"] as const;

export function checkExclusions(accident: Accident): Exclusions {
  const v = accident.violations;
  const reasons = [v.drunk && "음주운전", v.unlicensed && "무면허운전", v.drugs && "마약·약물운전", v.fledScene && "사고발생 시 조치의무 위반"].filter((r): r is string => typeof r === "string");
  const dui = v.drunk === true || v.unlicensed === true || v.drugs === true;
  let ownDamage: Exclusions["ownDamage"] = "paid";
  if (dui) {
    if (v.driverRelation === null) ownDamage = "relation_unknown";
    else if ((DUI_RELATIONS as readonly string[]).includes(v.driverRelation)) ownDamage = "excluded";
  }
  return {
    blocked: v.intentional === true ? "고의로 낸 사고는 보상하지 않습니다(보통약관 제5조·제8조·제14조·제19조·제23조). 금액을 계산하지 않습니다." : null,
    burden: reasons.length > 0,
    burdenReasons: reasons,
    outsideScope: v.outsideDriverScope === true,
    ownDamage,
  };
}
