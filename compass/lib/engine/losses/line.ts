import { same } from "../range";
import type { LossCategory, LossLine, MissingInfo, Notice, Range } from "../types";

// 손해 장부의 줄을 만드는 작은 함수들.

type Base = { item: string; category: LossCategory; label: string; required?: boolean; medical?: boolean; guaranteed?: boolean };

function base(b: Base) {
  return { item: b.item, category: b.category, label: b.label, required: b.required ?? false, medical: b.medical ?? false, guaranteed: b.guaranteed ?? false, flags: [] as Notice[] };
}

export function calculated(b: Base, amount: Range | number, formula: string, ruleIds: string[] = [], flags: Notice[] = []): LossLine {
  return { ...base(b), status: "calculated", amount: typeof amount === "number" ? same(amount) : amount, formula, ruleIds, missing: [], flags };
}

/** 입력이 없어 계산하지 못한 줄. 0원이 아니다 */
export function missing(b: Base, info: MissingInfo[], ruleIds: string[] = []): LossLine {
  return { ...base(b), status: "missing", amount: null, formula: info.map((m) => m.message).join(" / "), ruleIds, missing: info };
}

/** 규칙 값이 없어 계산하지 못한 줄 */
export function needsCheck(b: Base, formula: string, ruleIds: string[], flags: Notice[] = []): LossLine {
  return { ...base(b), status: "needs_check", amount: null, formula, ruleIds, missing: [], flags };
}

export function notApplicable(b: Base, formula: string, ruleIds: string[] = []): LossLine {
  return { ...base(b), status: "not_applicable", amount: null, formula, ruleIds, missing: [] };
}
