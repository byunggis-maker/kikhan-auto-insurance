// v6에서 새로 쓴 코드(이식 아님). MASTER.md 6장: medicalFloor 등 이식 규칙은 productLines에 적힌 보험 종류로만 검증됐다.
// 다른 보험 종류(업무용·영업용·이륜차)에서 그 규칙을 쓰면 결과에 "미검증" 표시를 붙인다. 규칙 값은 바꾸지 않는다.
import type { ProductLine, RuleItem } from "./schemas/rules";

export const UNVERIFIED_NOTICE = "미검증: 해당 약관 대조 필요";

/** 계산에 쓴 규칙 가운데 이 보험 종류로 검증되지 않은 것의 id */
export function unverifiedRuleIds(items: RuleItem[], usedRuleIds: string[], productLine: ProductLine): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return [...new Set(usedRuleIds)].filter((id) => {
    const item = byId.get(id);
    return item !== undefined && !item.productLines.includes(productLine);
  });
}

/** 결과에 붙일 표시. 모두 검증된 규칙이면 null */
export function verificationNotice(items: RuleItem[], usedRuleIds: string[], productLine: ProductLine): { notice: string; ruleIds: string[] } | null {
  const ruleIds = unverifiedRuleIds(items, usedRuleIds, productLine);
  return ruleIds.length > 0 ? { notice: UNVERIFIED_NOTICE, ruleIds } : null;
}
