import dailyWage from "@/data/rules/daily-wage.json";
import business from "@/data/rules/business.json";
import commercial from "@/data/rules/commercial.json";
import motorcycle from "@/data/rules/motorcycle.json";
import bodilyLimits from "@/data/rules/standard/bodily-limits.json";
import coverageClauses from "@/data/rules/standard/coverage-clauses.json";
import fault from "@/data/rules/standard/fault.json";
import injuryLosses from "@/data/rules/standard/injury-losses.json";
import lostEarnings from "@/data/rules/standard/lost-earnings.json";
import ownDamage from "@/data/rules/standard/own-damage.json";
import product from "@/data/rules/standard/product.json";
import property from "@/data/rules/standard/property.json";
import riders from "@/data/rules/standard/riders.json";
import selfInjuryLimits from "@/data/rules/standard/self-injury-limits.json";
import solatium from "@/data/rules/standard/solatium.json";
import productCheck from "@/data/rules/product-check.json";
import productRevisions from "@/data/rules/product-revisions.json";
import { dailyWageFileSchema, productCheckSchema, productRevisionsSchema, ruleFileSchema, type ProductCheck, type ProductLine, type ProductRevisions, type RuleItem } from "@/lib/schemas/rules";
import { dailyWageRuleItems } from "./daily-wage";

// 지급기준 규칙을 읽어 검증한다. 엔진 함수에는 여기서 얻은 목록을 인자로 넘긴다.

const FILES = [bodilyLimits, coverageClauses, fault, injuryLosses, lostEarnings, ownDamage, product, property, riders, selfInjuryLimits, solatium];
/** 보험 종류별로 개인용과 다른 점만 적은 파일 */
const OVERRIDES: Partial<Record<ProductLine, RuleItem[]>> = {
  business: ruleFileSchema.parse(business).items,
  commercial: ruleFileSchema.parse(commercial).items,
  motorcycle: ruleFileSchema.parse(motorcycle).items,
};

/** 스키마에 맞지 않으면 여기서 실패한다(빌드와 테스트가 함께 실패한다) */
export const personRuleItems: RuleItem[] = [...FILES.flatMap((file) => ruleFileSchema.parse(file).items), ...dailyWageRuleItems(dailyWageFileSchema.parse(dailyWage))];

const CHECK = productCheckSchema.parse(productCheck);
const REVISIONS = productRevisionsSchema.parse(productRevisions);
const PRODUCT_NAMES: Record<ProductLine, string> = { personal: "개인용", business: "업무용", commercial: "영업용", motorcycle: "이륜자동차보험" };

/** 그 보험 종류의 약관에서 같은 값임을 확인한 쪽 번호. 대조하지 않았거나 찾지 못했으면 null */
function verifiedPage(check: ProductCheck, productLine: ProductLine, id: string): number | null {
  const probe = check.products[productLine]?.probes.find((candidate) => candidate.same && new RegExp(candidate.ids).test(id));
  return probe?.page ?? null;
}

/**
 * 보험 종류에 맞는 규칙 목록.
 * 바탕은 개인용 약관에서 읽은 값이다. 다른 종류에는 같은 값을 쓰되,
 * - 그 종류의 약관에서 따로 읽은 항목(data/rules/{business,commercial,motorcycle}.json)이 있으면 같은 id의 바탕 항목을 대신한다.
 * - 그 약관과 대조해 같은 값임을 확인한 항목(data/rules/product-check.json)에는 그 약관의 쪽 번호를 출처로 붙인다.
 * - 그 약관의 개정일(data/rules/product-revisions.json)이 비어 있는 동안에는 모두 "약관 확인 필요"다.
 *   개정일을 넣으면 확인한 항목은 그 날짜부터 적용되는 값이 되고, 확인 상태는 개인용 항목의 것을 따른다.
 * - 대조하지 않았거나 그 약관에서 찾지 못한 항목은 개정일과 관계없이 "약관 확인 필요"다.
 */
export function rulesFor(productLine: ProductLine, revisions: ProductRevisions = REVISIONS, check: ProductCheck = CHECK): RuleItem[] {
  if (productLine === "personal") return personRuleItems;
  const revisedOn = revisions.products[productLine]?.revisedOn ?? null;
  const name = `현대해상 ${PRODUCT_NAMES[productLine]} 약관 ${revisedOn ? `${revisedOn} 개정` : "(개정일 미확인)"}`;
  const undated = "약관의 개정일을 확인하지 못해 '약관 확인 필요'로 둔다(data/rules/product-revisions.json에 개정일을 넣으면 풀린다).";

  const overrides = (OVERRIDES[productLine] ?? []).map(
    (item): RuleItem =>
      revisedOn ? { ...item, effectiveFrom: revisedOn, status: "confirmed", basis: { ...item.basis, source: item.basis.source.replace("(개정일 미확인)", `${revisedOn} 개정`) }, note: item.note.replace(/^약관 PDF에 개정일이 없어[^.]*\.\s*/, "") } : item,
  );
  const replaced = new Set(overrides.map((item) => item.id));
  const base = personRuleItems
    .filter((item) => !replaced.has(item.id))
    .map((item): RuleItem => {
      if (item.productLines.includes(productLine)) return item;
      const productLines = [...item.productLines, productLine];
      const page = verifiedPage(check, productLine, item.id);
      if (page === null) return { ...item, productLines, status: "needs_check", note: `개인용 약관에서 옮긴 값이다. ${PRODUCT_NAMES[productLine]} 약관과는 대조하지 않았거나 그 약관에서 찾지 못했다. ${item.note}`.trim() };
      const basis = { ...item.basis, source: `${name} ${page}쪽 (개인용 약관 ${item.basis.page}쪽과 같은 값)` };
      return revisedOn
        ? { ...item, productLines, effectiveFrom: revisedOn, basis }
        : { ...item, productLines, status: "needs_check", basis, note: `${PRODUCT_NAMES[productLine]} 약관 ${page}쪽에서 개인용과 같은 값임을 확인했다. ${undated} ${item.note}`.trim() };
    });
  return [...base, ...overrides];
}

/** 6단계에서 쓰던 이름. rulesFor와 같다 */
export const personRules = rulesFor;
