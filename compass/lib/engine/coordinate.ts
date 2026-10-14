import type { PersonCoverageInput } from "@/lib/schemas/person-claim";
import type { RuleItem } from "@/lib/schemas/rules";
import { autoInjury, type Deduction } from "./coverages/auto-injury";
import { liabilityBodily1 } from "./coverages/liability-bodily-1";
import { liabilityBodily2 } from "./coverages/liability-bodily-2";
import { selfInjury } from "./coverages/self-injury";
import { uninsuredMotorist } from "./coverages/uninsured";
import { makeCell, unique, type CellParts } from "./cell";
import type { Claim } from "./fault";
import { buildLedger, lossByCategory, optionalGaps } from "./loss-ledger";
import { openRules } from "./rules";
import { CATEGORIES, type ByCategory, type CellLine, type Computation, type CoverageCell, type CoverageKey, type Ledger, type MissingInfo, type Scenario } from "./types";

// 담보 사이의 관계를 처리하는 유일한 곳.
//
// 한 사람의 같은 손해를 여러 담보가 보상할 수 있으므로, 아래 순서로 계산하고 뒤 담보는 앞 담보의 금액을 뺀다.
//   ① 대인배상Ⅰ  : 가해 차량의 책임보험. 구분별(부상·후유장애·사망) 한도.
//   ② 대인배상Ⅱ  : ①을 넘는 부분. 가해 차량이 가입했을 때만.
//   ③ 무보험자동차상해 : 가해 차량이 대인배상Ⅱ가 없을 때(책임보험만·무보험·뺑소니) 내 보험이 ①을 넘는 부분을 보상.
//   ④ 자동차상해 또는 자기신체사고 : 내 보험. ①②③에서 받을 수 있는 금액과 제3자에게서 받은 금액을 공제.
// 이렇게 하면 칸들의 금액이 서로 겹치지 않으므로, 계산된 칸은 모두 합계에 넣을 수 있다.
//
// 이 파일이 다루지 않는 것: 내 차 동승자가 내 보험의 대인배상으로 보상받는 경우와 동승자 감액,
// 상대방 대인배상Ⅱ의 한도를 넘는 손해에 대한 무보험자동차상해, 여러 사람이 한도를 나눠 쓰는 경우.

export type PersonCoverageResult = {
  personId: string;
  /** mine: 내가(내 쪽 사람이) 받을 금액, others: 상대방 쪽 사람에게 지급될 금액. 두 묶음은 서로 더하지 않는다 */
  recipientGroup: "mine" | "others";
  ledger: Ledger;
  cells: CoverageCell[];
};

const ZERO: ByCategory = { injury: 0, disability: 0, death: 0 };


