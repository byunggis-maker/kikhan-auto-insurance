import { lossItemDef } from "@/lib/claim/lossItems";
import { FUNERAL, INJURY_SOLATIUM } from "@/lib/claim/standards";
import type { LossItem, Property, Victim } from "@/lib/claim/types";
import { same } from "./legacy/range";
import type { Ledger, LossLine } from "./legacy/types";
import type { ValueMode } from "./types";

// MASTER.md 6장 (3) 손해액 정리와 5장 확정/추정 값 고르기.
// - 확정 계산: confirmed만 쓴다.
// - 추정 포함 계산: confirmed가 빈 칸만 estimated로 채운다. 둘 다 비어 있으면 약관이 금액을 정한 항목(부상 위자료·장례비)은 약관 기준으로 채운다.
// - 셋 다 없으면 "입력 필요"로 남기고 합계에 넣지 않는다.
// - 항목 없이 합계(userTotal)만 있으면 "항목 미분류 손해(추정)"로 넣고, 치료관계비 하한은 적용하지 않는다.

export const UNCLASSIFIED = "unclassified";

/** 항목 하나에 쓸 값. null이면 "입력 필요" */
export function pickValue(item: LossItem, mode: ValueMode, victim?: Victim): { amount: number; source: string } | null {
  if (item.confirmed !== null) return { amount: item.confirmed, source: "서류" };
  if (mode === "confirmed") return null;
  if (item.estimated !== null) return { amount: item.estimated, source: item.source.estimated === "policy_standard" ? "약관 기준" : item.source.estimated === "app_default" ? "앱 기본값" : "사용자 추정" };
  if (item.code === "solatium_injury" && victim?.injuryGrade != null) return { amount: INJURY_SOLATIUM.value[victim.injuryGrade], source: `약관 기준(${INJURY_SOLATIUM.basis.source})` };
  if (item.code === "funeral") return { amount: FUNERAL.value, source: `약관 기준(${FUNERAL.basis.source})` };
  return null;
}

export type PersonLoss = { ledger: Ledger; actualLoss: number; missing: string[]; notes: string[]; unclassified: boolean };

function lossLine(item: string, category: LossLine["category"], amount: number, medical: boolean, guaranteed: boolean, label: string): LossLine {
  return { item, category, label, status: "calculated", amount: same(amount), formula: "", ruleIds: [], missing: [], flags: [], required: false, medical, guaranteed };
}

export function personLoss(victim: Victim, mode: ValueMode): PersonLoss {
  const lines: LossLine[] = [];
  const missing: string[] = [];
  const notes: string[] = [];
  for (const item of victim.losses) {
    const def = lossItemDef(item.code);
    if (!def || def.target !== "person" || def.category === "property") continue;
    const value = pickValue(item, mode, victim);
    if (value === null) {
      missing.push(item.code);
      continue;
    }
    if (item.code === "future_treatment" && victim.injuryGrade !== null && victim.injuryGrade > 11) {
      notes.push(`향후치료비는 상해 1~11급만 인정합니다(별표1 나. 1. 다.). ${victim.injuryGrade}급이라 ${value.amount.toLocaleString("ko-KR")}원을 넣지 않았습니다.`);
      continue;
    }
    lines.push(lossLine(item.code, def.category, value.amount, def.medical, def.guaranteed, def.label));
  }
  let unclassified = false;
  if (victim.losses.length === 0 && victim.userTotal !== null && mode === "with_estimates") {
    // 치료관계비인지 알 수 없으므로 medical·guaranteed가 아니다 → 치료관계비 하한을 적용하지 않는다.
    lines.push(lossLine(UNCLASSIFIED, victim.died ? "death" : "injury", victim.userTotal, false, false, "항목 미분류 손해(추정)"));
    unclassified = true;
    notes.push("항목 미분류 손해(추정)로 계산했습니다. 치료관계비 하한은 적용하지 않았습니다. 항목을 나누면 더 정확해집니다.");
  }
  const actualLoss = lines.reduce((sum, line) => sum + (line.amount?.expected ?? 0), 0);
  if (!unclassified && victim.userTotal !== null && victim.losses.length > 0 && mode === "with_estimates" && victim.userTotal !== actualLoss)
    notes.push(`직접 넣은 합계 ${victim.userTotal.toLocaleString("ko-KR")}원과 항목 합계 ${actualLoss.toLocaleString("ko-KR")}원이 ${Math.abs(victim.userTotal - actualLoss).toLocaleString("ko-KR")}원 다릅니다. 계산은 항목 합계로 했습니다.`);
  return { ledger: { lines }, actualLoss, missing, notes, unclassified };
}

export type PropertyLoss = { total: number; byCode: Record<string, number>; missing: string[]; notes: string[] };

export function propertyLoss(property: Property, mode: ValueMode): PropertyLoss {
  const byCode: Record<string, number> = {};
  const missing: string[] = [];
  const notes: string[] = [];
  for (const item of property.losses) {
    const value = pickValue(item, mode);
    if (value === null) missing.push(item.code);
    else byCode[item.code] = (byCode[item.code] ?? 0) + value.amount;
  }
  if (property.losses.length === 0 && property.userTotal !== null && mode === "with_estimates") {
    byCode[UNCLASSIFIED] = property.userTotal;
    notes.push("항목 미분류 손해(추정)로 계산했습니다. 항목을 나누면 더 정확해집니다.");
  }
  const total = Object.values(byCode).reduce((sum, amount) => sum + amount, 0);
  return { total, byCode, missing, notes };
}
