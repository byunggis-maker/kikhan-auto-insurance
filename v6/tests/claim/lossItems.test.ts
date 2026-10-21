import { describe, expect, it } from "vitest";
import { COVERAGE_DOCUMENTS, DOCUMENTS, LOSS_ITEMS, STANDARD_BASIS, documentsFor, itemsFor, lossItemDef } from "@/lib/claim/lossItems";
import { COVERAGES } from "@/lib/claim/types";

describe("손해 항목 목록", () => {
  it("항목 코드는 겹치지 않고, 모든 항목에 별표·조 번호와 쪽이 있다", () => {
    const codes = LOSS_ITEMS.map((item) => item.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const item of LOSS_ITEMS) {
      expect(item.basis.ref, item.code).toMatch(/^(별표[1-3]|제\d+조)$/);
      expect(item.basis.page, item.code).toBeGreaterThan(0);
      expect(item.coverages.length, item.code).toBeGreaterThan(0);
    }
  });

  it("MASTER.md 6장 (3)의 손해 항목이 모두 있다", () => {
    for (const code of ["treatment", "future_treatment", "lost_income", "solatium_injury", "solatium_disability", "solatium_death", "lost_earnings_disability", "lost_earnings_death", "repair", "rental", "idle", "depreciation", "towing"])
      expect(lossItemDef(code), code).toBeDefined();
  });

  it("필요 서류는 모두 서류 목록에 있고, 제27조 호 번호가 1~9다", () => {
    for (const item of LOSS_ITEMS) for (const doc of item.requiredDocs) expect(DOCUMENTS[doc], `${item.code}: ${doc}`).toBeDefined();
    for (const doc of Object.values(DOCUMENTS)) expect(doc.clause27).toBeGreaterThanOrEqual(1);
    for (const doc of Object.values(DOCUMENTS)) expect(doc.clause27).toBeLessThanOrEqual(9);
  });

  it("담보별 공통 서류는 제27조 표(개인용 인쇄 58쪽)의 ○와 같다", () => {
    const rows = (coverage: (typeof COVERAGES)[number]) => COVERAGE_DOCUMENTS[coverage].map((id) => DOCUMENTS[id].clause27).sort();
    expect(rows("liability_bodily_1")).toEqual([1, 2, 3, 9]);
    expect(rows("liability_property")).toEqual([1, 2, 3, 9]);
    expect(rows("own_damage")).toEqual([1, 2, 4, 9]);
    expect(rows("self_injury")).toEqual([1, 2, 9]);
    expect(rows("uninsured")).toEqual([1, 2, 4, 5, 6, 7, 9]);
    for (const coverage of COVERAGES) expect(COVERAGE_DOCUMENTS[coverage].length, coverage).toBeGreaterThan(0);
  });

  it("치료관계비는 하한·구상 대상이고, 간병비는 하한 대상이지만 구상 대상이 아니다(별표4)", () => {
    expect(lossItemDef("treatment")).toMatchObject({ medical: true, guaranteed: true });
    expect(lossItemDef("nursing")).toMatchObject({ medical: false, guaranteed: true });
    expect(LOSS_ITEMS.filter((item) => item.medical).map((item) => item.code)).toEqual(["treatment"]);
  });

  it("가입담보와 겹치는 항목만 보인다: 자기신체사고만 있으면 사람 카드에는 치료관계비만", () => {
    expect(itemsFor("person", ["self_injury"]).map((item) => item.code)).toEqual(["treatment"]);
    expect(itemsFor("property", ["own_damage"]).map((item) => item.code)).toEqual(["own_repair", "own_total_loss"]);
    expect(itemsFor("person", ["liability_property"])).toEqual([]);
  });

  it("항목 서류와 담보 공통 서류를 합치고 겹치는 것은 한 번만", () => {
    const docs = documentsFor("treatment", ["liability_bodily_1", "liability_bodily_2"]);
    expect(docs).toEqual(["diagnosis", "medical_bills", "claim_form", "loss_proof", "settlement_proof", "insurer_request"]);
    expect(documentsFor("없는 항목", ["liability_bodily_1"])).toEqual([]);
  });

  it("사망 최저 보상의 근거는 시행령 제3조①1호 단서와 약관 별표4다", () => {
    expect(STANDARD_BASIS.deathMinimum).toBe("자동차손해배상보장법 시행령 제3조①1호 단서 + 약관 별표4 1. 과실상계 가.(2)");
  });
});
