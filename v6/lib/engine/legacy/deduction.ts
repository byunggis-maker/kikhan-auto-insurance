// 이식 원본: compass/lib/engine/coordinate.ts 34행(ZERO), 86–88행(at·bodily1At), 131–162행(thirdParty·secondLayerUnknown·assumedFull·deductionUnknown·deductionFor),
//           compass/lib/engine/coverages/auto-injury.ts 14행(Deduction 자료형), compass/lib/engine/coverages/liability-bodily-2.ts 9행(assumedFull 계산) (compass 커밋 e58ffd1).
// 바꾼 것: 원본은 calculatePersonCoverages() 안의 내부 함수(클로저)라, 그 함수가 쓰던 바깥 값을 DeductionContext로 받게 감쌌다.
//          liabilityBodily2(claim, bodily1At, "unlimited")는 원본 liability-bodily-2.ts와 같은 excessOverCompulsory(…, 0, "대인배상Ⅱ 가입금액") 호출로 바꿔 적었다. 계산 식은 바꾸지 않았다.
// MASTER.md 6장 이식 로직(부록 A). 아직 v6 엔진에 연결하지 않았다.
import type { LiableInsurance, Limit } from "./schemas/person-claim";
import { excessOverCompulsory, type Claim } from "./fault";
import { lossByCategory } from "./loss-ledger";
import { CATEGORIES, type ByCategory, type Computation, type Scenario } from "./types";

/** 한 경우의 공제액. unknown이면 공제액을 알 수 없어 전부 공제될 수도 있다는 뜻이다 */
export type Deduction = { amounts: ByCategory; unknown: boolean };

/** 원본 calculatePersonCoverages()에서 deductionFor()가 쓰던 바깥 값 */
export type DeductionContext = {
  claim: Claim;
  liable: LiableInsurance;
  /** 배상받을 상대가 없는 이유(없으면 null). 원본과 같이 문자열이면 "상대 없음"으로 본다 */
  noLiableParty: string | null;
  /** 가해 차량이 대인배상Ⅱ 없이 무보험자동차상해 대상인지 */
  uninsuredApplies: boolean;
  /** 내 보험의 무보험자동차상해. 가입하지 않았으면 null */
  ownUninsured: { limit: Limit | null } | null;
  bodily1: Computation | null;
  bodily2: Computation | null;
  uninsured: Computation | null;
};

const ZERO: ByCategory = { injury: 0, disability: 0, death: 0 };

const at = (computation: Computation | null, scenario: Scenario): ByCategory =>
  computation?.ok ? { injury: computation.byCategory.injury[scenario], disability: computation.byCategory.disability[scenario], death: computation.byCategory.death[scenario] } : ZERO;

/** 자동차상해·자기신체사고에서 뺄 공제액(앞 순위 담보 지급액 + 제3자에게서 받은 금액) */
export function makeDeduction(context: DeductionContext): { deductionFor: (scenario: Scenario) => Deduction; deductionUnknown: boolean } {
  const { claim, liable, noLiableParty, uninsuredApplies, bodily1, bodily2, uninsured } = context;
  const { person, ledger } = claim;
  const own = { uninsured: context.ownUninsured };
  const bodily1At = (scenario: Scenario) => at(bodily1, scenario);

  // 공제액을 모르는 부분이 있으면 "최소"에서만 가장 크게 공제될 경우(대인배상Ⅱ 무한)를 가정하고, 예상·최대는 확인된 금액만 뺀다.
  const thirdParty = person.receivedFromThirdParty ?? 0;
  const secondLayerUnknown =
    !noLiableParty &&
    (liable.status === "unknown" || (liable.status === "full" && liable.bodily2Limit === null) || (uninsuredApplies && own.uninsured !== null && own.uninsured.limit === null));
  // 무보험자동차상해에 가입하지 않았거나 그 금액을 계산하지 못했으면 그 부분은 공제하지 않는다.
  const assumedFull = secondLayerUnknown && bodily1?.ok ? excessOverCompulsory(claim, bodily1At, "unlimited", 0, "대인배상Ⅱ 가입금액") : null;
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

  return { deductionFor, deductionUnknown };
}
