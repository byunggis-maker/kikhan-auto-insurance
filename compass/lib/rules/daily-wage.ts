import type { DailyWageFile, RuleItem } from "@/lib/schemas/rules";

// data/rules/daily-wage.json(일용근로자 임금)을 엔진이 쓰는 규칙 항목으로 바꾼다.

/**
 * 값이 없는 자리 항목 하나와, 값을 넣은 줄마다 항목 하나를 만든다.
 * 사고일에 맞는 값이 없으면 자리 항목(값 null)이 쓰여 "일용근로자 임금 입력 필요"가 된다.
 */
export function dailyWageRuleItems(file: DailyWageFile): RuleItem[] {
  const common = { id: file.ruleId, unit: file.unit, productLines: file.productLines };
  const placeholder: RuleItem = { ...common, value: null, effectiveFrom: file.definition.effectiveFrom, effectiveTo: null, basis: file.definition.basis, status: "needs_check", note: file.note };
  const filled = file.entries
    .flatMap((entry) => (entry.value !== null && entry.source !== null && entry.publishedOn !== null && entry.effectiveFrom !== null ? [{ ...entry, value: entry.value, source: entry.source, publishedOn: entry.publishedOn, effectiveFrom: entry.effectiveFrom }] : []))
    // 적용 기간이 겹치면 나중에 시작한 값이 쓰이도록 시작일 순서로 둔다.
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    .map(
      (entry): RuleItem => ({
        ...common,
        value: entry.value,
        effectiveFrom: entry.effectiveFrom,
        effectiveTo: entry.effectiveTo,
        basis: { ...file.definition.basis, source: `${entry.source} (공표일 ${entry.publishedOn})` },
        status: "confirmed",
        note: "",
      }),
    );
  return [placeholder, ...filled];
}
