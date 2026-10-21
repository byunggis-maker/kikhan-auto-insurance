import { lossItemDef } from "@/lib/claim/lossItems";
import { ASSUMPTIONS, FUNERAL, INJURY_SOLATIUM, LOST_INCOME, OTHER_INJURY } from "@/lib/claim/standards";
import type { LossItem, Property, Victim } from "@/lib/claim/types";
import { same, won } from "./legacy/range";
import type { Ledger, LossLine } from "./legacy/types";
import type { LossDetail, ValueMode } from "./types";

// MASTER.md 6장 (3) 손해액 정리와 5장 확정/추정 값 고르기.
// - 확정 계산: confirmed(서류 금액)만 쓴다.
// - 추정 포함 계산: confirmed가 빈 칸만 estimated로 채운다. 둘 다 비어 있으면 약관이 금액이나 산식을 정한 항목을
//   약관 기준으로 계산한다(부상 위자료·장례비·휴업손해·그 밖의 손해배상금). 사용자가 금액을 직접 넣으면 그 값이 우선이다.
//   약관 기준 값은 입력한 일수·소득으로 계산한 것이라 서류 금액이 아니므로 추정으로 본다.
// - 그래도 값이 없으면 "입력 필요"로 남기고 합계에 넣지 않는다.
// - 항목 없이 합계(userTotal)만 있으면 "항목 미분류 손해(추정)"로 넣고, 치료관계비 하한은 적용하지 않는다.

export const UNCLASSIFIED = "unclassified";

type Value = { amount: number; source: string; formula: string };

/** 약관 기준으로 계산할 수 있는 항목의 값. 계산에 필요한 입력이 없으면 null */
function standardValue(code: string, victim: Victim): Value | null {
  if (code === "solatium_injury" && victim.injuryGrade !== null) {
    const amount = INJURY_SOLATIUM.value[victim.injuryGrade];
    return { amount, source: "약관 기준", formula: `${victim.injuryGrade}급 ${won(amount)} (${cite(INJURY_SOLATIUM.basis)})` };
  }
  if (code === "funeral") return { amount: FUNERAL.value, source: "약관 기준", formula: `정액 ${won(FUNERAL.value)} (${cite(FUNERAL.basis)})` };
  if (code === "lost_income" && victim.daysOffWork !== null && victim.monthlyIncome !== null) {
    const days = ASSUMPTIONS.daysPerMonth.value;
    // 월소득 × 휴업일수 × 85 / (30 × 100), 원 미만 버림
    const amount = Math.floor((victim.monthlyIncome * victim.daysOffWork * LOST_INCOME.ratePercent) / (days * 100));
    const formula = `월소득 ${won(victim.monthlyIncome)} ÷ ${days}일 × 휴업 ${victim.daysOffWork}일 × ${LOST_INCOME.ratePercent}% = ${won(amount)} (${cite(LOST_INCOME.basis)}; 월 ${days}일은 앱 가정, 원 미만 버림)`;
    return unprovenLostIncome(victim, { amount, source: "약관 기준", formula });
  }
  if (code === "other_injury" && (victim.outpatientDays !== null || victim.mealsNotProvided !== null)) {
    const outpatient = (victim.outpatientDays ?? 0) * OTHER_INJURY.perOutpatientDay;
    const meals = (victim.mealsNotProvided ?? 0) * OTHER_INJURY.perMeal;
    const parts = [
      victim.outpatientDays !== null ? `통원 ${victim.outpatientDays}일 × ${won(OTHER_INJURY.perOutpatientDay)} = ${won(outpatient)}` : null,
      victim.mealsNotProvided !== null ? `입원 중 병원 식사를 받지 않은 ${victim.mealsNotProvided}끼 × ${won(OTHER_INJURY.perMeal)} = ${won(meals)}` : null,
    ].filter(Boolean);
    return { amount: outpatient + meals, source: "약관 기준", formula: `${parts.join(" + ")} → ${won(outpatient + meals)} (${cite(OTHER_INJURY.basis)})` };
  }
  return null;
}

/**
 * 휴업손해는 소득·수입 감소를 관계 서류로 증명할 수 있을 때만 준다(별표1 나. 3. 가., 인쇄 76쪽).
 * "소득 증명 가능"이 아니면 추정 0원으로 두고, 증명했을 때의 금액은 계산식에 참고로 남긴다(결정 기록 D-24).
 */
function unprovenLostIncome(victim: Victim, value: Value): Value {
  if (victim.incomeProven === true) return value;
  return {
    amount: 0,
    source: value.source,
    formula: `소득 증명 ${victim.incomeProven === false ? "불가" : "여부 모름"}: 0원 (휴업손해는 관계 서류로 증명할 수 있는 경우에만, ${cite(LOST_INCOME.basis)}). 참고: 증명하면 ${value.formula}`,
  };
}

function cite(basis: { source: string; page: number }) {
  return `${basis.source}, 인쇄 ${basis.page}쪽`;
}

