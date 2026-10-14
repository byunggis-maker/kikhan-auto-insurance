import type { LegalClaim } from "@/lib/schemas/vehicle-claim";
import { makeCell } from "../cell";
import { addRanges, same, won } from "../range";
import type { Rules } from "../rules";
import { NOTICES, type CellLine, type CoverageCell, type MissingInfo, type Range } from "../types";

// 특약. 렌트비용지원 특약은 차량 손해와 묶여 있어 vehicle.ts에서 계산한다.
// - 법률비용 지원: 형사합의금·변호사선임비용·벌금비용. 실제로 부담한 금액을 항목별 한도까지 지급한다.
// - 계산 규칙을 등록하지 않은 특약: 금액 없이 "증권에 있으나 계산 규칙 미등록"으로 표시한다.

type Line = { line: CellLine; counted: boolean; missing: MissingInfo[]; blocked: boolean };

function capped(item: string, label: string, paid: number, limit: Range, limitText: string, ruleIds: string[]): Line {
  const amount: Range = { min: Math.min(paid, limit.min), expected: Math.min(paid, limit.expected), max: Math.min(paid, limit.max) };
  return { line: { kind: "loss", item, label, amount, formula: `실제 부담액 ${won(paid)}, 한도 ${limitText} → ${won(amount.expected)}`, ruleIds, flags: [] }, counted: true, missing: [], blocked: false };
}
const waiting = (item: string, label: string, missing: MissingInfo[]): Line => ({
  line: { kind: "loss", item, label, amount: null, formula: missing.map((m) => m.message).join(" / "), ruleIds: [], flags: [] },
  counted: false,
  missing,
  blocked: false,
});
const skipped = (item: string, label: string, formula: string, ruleIds: string[] = [], blocked = false): Line => ({ line: { kind: "loss", item, label, amount: null, formula, ruleIds, flags: [] }, counted: false, missing: [], blocked });

