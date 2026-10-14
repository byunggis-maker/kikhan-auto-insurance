import type { RuleItem } from "@/lib/schemas/rules";
import { multiply, type Factor, type Rounding } from "./decimal";
import type { RuleRef } from "./types";

// 규칙 묶음에서 사고일에 맞는 항목을 꺼낸다. 엔진은 지급기준 숫자를 여기서만 얻는다.

export type Rules = {
  /** 값을 꺼내고, 쓴 규칙 id를 used에 적는다. 사고일에 맞는 항목이 없거나 값이 비어 있으면 null */
  number(id: string, used: string[]): number | null;
  text(id: string, used: string[]): string | null;
  flag(id: string, used: string[]): boolean | null;
  list<T>(id: string, used: string[]): T[] | null;
  record(id: string, used: string[]): Record<string, number> | null;
  rounding(): Rounding | null;
  ref(id: string): RuleRef;
};

function basisText(item: RuleItem) {
  const { source, appendix, clause } = item.basis;
  return `${source} · ${appendix} ${clause}`;
}

/** date(사고일)에 시행 중인 규칙만 쓴다. 사고일 뒤에 시행된 규칙은 쓰지 않는다 */
export function openRules(items: RuleItem[], date: string): Rules {
  const active = new Map<string, RuleItem>();
  for (const item of items) if (item.effectiveFrom <= date && (item.effectiveTo === null || date <= item.effectiveTo)) active.set(item.id, item);

  function value(id: string, used: string[]) {
    if (!used.includes(id)) used.push(id);
    return active.get(id)?.value ?? null;
  }
  return {
    number(id, used) {
      const v = value(id, used);
      return typeof v === "number" && Number.isSafeInteger(v) ? v : null;
    },
    text(id, used) {
      const v = value(id, used);
      return typeof v === "string" ? v : null;
    },
    flag(id, used) {
      const v = value(id, used);
      return typeof v === "boolean" ? v : null;
    },
    list<T>(id: string, used: string[]) {
      const v = value(id, used);
      return Array.isArray(v) ? (v as T[]) : null;
    },
    record(id, used) {
      const v = value(id, used);
      return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
    },
    rounding() {
      const v = active.get(ROUNDING_RULE)?.value;
      return v === "floor" || v === "round" || v === "ceil" ? v : null;
    },
    ref(id) {
      const item = active.get(id);
      if (!item) return { id, status: "needs_check", basis: `사고일에 맞는 규칙이 없습니다 (${id})` };
      return { id, status: item.value === null ? "needs_check" : item.status, basis: basisText(item) };
    },
  };
}

export const ROUNDING_RULE = "rounding.won";

/**
 * amount에 분수들을 곱해 원 단위 정수로 만든다. 원 미만이 실제로 생겼을 때만 원 미만 처리 규칙을 used에 적는다.
 * 원 미만이 생겼는데 처리 규칙이 없으면 null.
 */
export function scale(rules: Rules, used: string[], amount: number, factors: Factor[]): number | null {
  const result = multiply(amount, factors, rules.rounding());
  if ((result === null || !result.exact) && !used.includes(ROUNDING_RULE)) used.push(ROUNDING_RULE);
  return result?.won ?? null;
}