export function calculatePersonCoverages(input: PersonCoverageInput, ruleItems: RuleItem[]): PersonCoverageResult {
  const { person, accidentDate, liable, own } = input;
  const rules = openRules(ruleItems, accidentDate);
  const ledger = buildLedger(person, accidentDate, rules);
  const claim: Claim = { person, accidentDate, ledger, rules };

  const lossLines: CellLine[] = ledger.lines.map((line) => ({ kind: "loss", item: line.item, label: line.label, amount: line.amount, formula: line.formula, ruleIds: line.ruleIds, flags: line.flags }));
  const ledgerFlags = ledger.lines.flatMap((line) => line.flags);
  const ledgerRuleIds = ledger.lines.filter((line) => line.status !== "missing").flatMap((line) => line.ruleIds);
  const partial = ledger.lines.some((line) => !line.required && (line.status === "missing" || line.status === "needs_check"));

  const finish = (coverage: CoverageKey, cell: CellParts, ruleIds: string[]) => makeCell(rules, coverage, cell, ruleIds);
  const notApplicable = (coverage: CoverageKey, reason: string) => finish(coverage, { status: "not_applicable", amount: null, lines: [], missing: [], flags: [], reason }, []);
  const insufficient = (coverage: CoverageKey, missing: MissingInfo[]) =>
    finish(coverage, { status: "insufficient_info", amount: null, lines: lossLines, missing, flags: [], reason: `정보 부족: ${missing.map((m) => m.message).join(" / ")}` }, []);
  /** withLedger: 손해 장부의 항목으로 계산한 칸인지. 정해진 금액을 주는 칸은 장부의 줄을 붙이지 않는다 */
  function fromComputation(coverage: CoverageKey, computation: Computation, flags: string[] = [], withLedger = true): CoverageCell {
    if (!computation.ok) {
      if (computation.status === "insufficient_info") return insufficient(coverage, computation.missing);
      return finish(coverage, { status: "needs_check", amount: null, lines: lossLines, missing: [], flags, reason: `약관 확인 필요: ${computation.reason}` }, computation.ruleIds);
    }
    return finish(
      coverage,
      {
        status: "calculated",
        amount: computation.total,
        lines: withLedger ? [...lossLines, ...computation.steps] : computation.steps,
        missing: withLedger ? optionalGaps(ledger) : [],
        flags: unique([...flags, ...computation.flags, ...(withLedger ? ledgerFlags : []), ...(withLedger && partial ? ["partial"] : [])]),
        reason: null,
      },
      [...(withLedger ? ledgerRuleIds : []), ...computation.ruleIds],
    );
  }

  const coverages: CoverageKey[] = own ? ["liability_bodily_1", "liability_bodily_2", "uninsured", "auto_injury", "self_injury"] : ["liability_bodily_1", "liability_bodily_2"];
  if (ledger.lines.length === 0)
    return {
      personId: person.id,
      recipientGroup: input.side,
      ledger,
      cells: coverages.map((coverage) => insufficient(coverage, [{ field: "injury", message: "다친 내용(부상·후유장애·사망)을 입력하면 계산됩니다" }])),
    };

  // ── ①② 가해 차량의 대인배상 ──
  const noLiableParty =
    liable.status === "no_counterparty" ? "상대 차량이 없는 사고라 배상받을 상대가 없습니다" : person.faultPercent === 100 ? "이 사람의 과실이 100%라 상대방에게 배상책임이 없습니다" : null;
  const statusUnknown: MissingInfo[] = [{ field: "liable.status", message: "상대 차량의 보험 가입 여부를 입력하면 계산됩니다" }];
  const bodily1 = noLiableParty ? null : liabilityBodily1(claim);
  const at = (computation: Computation | null, scenario: Scenario): ByCategory =>
    computation?.ok ? { injury: computation.byCategory.injury[scenario], disability: computation.byCategory.disability[scenario], death: computation.byCategory.death[scenario] } : ZERO;
  const bodily1At = (scenario: Scenario) => at(bodily1, scenario);

  let cell1: CoverageCell;
  if (noLiableParty || bodily1 === null) cell1 = notApplicable("liability_bodily_1", noLiableParty ?? "");
  else if (liable.status === "unknown") cell1 = insufficient("liability_bodily_1", statusUnknown);
  // 무보험·뺑소니 차량이면 같은 한도로 정부보장사업이 보상한다.
  else cell1 = fromComputation("liability_bodily_1", bodily1, liable.status === "none" || liable.status === "hit_and_run" ? ["government_guarantee"] : []);

  let bodily2: Computation | null = null;
  let cell2: CoverageCell;
  if (noLiableParty || bodily1 === null) cell2 = notApplicable("liability_bodily_2", noLiableParty ?? "");
  else if (liable.status === "unknown") cell2 = insufficient("liability_bodily_2", statusUnknown);
  else if (liable.status !== "full") cell2 = notApplicable("liability_bodily_2", "가해 차량이 대인배상Ⅱ에 가입하지 않았습니다");
  else if (!bodily1.ok) cell2 = fromComputation("liability_bodily_2", bodily1);
  else if (liable.bodily2Limit === null)
    cell2 = insufficient("liability_bodily_2", [
      input.side === "mine"
        ? { field: "liable.bodily2Limit", message: "상대방 계약 확인 필요: 상대방의 대인배상Ⅱ 가입금액을 입력하면 계산됩니다" }
        : { field: "liable.bodily2Limit", message: "내 증권의 대인배상Ⅱ 가입금액을 입력하면 계산됩니다" },
    ]);
  else {
    bodily2 = liabilityBodily2(claim, bodily1At, liable.bodily2Limit);
    cell2 = fromComputation("liability_bodily_2", bodily2);
  }
  if (!own) return { personId: person.id, recipientGroup: input.side, ledger, cells: [cell1, cell2] };

  // ── ③ 무보험자동차에 의한 상해 ──
  const uninsuredApplies = !noLiableParty && (liable.status === "mandatory_only" || liable.status === "none" || liable.status === "hit_and_run");
  let uninsured: Computation | null = null;
  let cell3: CoverageCell;
  if (own.uninsured === null) cell3 = notApplicable("uninsured", "가입하지 않은 담보입니다");
  else if (noLiableParty || bodily1 === null) cell3 = notApplicable("uninsured", noLiableParty ?? "");
  else if (liable.status === "unknown") cell3 = insufficient("uninsured", statusUnknown);
  else if (!uninsuredApplies) cell3 = notApplicable("uninsured", "상대 차량이 대인배상Ⅱ에 가입해 있어 무보험자동차가 아닙니다");
  else if (!bodily1.ok) cell3 = fromComputation("uninsured", bodily1);
  else if (own.uninsured.limit === null) cell3 = insufficient("uninsured", [{ field: "own.uninsured.limit", message: "무보험자동차상해 가입금액을 입력하면 계산됩니다" }]);
  else {
    uninsured = uninsuredMotorist(claim, bodily1At, own.uninsured.limit, person.receivedFromLiableParty ?? 0);
    cell3 = fromComputation("uninsured", uninsured);
  }

  // ── ④ 내 보험의 자동차상해 / 자기신체사고: 공제액 ──
  // 공제액을 모르는 부분이 있으면 "최소"에서만 가장 크게 공제될 경우(대인배상Ⅱ 무한)를 가정하고, 예상·최대는 확인된 금액만 뺀다.
  const thirdParty = person.receivedFromThirdParty ?? 0;
  const secondLayerUnknown =
    !noLiableParty &&
    (liable.status === "unknown" || (liable.status === "full" && liable.bodily2Limit === null) || (uninsuredApplies && own.uninsured !== null && own.uninsured.limit === null));
  // 무보험자동차상해에 가입하지 않았거나 그 금액을 계산하지 못했으면 그 부분은 공제하지 않는다.
  const assumedFull = secondLayerUnknown && bodily1?.ok ? liabilityBodily2(claim, bodily1At, "unlimited") : null;
  const deductionUnknown = !noLiableParty && (bodily1 === null || !bodily1.ok || secondLayerUnknown || (bodily2 !== null && !bodily2.ok) || (uninsured !== null && !uninsured.ok));

  function deductionFor(scenario: Scenario): Deduction {
    const amounts: ByCategory = { ...ZERO };
    let unknown = false;
    if (!noLiableParty) {
      if (bodily1 === null || !bodily1.ok || (bodily2 !== null && !bodily2.ok) || (uninsured !== null && !uninsured.ok)) unknown = scenario === "min";
      else {
        const known = liable.status === "unknown" ? [] : [bodily1At(scenario), at(bodily2, scenario), at(uninsured, scenario)];
        const assumed = scenario === "min" && secondLayerUnknown ? (assumedFull?.ok ? [bodily1At(scenario), at(assumedFull, scenario)] : null) : [];
        if (assumed === null) unknown = true;
        for (const part of [...known, ...(assumed ?? [])]) for (const category of CATEGORIES) amounts[category] += part[category];
        // 같은 대인배상Ⅰ 금액을 두 번 더하지 않는다.
        if (known.length > 0 && assumed && assumed.length > 0) for (const category of CATEGORIES) amounts[category] -= bodily1At(scenario)[category];
      }
    }
    // 제3자에게서 받은 금액은 부상 → 후유장애 → 사망 순서로 남은 손해에서 뺀다.
    const loss = lossByCategory(ledger, scenario);
    let left = thirdParty;
    for (const category of CATEGORIES) {
      const room = Math.min(left, Math.max(0, loss[category] - amounts[category]));
      amounts[category] += room;
      left -= room;
    }
    amounts.injury += left;
    return { amounts, unknown };
  }
  const ownFlags = deductionUnknown ? ["deduction_unknown"] : [];
  const mayHaveDeduction = !noLiableParty || thirdParty > 0;

  let cell4: CoverageCell;
  let cell5: CoverageCell;
  if (own.autoInjury) {
    cell4 = fromComputation("auto_injury", autoInjury(claim, own.autoInjury, deductionFor), ownFlags);
    cell5 = notApplicable("self_injury", own.selfInjury ? "자동차상해 특별약관이 자기신체사고를 대체합니다" : "가입하지 않은 담보입니다");
  } else {
    cell4 = notApplicable("auto_injury", "가입하지 않은 담보입니다");
    cell5 = own.selfInjury ? fromComputation("self_injury", selfInjury(claim, own.selfInjury, deductionFor, mayHaveDeduction), ownFlags, mayHaveDeduction) : notApplicable("self_injury", "가입하지 않은 담보입니다");
  }
  return { personId: person.id, recipientGroup: input.side, ledger, cells: [cell1, cell2, cell3, cell4, cell5] };
}