/** 항목 하나에 쓸 값. null이면 "입력 필요" */
export function pickValue(item: LossItem, mode: ValueMode, victim?: Victim): Value | null {
  if (item.confirmed !== null) return { amount: item.confirmed, source: "서류", formula: `서류 금액 ${won(item.confirmed)}${item.evidence ? ` (${item.evidence})` : ""}` };
  if (mode === "confirmed") return null;
  if (item.estimated !== null) {
    const source = item.source.estimated === "policy_standard" ? "약관 기준" : item.source.estimated === "app_default" ? "앱 기본값" : "사용자 추정";
    const value = { amount: item.estimated, source, formula: `${source} ${won(item.estimated)}` };
    // 사용자가 넣은 휴업손해 추정액에도 같은 증명 요건을 적용한다. 서류 금액(confirmed)은 증명된 것으로 본다.
    return item.code === "lost_income" && victim ? unprovenLostIncome(victim, value) : value;
  }
  return victim ? standardValue(item.code, victim) : null;
}

export type PersonLoss = { ledger: Ledger; actualLoss: number; missing: string[]; notes: string[]; unclassified: boolean; details: LossDetail[] };

function lossLine(item: string, category: LossLine["category"], amount: number, medical: boolean, guaranteed: boolean, label: string): LossLine {
  return { item, category, label, status: "calculated", amount: same(amount), formula: "", ruleIds: [], missing: [], flags: [], required: false, medical, guaranteed };
}

export function personLoss(victim: Victim, mode: ValueMode): PersonLoss {
  const lines: LossLine[] = [];
  const missing: string[] = [];
  const notes: string[] = [];
  const details: LossDetail[] = [];
  for (const item of victim.losses) {
    const def = lossItemDef(item.code);
    if (!def || def.target !== "person" || def.category === "property") continue;
    const value = pickValue(item, mode, victim);
    if (value === null) {
      missing.push(item.code);
      if (item.code === "other_injury" && mode === "with_estimates" && victim.hospitalDays !== null && victim.mealsNotProvided === null)
        notes.push(`입원 ${victim.hospitalDays}일: 입원 식대(1끼 ${won(OTHER_INJURY.perMeal)})는 병원 식사를 받지 않은 끼니 수를 넣으면 계산합니다(별표1 나. 5. 가., 인쇄 78쪽).`);
      continue;
    }
    if (item.code === "future_treatment" && victim.injuryGrade !== null && victim.injuryGrade > 11) {
      notes.push(`향후치료비는 상해 1~11급만 인정합니다(별표1 나. 1. 다.). ${victim.injuryGrade}급이라 ${won(value.amount)}을 넣지 않았습니다.`);
      continue;
    }
    lines.push(lossLine(item.code, def.category, value.amount, def.medical, def.guaranteed, def.label));
    details.push({ code: item.code, label: def.label, amount: value.amount, source: value.source, formula: value.formula });
  }
  let unclassified = false;
  if (victim.losses.length === 0 && victim.userTotal !== null && mode === "with_estimates") {
    // 치료관계비인지 알 수 없으므로 medical·guaranteed가 아니다 → 치료관계비 하한을 적용하지 않는다.
    lines.push(lossLine(UNCLASSIFIED, victim.died ? "death" : "injury", victim.userTotal, false, false, "항목 미분류 손해(추정)"));
    details.push({ code: UNCLASSIFIED, label: "항목 미분류 손해(추정)", amount: victim.userTotal, source: "사용자 추정", formula: `합계 칸 ${won(victim.userTotal)}` });
    unclassified = true;
    notes.push("항목 미분류 손해(추정)로 계산했습니다. 치료관계비 하한은 적용하지 않았습니다. 항목을 나누면 더 정확해집니다.");
  }
  const actualLoss = lines.reduce((sum, line) => sum + (line.amount?.expected ?? 0), 0);
  if (!unclassified && victim.userTotal !== null && victim.losses.length > 0 && mode === "with_estimates" && victim.userTotal !== actualLoss)
    notes.push(`직접 넣은 합계 ${won(victim.userTotal)}과 항목 합계 ${won(actualLoss)}이 ${won(Math.abs(victim.userTotal - actualLoss))} 다릅니다. 계산은 항목 합계로 했습니다.`);
  return { ledger: { lines }, actualLoss, missing, notes, unclassified, details };
}

export type PropertyLoss = { total: number; byCode: Record<string, number>; missing: string[]; notes: string[]; details: LossDetail[] };

export function propertyLoss(property: Property, mode: ValueMode): PropertyLoss {
  const byCode: Record<string, number> = {};
  const missing: string[] = [];
  const notes: string[] = [];
  const details: LossDetail[] = [];
  for (const item of property.losses) {
    const value = pickValue(item, mode);
    if (value === null) missing.push(item.code);
    else {
      byCode[item.code] = (byCode[item.code] ?? 0) + value.amount;
      details.push({ code: item.code, label: lossItemDef(item.code)?.label ?? item.code, amount: value.amount, source: value.source, formula: value.formula });
    }
  }
  if (property.losses.length === 0 && property.userTotal !== null && mode === "with_estimates") {
    byCode[UNCLASSIFIED] = property.userTotal;
    details.push({ code: UNCLASSIFIED, label: "항목 미분류 손해(추정)", amount: property.userTotal, source: "사용자 추정", formula: `합계 칸 ${won(property.userTotal)}` });
    notes.push("항목 미분류 손해(추정)로 계산했습니다. 항목을 나누면 더 정확해집니다.");
  }
  const total = Object.values(byCode).reduce((sum, amount) => sum + amount, 0);
  return { total, byCode, missing, notes, details };
}
