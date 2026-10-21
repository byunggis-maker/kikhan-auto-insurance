// 이식 원본: compass/lib/engine/loss-ledger.ts 53–90행만 (compass 커밋 e58ffd1).
// 1–51행(buildLedger·mergeSolatium)은 V2 손해 산정(losses/*)을 부르므로 이식하지 않았다. import는 남은 함수에 필요한 것만 둔다.
// MASTER.md 6장 이식 로직(부록 A). 아직 v6 엔진에 연결하지 않았다.
import { CATEGORIES, type ByCategory, type Ledger, type LossCategory, type LossLine, type MissingInfo, type Scenario } from "./types";

export function hasCategory(ledger: Ledger, category: LossCategory) {
  return ledger.lines.some((line) => line.category === category);
}

function sum(lines: LossLine[], scenario: Scenario) {
  return lines.reduce((total, line) => total + (line.status === "calculated" && line.amount ? line.amount[scenario] : 0), 0);
}

/** 계산된 줄만 더한 구분별 손해액 */
export function lossByCategory(ledger: Ledger, scenario: Scenario): ByCategory {
  const of = (category: LossCategory) => sum(ledger.lines.filter((line) => line.category === category), scenario);
  return { injury: of("injury"), disability: of("disability"), death: of("death") };
}

/** 치료관계비(입원환자 식대 포함) */
export function medicalCost(ledger: Ledger, scenario: Scenario) {
  return sum(ledger.lines.filter((line) => line.medical), scenario);
}

/** 과실상계 뒤에도 보장되는 금액: 치료관계비(식대 포함) + 간병비 */
export function guaranteedCost(ledger: Ledger, scenario: Scenario) {
  return sum(ledger.lines.filter((line) => line.guaranteed), scenario);
}

/** 꼭 필요한 줄이 비어 있으면 그 이유. 없으면 빈 목록 */
export function blockers(ledger: Ledger): { missing: MissingInfo[]; needsCheck: LossLine[] } {
  const required = ledger.lines.filter((line) => line.required);
  return { missing: required.filter((line) => line.status === "missing").flatMap((line) => line.missing), needsCheck: required.filter((line) => line.status === "needs_check") };
}

/** 더하지 못한 선택 항목의 안내. 칸은 계산하되 "이것을 입력하면 더해집니다"로 보여 준다 */
export function optionalGaps(ledger: Ledger): MissingInfo[] {
  return ledger.lines.filter((line) => !(line.required && line.status === "missing")).flatMap((line) => line.missing);
}

export function total(amounts: ByCategory) {
  return CATEGORIES.reduce((sum, category) => sum + amounts[category], 0);
}