export function legalCostRider(claim: LegalClaim, rules: Rules): CoverageCell {
  const used: string[] = [];
  const lines: Line[] = [];

  // 이 약관이 가입 유형을 나누지 않으면 정해진 한도표 하나를 쓴다. 증권의 유형이 약관의 유형 목록에 없으면 한도를 알 수 없다.
  const plans = rules.list<string>("rider.legal.plans", used);
  const plan = claim.plan ?? rules.text("rider.legal.defaultPlan", used);

  for (const settlement of claim.settlements) {
    const item = `settlement:${settlement.id}`;
    const label = `형사합의금(${settlement.label})`;
    const need: MissingInfo[] = [];
    if (settlement.amount === null) need.push({ field: "legal.settlement.amount", message: "피해자에게 준 형사합의금을 입력하면 계산됩니다" });
    if (settlement.kind !== "serious_injury" && plan === null) need.push({ field: "legal.plan", message: "증권의 법률비용 지원 가입 유형(기본형·고급형 등)을 고르면 한도를 알 수 있습니다" });
    if (settlement.kind === "gross_negligence_injury" && settlement.victimGrade === null) need.push({ field: "legal.settlement.victimGrade", message: "피해자의 상해급수를 입력하면 한도를 알 수 있습니다" });
    if (need.length > 0 || settlement.amount === null) {
      lines.push(waiting(item, label, need));
      continue;
    }
    const ruleId = settlement.kind === "serious_injury" ? "rider.legal.settlement.seriousInjury" : `rider.legal.settlement.${plan}.${settlement.kind === "death" ? "death" : `grade${settlement.victimGrade}`}`;
    if (settlement.kind !== "serious_injury" && (plans === null || plan === null || !plans.includes(plan))) {
      lines.push(skipped(item, label, "이 약관의 형사합의금 한도표에 없는 가입 유형입니다", ["rider.legal.plans"], true));
      continue;
    }
    const limit = rules.number(ruleId, used);
    lines.push(limit === null ? skipped(item, label, "형사합의금 한도를 확인하지 못했습니다", [ruleId], true) : capped(item, label, settlement.amount, same(limit), won(limit), [ruleId]));
  }

  if (!claim.lawyerIncluded) lines.push(skipped("lawyer", "변호사선임비용", "변호사선임비용을 제외하고 가입한 계약입니다"));
  else if (claim.lawyerEligible === false) lines.push(skipped("lawyer", "변호사선임비용", "구속되거나 공소가 제기된 경우(약식기소 제외)에만 지급합니다"));
  else if (claim.lawyerFee === null && claim.lawyerEligible === null) lines.push(skipped("lawyer", "변호사선임비용", "변호사를 선임했다면 비용을 입력하면 더해집니다"));
  else if (claim.lawyerFee === null) lines.push(waiting("lawyer", "변호사선임비용", [{ field: "legal.lawyerFee", message: "실제로 부담한 변호사선임비용을 입력하면 계산됩니다" }]));
  else if (claim.lawyerEligible === null) lines.push(waiting("lawyer", "변호사선임비용", [{ field: "legal.lawyerEligible", message: "구속되었거나 공소가 제기되었는지(약식기소 제외) 알려 주면 계산됩니다" }]));
  else {
    const limit = rules.number("rider.legal.lawyer.limit", used);
    lines.push(limit === null ? skipped("lawyer", "변호사선임비용", "변호사선임비용 한도를 확인하지 못했습니다", ["rider.legal.lawyer.limit"], true) : capped("lawyer", "변호사선임비용", claim.lawyerFee, same(limit), won(limit), ["rider.legal.lawyer.limit"]));
  }

  if (!claim.fineIncluded) lines.push(skipped("fine", "벌금비용", "벌금비용을 제외하고 가입한 계약입니다"));
  else if (claim.fine === null) lines.push(skipped("fine", "벌금비용", "벌금형이 확정되었다면 벌금을 입력하면 더해집니다"));
  else {
    const standard = rules.number("rider.legal.fine.limit", used);
    const schoolZone = rules.number("rider.legal.fine.schoolZoneLimit", used);
    if (standard === null || schoolZone === null) lines.push(skipped("fine", "벌금비용", "벌금비용 한도를 확인하지 못했습니다", ["rider.legal.fine.limit", "rider.legal.fine.schoolZoneLimit"], true));
    else {
      // 어린이 보호구역 사고인지 모르면 최소·예상은 기본 한도, 최대는 넓은 한도로 계산한다.
      const limit: Range = claim.schoolZone === true ? same(schoolZone) : claim.schoolZone === false ? same(standard) : { min: standard, expected: standard, max: schoolZone };
      const text = claim.schoolZone === null ? `${won(standard)}(어린이 보호구역 사고면 ${won(schoolZone)})` : won(limit.expected);
      lines.push(capped("fine", "벌금비용", claim.fine, limit, text, ["rider.legal.fine.limit", "rider.legal.fine.schoolZoneLimit"]));
    }
  }

  const cellLines = lines.map((row) => row.line);
  const counted = lines.filter((row) => row.counted);
  const missing = lines.flatMap((row) => row.missing);
  if (lines.some((row) => row.blocked))
    return makeCell(rules, "rider_legal", { status: "needs_check", amount: null, lines: cellLines, missing: [], flags: [], reason: "약관 확인 필요: 법률비용 지원 한도를 확인하지 못했습니다" }, used);
  if (counted.length === 0) {
    const need = missing.length > 0 ? missing : [{ field: "legal", message: "형사합의금·변호사선임비용·벌금 가운데 실제로 부담한 금액을 입력하면 계산됩니다" }];
    return makeCell(rules, "rider_legal", { status: "insufficient_info", amount: null, lines: cellLines, missing: need, flags: [], reason: `정보 부족: ${need.map((m) => m.message).join(" / ")}` }, used);
  }
  const amount = addRanges(counted.map((row) => row.line.amount as Range));
  return makeCell(rules, "rider_legal", { status: "calculated", amount, lines: cellLines, missing, flags: missing.length > 0 ? ["partial"] : [], reason: null }, used);
}

/** 증권에는 있지만 계산 규칙을 등록하지 않은 특약. 금액을 만들지 않고 합계에도 넣지 않는다 */
export function unregisteredRider(rules: Rules, coverage: "rider_other" | "rider_legal" | "rider_rental", name: string, ruleIds: string[] = []): CoverageCell {
  return makeCell(rules, coverage, { status: "needs_check", amount: null, lines: [], missing: [], flags: ["rule_not_registered"], reason: `${NOTICES.rule_not_registered}: ${name}` }, ruleIds);
}
