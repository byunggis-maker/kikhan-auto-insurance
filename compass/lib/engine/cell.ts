import type { Rules } from "./rules";
import type { CoverageCell, CoverageKey, MissingInfo } from "./types";

// 칸을 만드는 유일한 곳. 쓴 규칙의 근거 조항과 "약관 확인 필요" 목록을 여기서 붙인다.

export type CellParts = Pick<CoverageCell, "status" | "amount" | "lines" | "missing" | "flags" | "reason">;

export function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function uniqueMissing(list: MissingInfo[]) {
  return list.filter((item, index) => list.findIndex((other) => other.field === item.field && other.message === item.message) === index);
}

/** ruleIds: 이 칸을 계산하며 쓴 규칙. 담보의 지급보험금 계산 조항(clause.담보)은 자동으로 더한다 */
export function makeCell(rules: Rules, coverage: CoverageKey, cell: CellParts, ruleIds: string[]): CoverageCell {
  const used: string[] = [];
  if (coverage !== "rider_other") rules.text(`clause.${coverage}`, used);
  const all = unique([...used, ...ruleIds]);
  const refs = all.map((id) => rules.ref(id));
  return {
    coverage,
    ...cell,
    missing: uniqueMissing(cell.missing),
    basis: unique(refs.map((ref) => ref.basis)),
    ruleIds: all,
    needsCheckRuleIds: refs.filter((ref) => ref.status === "needs_check").map((ref) => ref.id),
    inTotal: cell.status === "calculated",
  };
}

export function notApplicableCell(rules: Rules, coverage: CoverageKey, reason: string): CoverageCell {
  return makeCell(rules, coverage, { status: "not_applicable", amount: null, lines: [], missing: [], flags: [], reason }, []);
}
