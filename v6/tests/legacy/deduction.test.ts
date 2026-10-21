import { describe, expect, it } from "vitest";
import { liabilityBodily1 } from "@/lib/engine/legacy/coverages/liability-bodily-1";
import { makeDeduction } from "@/lib/engine/legacy/deduction";
import { excessOverCompulsory } from "@/lib/engine/legacy/fault";
import { at, injuryClaim } from "./helpers";

// 중복 차감: 자동차상해·자기신체사고에서 앞 순위 담보(대인Ⅰ·Ⅱ·무보험자동차상해)와 제3자 기수령액을 뺀다.
// 사례와 기대값은 compass/tests/person-coverage.test.ts(9급 30% 112–123, 무보험 5급 204–217, 상대 대인Ⅱ 미확인 436–447)를 옮겼다.

describe("자동차상해 공제액", () => {
  it("9급 과실 30%, 상대 대인Ⅱ 무한: 공제 2,226,000 (자동차상해 3,180,000 − 2,226,000 = 954,000)", () => {
    const claim = injuryClaim({ grade: 9, faultPercent: 30, medical: 2_000_000, other: 1_180_000 });
    const bodily1 = liabilityBodily1(claim);
    const bodily2 = excessOverCompulsory(claim, at(bodily1), "unlimited", 0, "대인배상Ⅱ 가입금액");
    const { deductionFor, deductionUnknown } = makeDeduction({
      claim,
      liable: { status: "full", bodily2Limit: "unlimited" },
      noLiableParty: null,
      uninsuredApplies: false,
      ownUninsured: { limit: 200_000_000 },
      bodily1,
      bodily2,
      uninsured: null,
    });
    expect(deductionFor("expected")).toEqual({ amounts: { injury: 2_226_000, disability: 0, death: 0 }, unknown: false });
    expect(deductionUnknown).toBe(false);
  });

  it("무보험 5급: 대인Ⅰ 9,000,000 + 무보험자동차상해 3,388,360 = 12,388,360 (자동차상해 0)", () => {
    const claim = injuryClaim({ grade: 5, faultPercent: 0, medical: 9_000_000, other: 3_388_360 });
    const bodily1 = liabilityBodily1(claim);
    const uninsured = excessOverCompulsory(claim, at(bodily1), 200_000_000, 0, "무보험자동차상해 가입금액");
    const { deductionFor } = makeDeduction({
      claim,
      liable: { status: "mandatory_only", bodily2Limit: null },
      noLiableParty: null,
      uninsuredApplies: true,
      ownUninsured: { limit: 200_000_000 },
      bodily1,
      bodily2: null,
      uninsured,
    });
    expect(deductionFor("expected").amounts.injury).toBe(12_388_360);
  });

  it("상대 대인Ⅱ 가입금액을 모르면 최소에서만 무한으로 가정해 크게 공제하고, 예상은 확인된 대인Ⅰ만 뺀다", () => {
    const claim = injuryClaim({ grade: 14, faultPercent: 0, medical: 800_000, other: 230_000 });
    const bodily1 = liabilityBodily1(claim);
    const { deductionFor, deductionUnknown } = makeDeduction({
      claim,
      liable: { status: "full", bodily2Limit: null },
      noLiableParty: null,
      uninsuredApplies: false,
      ownUninsured: null,
      bodily1,
      bodily2: null,
      uninsured: null,
    });
    expect(deductionFor("min").amounts.injury).toBe(1_030_000);
    expect(deductionFor("expected").amounts.injury).toBe(500_000);
    expect(deductionUnknown).toBe(true);
  });

  it("배상받을 상대가 없으면 앞 순위 공제는 없고, 제3자에게서 받은 금액만 남은 손해에서 뺀다", () => {
    const claim = injuryClaim({ grade: 7, faultPercent: 100, medical: 5_500_000, other: 424_000, thirdParty: 500_000 });
    const { deductionFor, deductionUnknown } = makeDeduction({
      claim,
      liable: { status: "no_counterparty", bodily2Limit: null },
      noLiableParty: "상대 차량이 없는 사고라 배상받을 상대가 없습니다",
      uninsuredApplies: false,
      ownUninsured: null,
      bodily1: null,
      bodily2: null,
      uninsured: null,
    });
    expect(deductionFor("expected")).toEqual({ amounts: { injury: 500_000, disability: 0, death: 0 }, unknown: false });
    expect(deductionUnknown).toBe(false);
  });
});
