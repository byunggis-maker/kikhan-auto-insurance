// 이식 원본: compass/lib/engine/steps.ts 1–60행 전체 (compass 커밋 e58ffd1). 보조 함수(combine). 바꾼 것: 없음.
// MASTER.md 6장 이식 로직(부록 A). 아직 v6 엔진에 연결하지 않았다.
import { fromScenarios } from "./range";
import { CATEGORIES, SCENARIOS, type ByCategory, type CellLine, type Computation, type LossCategory, type Range, type Scenario } from "./types";

// 담보 모듈은 최소·예상·최대 세 경우를 같은 순서로 따로 계산한다. 여기서 세 결과를 하나로 묶는다.

/** 계산 단계 한 줄(한 경우의 값) */
export type Step = { item: string; label: string; value: number; formula: string; ruleIds: string[] };
export type ScenarioResult = { byCategory: ByCategory; steps: Step[] };

export const CATEGORY_LABELS: Record<LossCategory, string> = { injury: "부상", disability: "후유장애", death: "사망" };

/**
 * 세 경우를 계산해 묶는다. 단계의 식은 "예상"의 것을 보여 준다.
 * 어느 한 경우라도 계산하지 못하면(null) 전체를 "약관 확인 필요"로 돌린다.
 */
export function combine(calculate: (scenario: Scenario) => ScenarioResult | null, ruleIds: string[], flags: string[]): Computation {
  const results = new Map<Scenario, ScenarioResult>();
  for (const scenario of SCENARIOS) {
    const result = calculate(scenario);
    if (result === null) return { ok: false, status: "needs_check", missing: [], ruleIds, reason: "원 미만 처리 방식을 확인하지 못했습니다" };
    results.set(scenario, result);
  }
  const at = (scenario: Scenario) => results.get(scenario) as ScenarioResult;
  const byCategory = Object.fromEntries(CATEGORIES.map((category) => [category, fromScenarios((s) => at(s).byCategory[category])])) as Record<LossCategory, Range>;
  const total = fromScenarios((s) => CATEGORIES.reduce((sum, category) => sum + at(s).byCategory[category], 0));
  const steps: CellLine[] = at("expected").steps.map((step, index) => ({
    kind: "step",
    item: step.item,
    label: step.label,
    amount: fromScenarios((s) => at(s).steps[index].value),
    formula: step.formula,
    ruleIds: step.ruleIds,
    flags: [],
  }));
  return { ok: true, byCategory, total, steps, ruleIds: [...new Set([...ruleIds, ...steps.flatMap((step) => step.ruleIds)])], flags };
}

/**
 * 구분(부상·후유장애·사망)이 없는 담보용. 세 경우를 계산해 금액과 단계를 묶는다.
 * 어느 한 경우라도 계산하지 못하면(null) null을 돌려준다.
 */
export function combineSimple(calculate: (scenario: Scenario) => { value: number; steps: Step[] } | null): { amount: Range; steps: CellLine[] } | null {
  const results = new Map<Scenario, { value: number; steps: Step[] }>();
  for (const scenario of SCENARIOS) {
    const result = calculate(scenario);
    if (result === null) return null;
    results.set(scenario, result);
  }
  const at = (scenario: Scenario) => results.get(scenario) as { value: number; steps: Step[] };
  const steps: CellLine[] = at("expected").steps.map((step, index) => ({
    kind: "step",
    item: step.item,
    label: step.label,
    amount: fromScenarios((s) => at(s).steps[index].value),
    formula: step.formula,
    ruleIds: step.ruleIds,
    flags: [],
  }));
  return { amount: fromScenarios((s) => at(s).value), steps };
}
