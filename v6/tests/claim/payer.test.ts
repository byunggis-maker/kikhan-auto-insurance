import { describe, expect, it } from "vitest";
import { paymentLabel } from "@/lib/claim/payer";
import { liabilityBodily1 } from "@/lib/engine/legacy/coverages/liability-bodily-1";
import { excessOverCompulsory } from "@/lib/engine/legacy/fault";
import { at, expectOk, injuryClaim } from "../legacy/helpers";

// 지급처와 표시 이름은 v6 연결 계층(lib/claim/payer.ts)이 붙인다. legacy 계산 금액은 그대로다.

describe("지급처", () => {
  it("상대 무보험·뺑소니: 대인Ⅰ은 '대인Ⅰ 상당액(정부보장사업)', 지급처는 정부보장사업", () => {
    for (const status of ["uninsured", "hit_and_run"] as const)
      expect(paymentLabel("liability_bodily_1", "counterparty", status)).toEqual({
        coverage: "liability_bodily_1",
        label: "대인Ⅰ 상당액(정부보장사업)",
        payer: "government",
        basis: "자동차손해배상보장법 제30조(자동차손해배상 보장사업)",
      });
  });

  it("상대가 책임보험만 가입했거나 종합보험이면 대인Ⅰ은 상대 보험", () => {
    expect(paymentLabel("liability_bodily_1", "counterparty", "mandatory_only")).toMatchObject({ label: "대인배상Ⅰ", payer: "counterparty_insurer" });
    expect(paymentLabel("liability_bodily_2", "counterparty", "full")).toMatchObject({ label: "대인배상Ⅱ", payer: "counterparty_insurer" });
  });

  it("내 보험 담보는 내 보험(상대방이 내 대인배상으로 받는 경우 포함)", () => {
    expect(paymentLabel("uninsured", "mine", "uninsured")).toMatchObject({ label: "무보험자동차에 의한 상해", payer: "own_insurer" });
    expect(paymentLabel("liability_bodily_1", "mine", "full")).toMatchObject({ label: "대인배상Ⅰ", payer: "own_insurer" });
  });

  it("무보험 5급 과실 0%: 대인Ⅰ 상당액(정부보장사업) 9,000,000 + 내 무보험자동차상해 3,388,360 (금액은 legacy 그대로)", () => {
    const claim = injuryClaim({ grade: 5, faultPercent: 0, medical: 9_000_000, other: 3_388_360 });
    const bodily1 = expectOk(liabilityBodily1(claim));
    const uninsured = expectOk(excessOverCompulsory(claim, at(bodily1), 200_000_000, 0, "무보험자동차상해 가입금액"));
    const rows = [
      { ...paymentLabel("liability_bodily_1", "counterparty", "uninsured"), amount: bodily1.total.expected },
      { ...paymentLabel("uninsured", "mine", "uninsured"), amount: uninsured.total.expected },
    ].map(({ label, payer, amount }) => ({ label, payer, amount }));
    expect(rows).toEqual([
      { label: "대인Ⅰ 상당액(정부보장사업)", payer: "government", amount: 9_000_000 },
      { label: "무보험자동차에 의한 상해", payer: "own_insurer", amount: 3_388_360 },
    ]);
  });
});
