import type { PersonClaim } from "@/lib/schemas/person-claim";
import { deathLosses } from "./losses/death";
import { disabilityLosses } from "./losses/disability";
import { injuryLosses } from "./losses/injury";
import { calculated, notApplicable } from "./losses/line";
import { won } from "./range";
import type { Rules } from "./rules";
import { CATEGORIES, NOTICES, type ByCategory, type Ledger, type LossCategory, type LossLine, type MissingInfo, type Scenario } from "./types";

// 사람별 손해 장부. 손해 항목은 여기서 한 번만 만든다.
// 담보 모듈은 이 장부의 항목에 한도·과실·공제를 적용할 뿐, 손해를 새로 만들지 않는다.

export function buildLedger(person: PersonClaim, accidentDate: string, rules: Rules): Ledger {
  const [injury, disability] = mergeSolatium(injuryLosses(person, rules), disabilityLosses(person, accidentDate, rules), rules);
  return { lines: [...injury, ...disability, ...deathLosses(person, rules)] };
}

/**
 * 부상 위자료와 후유장애 위자료가 함께 생길 때의 처리.
 * - 최소·예상: 둘 중 큰 금액 하나만. 그 금액을 후유장애 위자료 줄에 두고 부상 위자료는 따로 더하지 않는다.
 * - 최대: 둘 다 더한다(규칙이 그렇게 정한 경우). 더해지는 쪽(둘 중 작은 금액)을 부상 위자료 줄의 최대값에 둔다.
 *   부상 위자료가 더 클 때는 구분(부상·후유장애)별 금액이 "둘 다 합산"과 서로 바뀌어 있지만 합은 같다.
 */
function mergeSolatium(injury: LossLine[], disability: LossLine[], rules: Rules): [LossLine[], LossLine[]] {
  const fromInjury = injury.find((line) => line.item === "solatium_injury");
  const fromDisability = disability.find((line) => line.item === "solatium_disability");
  if (fromInjury?.status !== "calculated" || fromDisability?.status !== "calculated" || !fromInjury.amount || !fromDisability.amount) return [injury, disability];

  const used = ["solatium.disability.overlap"];
  const sumAtMax = rules.text("solatium.disability.overlapMax", used) === "sum_both";
  const injuryAmount = fromInjury.amount.expected;
  const disabilityAmount = fromDisability.amount.expected;
  const larger = Math.max(injuryAmount, disabilityAmount);
  const smaller = Math.min(injuryAmount, disabilityAmount);

  const mergedDisability =
    injuryAmount > disabilityAmount
      ? calculated({ ...fromDisability }, larger, `${fromDisability.formula}. 부상 위자료 ${won(injuryAmount)}이 더 많아 그 금액을 후유장애 위자료로 지급`, fromDisability.ruleIds)
      : fromDisability;
  const mergedInjury =
    sumAtMax && smaller > 0
      ? calculated(
          { ...fromInjury },
          { min: 0, expected: 0, max: smaller },
          `${fromInjury.formula}. 후유장애 위자료와 겹침: 최소·예상은 큰 금액 ${won(larger)} 하나만(여기서는 0원), 최대는 둘 다 합산(${won(smaller)} 더함). ${NOTICES.interpretation_varies}`,
          [...fromInjury.ruleIds, ...used],
          ["interpretation_varies"],
        )
      : notApplicable({ ...fromInjury }, `${fromInjury.formula}. 후유장애 위자료와 겹치므로 따로 더하지 않습니다`, [...fromInjury.ruleIds, ...used]);
  return [injury.map((line) => (line === fromInjury ? mergedInjury : line)), disability.map((line) => (line === fromDisability ? mergedDisability : line))];
}

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
