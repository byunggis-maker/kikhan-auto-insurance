import { lossItemDef } from "@/lib/claim/lossItems";
import { ASSUMPTIONS, FUNERAL, HOMEMAKER, INJURY_SOLATIUM, LOST_INCOME, NO_LOSS_OCCUPATIONS, OTHER_INJURY, STANDARDS_AS_OF, UNPROVEN_EARNER, dailyWageFor } from "@/lib/claim/standards";
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
function standardValue(code: string, victim: Victim, date: string): Value | null {
  const wage = dailyWageFor(date);
  /**
   * 일용근로자 임금을 쓰는 휴업손해(라운드 6c, 결정 기록 D-38): 1일 수입감소액 = 월 임금(일급 × 25일) ÷ 30.
   * 그 뒤 85%, 휴업일수를 곱한다. 원 미만은 단계마다 버린다.
   */
  const wageLostIncome = (who: string, w: NonNullable<typeof wage>, days: number, basis: { source: string; page: number }): Value => {
    const perDay = Math.floor(w.monthly / ASSUMPTIONS.daysPerMonth.value);
    const perDayLoss = Math.floor((perDay * LOST_INCOME.ratePercent) / 100);
    const amount = perDayLoss * days;
    return {
      amount,
      source: "약관 기준",
      formula: `${who}: 월 ${won(w.monthly)}(일 ${won(w.value)} × 25일) ÷ ${ASSUMPTIONS.daysPerMonth.value} × ${LOST_INCOME.ratePercent}% × ${days}일 = ${won(amount)} (${cite(basis)}; 일용근로자 임금 ${w.formula}; 원 미만은 단계마다 버림)`,
    };
  };
  if (code === "solatium_injury" && victim.injuryGrade !== null) {
    const amount = INJURY_SOLATIUM.value[victim.injuryGrade];
    return { amount, source: "약관 기준", formula: `${victim.injuryGrade}급 ${won(amount)} (${cite(INJURY_SOLATIUM.basis)})` };
  }
  if (code === "funeral") return { amount: FUNERAL.value, source: "약관 기준", formula: `정액 ${won(FUNERAL.value)} (${cite(FUNERAL.basis)})` };
  if (code === "lost_income" && (victim.occupation === "unemployed" || victim.occupation === "no_income")) return noLossValue(victim);
  if (code === "lost_income" && victim.occupation === "homemaker") {
    if (wage === null || victim.daysOffWork === null) return null;
    return unprovenLostIncome(victim, wageLostIncome("가사종사자", wage, victim.daysOffWork, HOMEMAKER.basis));
  }
  // 유직자가 월소득 금액을 증명하지 못하면 일용근로자 임금(결정 기록 D-32)
  if (code === "lost_income" && victim.occupation !== "homemaker" && victim.incomeAmountProven === false) {
    if (wage === null || victim.daysOffWork === null) return null;
    return unprovenLostIncome(victim, wageLostIncome("소득 금액 증명 곤란(유직자)", wage, victim.daysOffWork, UNPROVEN_EARNER.basis));
  }
  if (code === "lost_income" && victim.daysOffWork !== null && victim.monthlyIncome !== null) {
    const days = ASSUMPTIONS.daysPerMonth.value;
    // 월소득 × 휴업일수 × 85 / (30 × 100), 원 미만 버림
    const amount = Math.floor((victim.monthlyIncome * victim.daysOffWork * LOST_INCOME.ratePercent) / (days * 100));
    const formula = `월소득 ${won(victim.monthlyIncome)} ÷ ${days}일 × 휴업 ${victim.daysOffWork}일 × ${LOST_INCOME.ratePercent}% = ${won(amount)} (${cite(LOST_INCOME.basis)}; 한 달을 ${days}일로 보고 계산, 원 미만 버림)`;
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

/** 무직자·유아·학생·연금생활자 등은 수입 감소가 없는 것으로 한다 */
function noLossValue(victim: Victim): Value {
  const who = victim.occupation === "unemployed" ? "무직자" : "유아·연소자·학생·연금생활자 등";
  return { amount: 0, source: "약관 기준", formula: `${who}는 수입의 감소가 없는 것으로 함: 0원 (${cite(NO_LOSS_OCCUPATIONS.basis)})` };
}

function cite(basis: { source: string; page: number }) {
  return `${basis.source}, 인쇄 ${basis.page}쪽`;
}

/** 항목 하나에 쓸 값. null이면 "입력 필요" */
export function pickValue(item: LossItem, mode: ValueMode, victim?: Victim, date: string = STANDARDS_AS_OF): Value | null {
  if (item.confirmed !== null) return { amount: item.confirmed, source: "서류", formula: `서류 금액 ${won(item.confirmed)}${item.evidence ? ` (${item.evidence})` : ""}` };
  if (mode === "confirmed") return null;
  if (item.estimated !== null) {
    const source = item.source.estimated === "policy_standard" ? "약관 기준" : item.source.estimated === "app_default" ? "앱 기본값" : "사용자 추정";
    const value = { amount: item.estimated, source, formula: `${source} ${won(item.estimated)}` };
    // 사용자가 넣은 휴업손해 추정액에도 같은 증명 요건을 적용한다. 서류 금액(confirmed)은 증명된 것으로 본다.
    if (item.code === "lost_income" && victim && (victim.occupation === "unemployed" || victim.occupation === "no_income")) return noLossValue(victim);
    return item.code === "lost_income" && victim ? unprovenLostIncome(victim, value) : value;
  }
  return victim ? standardValue(item.code, victim, date) : null;
}

export type PersonLoss = { ledger: Ledger; actualLoss: number; missing: string[]; notes: string[]; unclassified: boolean; details: LossDetail[] };

function lossLine(item: string, category: LossLine["category"], amount: number, medical: boolean, guaranteed: boolean, label: string): LossLine {
  return { item, category, label, status: "calculated", amount: same(amount), formula: "", ruleIds: [], missing: [], flags: [], required: false, medical, guaranteed };
}

export function personLoss(victim: Victim, mode: ValueMode, date: string = STANDARDS_AS_OF): PersonLoss {
  const lines: LossLine[] = [];
  const missing: string[] = [];
  const notes: string[] = [];
  const details: LossDetail[] = [];
  for (const item of victim.losses) {
    const def = lossItemDef(item.code);
    if (!def || def.target !== "person" || def.category === "property") continue;
    const value = pickValue(item, mode, victim, date);
    if (value === null) {
      missing.push(item.code);
      if (item.code === "lost_income" && mode === "with_estimates" && (victim.occupation === "homemaker" || victim.incomeAmountProven === false) && dailyWageFor(date) === null)
        notes.push(`이 휴업손해는 월 일용근로자 임금 ÷ 30 × 85% × 휴업일수입니다(${cite(HOMEMAKER.basis)}). 사고일(${date})에 적용할 일용근로자 임금 값이 아직 없습니다. 금액을 직접 넣어 주세요.`);
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
  repairCap(property, byCode, notes, details);
  const total = Object.values(byCode).reduce((sum, amount) => sum + amount, 0);
  return { total, byCode, missing, notes, details };
}

/** 별표2 대물배상 1. 수리비용 나.(3) 한도와 2. 교환가액(개인용 인쇄 80쪽) */
export const REPAIR_CAP_BASIS = "별표2 대물배상 지급기준 1. 수리비용 나.(3)·2. 교환가액(개인용 인쇄 80쪽)";

/**
 * 라운드 9: 차량의 수리비용 한도를 앱이 판단한다. 사고 직전 가액(증권의 차량가액 또는 앱 추정)이 있을 때만.
 * - 수리비용이 사고 직전 가액의 120%를 넘으면 전부손해로 보고 사고 직전 가액으로 계산한다(교환가액).
 * - 사고 직전 가액은 넘지만 120% 이하이면 금액은 그대로 두고 '전부손해 가능성'만 알린다(수리하지 않고 폐차하면 교환가액).
 * 130% 한도(내용연수가 지난 차 등)는 판단하지 않는다. 교환가액 항목을 직접 넣었으면 손대지 않는다.
 */
function repairCap(property: Property, byCode: Record<string, number>, notes: string[], details: LossDetail[]) {
  const value = property.valueAtAccident;
  const repair = byCode.repair;
  if (property.role === "counterparty_property" || value === null || value <= 0 || repair === undefined || byCode.replacement_value !== undefined) return;
  const cap = Math.floor((value * 120) / 100);
  const source = property.valueSource === "estimate" ? "앱 추정" : "증권 차량가액";
  if (repair > cap) {
    byCode.repair = value;
    const detail = details.find((d) => d.code === "repair");
    if (detail) Object.assign(detail, { amount: value, formula: `수리비용 ${won(repair)} > 사고 직전 가액 ${won(value)}(${source})의 120% ${won(cap)} → 전부손해로 보고 사고 직전 가액 ${won(value)}` });
    notes.push(`전부손해 가능성: 수리비용이 사고 직전 가액의 120%를 넘어 사고 직전 가액 ${won(value)}(${source})으로 계산했습니다. 근거: ${REPAIR_CAP_BASIS}`);
  } else if (repair > value) notes.push(`전부손해 가능성: 수리비용 ${won(repair)}이 사고 직전 가액 ${won(value)}(${source})을 넘습니다. 수리하지 않고 폐차하면 교환가액(사고 직전 가액)으로 보상합니다. 근거: ${REPAIR_CAP_BASIS}`);
}
