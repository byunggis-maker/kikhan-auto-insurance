import { describe, expect, it } from "vitest";
import { claimSchema, emptyClaim, type Claim } from "@/lib/claim/types";
import { calculate } from "@/lib/engine/dual-run";
import { counterpartyOf, screensFor, setCoverage, setItem, setPropertyCount, setVictimCount, skip, skippedLabels, toggleCoverage, unskip, visibleItems } from "@/lib/ui/flow";

// 입력 7단계의 화면 순서·건너뛰기·항목 고르기(라운드 5). 화면이 쓰는 함수만으로 사례 (1)·(2)를 입력해 엔진 값과 맞춰 본다.

const base = (): Claim => ({ ...emptyClaim(), accident: { ...emptyClaim().accident, occurredAt: "2026-09-01", type: "car_car" } });
const kinds = (claim: Claim) => screensFor(claim).map((s) => s.kind);

describe("화면 순서", () => {
  it("7단계가 순서대로 나오고 마지막은 결과 미리보기(카드가 있어야 6단계가 생긴다)", () => {
    expect(screensFor(base()).some((s) => s.step === 6)).toBe(false);
    const screens = screensFor(setVictimCount(base(), "driver", 1));
    expect([...new Set(screens.map((s) => s.step))]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(screens.at(-1)?.kind).toBe("result");
  });

  it("차대사람·단독 사고에는 4단계(상대 보험)가 없다", () => {
    for (const type of ["car_person", "single"] as const) {
      const c = { ...base(), accident: { ...base().accident, type } };
      expect(screensFor(c).some((s) => s.step === 4)).toBe(false);
    }
  });

  it("사람·물건 카드마다 2·6단계 화면이 생기고, 가족 동승자는 관계를 묻는다", () => {
    let c = setVictimCount(base(), "driver", 1);
    c = setVictimCount(c, "family_passenger", 1);
    c = setPropertyCount(c, "my_vehicle", 1);
    const ids = screensFor(c).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["injury:driver-1", "relation:family_passenger-1", "facts:family_passenger-1", "losses:driver-1", "propertyLosses:my_vehicle-1", "vehicleValue:my_vehicle-1"]));
    expect(ids.includes("relation:driver-1")).toBe(false);
  });

  it("음주 등을 고르면 운전자 관계 질문이 생기고, 가입한 담보만 가입금액을 묻는다", () => {
    let c = base();
    expect(kinds(c)).not.toContain("driverRelation");
    c = { ...c, accident: { ...c.accident, violations: { ...c.accident.violations, drunk: true } } };
    expect(kinds(c)).toContain("driverRelation");
    expect(kinds(c)).not.toContain("ownDamage");
    expect(kinds(toggleCoverage(c, "own_damage", true))).toContain("ownDamage");
  });

  it("상대 대인Ⅱ 가입 여부를 모르면 대인Ⅱ 금액은 묻지 않는다(두 시나리오로 계산)", () => {
    const known = { ...base(), counterpartyPolicy: counterpartyOf(base(), "full") };
    const unknown = { ...base(), counterpartyPolicy: counterpartyOf(base(), "full", null) };
    expect(kinds(known)).toContain("counterpartyBodily2");
    expect(kinds(unknown)).not.toContain("counterpartyBodily2");
    expect(calculate(claimSchema.parse(unknown), 0).bodily2Scenarios).not.toBeNull();
  });
});

describe("모르면 건너뛰기", () => {
  it("건너뛰면 값을 비우고 '입력 필요' 목록에 모은다. 나중에 값을 넣으면 목록에서 빠진다", () => {
    const c0 = { ...base(), accident: { ...base().accident, place: "서울" } };
    const screen = screensFor(c0).find((s) => s.kind === "place")!;
    const c1 = skip(c0, screen);
    expect(c1.accident.place).toBe("");
    expect(skippedLabels(c1)).toEqual(["어디서 일어났나요?"]);
    expect(unskip(c1, screen.id).skipped).toEqual([]);
  });

  it("과실을 건너뛰면 '모름'(0·30·50·70% 시나리오)", () => {
    const c = { ...base(), fault: { mode: "known" as const, myPercent: 30 } };
    expect(skip(c, screensFor(c).find((s) => s.kind === "fault")!).fault).toEqual({ mode: "unknown" });
  });
});

describe("담보와 손해 항목", () => {
  it("자동차상해와 자기신체사고는 하나만 켜진다", () => {
    const c = toggleCoverage(toggleCoverage(base(), "auto_injury", true), "self_injury", true);
    expect(c.myPolicy.coverages.map((x) => x.coverage)).toEqual(["self_injury"]);
  });

  it("사람의 상태에 맞는 항목만: 12급은 향후치료비 없음, 사망이면 사망 항목", () => {
    let c = setVictimCount(base(), "driver", 1);
    c = { ...c, victims: c.victims.map((v) => ({ ...v, injuryGrade: 12 })) };
    const codes = (x: Claim) => visibleItems(x, "driver-1").map((i) => i.code);
    expect(codes(c)).not.toContain("future_treatment");
    expect(codes(c)).not.toContain("funeral");
    expect(codes({ ...c, victims: c.victims.map((v) => ({ ...v, died: true })) })).toEqual(expect.arrayContaining(["funeral", "solatium_death", "lost_earnings_death"]));
  });

  it("내 차: 상대가 무보험이고 자차만 있으면 수리비·전손·견인비만(렌트는 대물에서만)", () => {
    let c = setPropertyCount(toggleCoverage(base(), "own_damage", true), "my_vehicle", 1);
    c = { ...c, counterpartyPolicy: counterpartyOf(c, "uninsured") };
    expect(visibleItems(c, "my_vehicle-1").map((i) => i.code)).toEqual(["repair", "replacement_value", "towing"]);
    c = { ...c, counterpartyPolicy: counterpartyOf(c, "full") };
    expect(visibleItems(c, "my_vehicle-1").map((i) => i.code)).toContain("rental");
  });

  it("약관 기준 쓰기는 빈 항목을 만들고, 끄면 지운다", () => {
    const c = setVictimCount(base(), "driver", 1);
    const on = setItem(c, "driver-1", "solatium_injury", { standard: true });
    expect(on.victims[0].losses).toHaveLength(1);
    expect(setItem(on, "driver-1", "solatium_injury", { standard: false }).victims[0].losses).toHaveLength(0);
    const typed = setItem(c, "driver-1", "treatment", { confirmed: 2_000_000 });
    expect(typed.victims[0].losses[0]).toMatchObject({ confirmed: 2_000_000, source: { confirmed: "document", estimated: null } });
    expect(setItem(typed, "driver-1", "treatment", { confirmed: null }).victims[0].losses).toHaveLength(0);
  });
});

describe("화면 함수로 입력한 사례가 엔진 기대값과 같다", () => {
  const myPolicy = (c: Claim): Claim => {
    let x: Claim = { ...c, myPolicy: { ...c.myPolicy, productLine: "personal" } };
    for (const coverage of ["liability_bodily_2", "liability_property", "uninsured", "own_damage", "auto_injury"] as const) x = toggleCoverage(x, coverage, true);
    x = setCoverage(x, "liability_property", { limit: 100_000_000 });
    x = setCoverage(x, "auto_injury", { injuryLimit: 30_000_000, deathLimit: 200_000_000, disabilityLimit: 200_000_000 });
    x = setCoverage(x, "uninsured", { limit: 200_000_000 });
    return { ...x, counterpartyPolicy: { ...counterpartyOf(x, "full"), coverages: counterpartyOf(x, "full").coverages.map((cv) => (cv.coverage === "liability_bodily_2" ? { ...cv, limit: "unlimited" as const } : cv.coverage === "liability_property" ? { ...cv, limit: 100_000_000 } : cv)) } };
  };

  it("사례 (1): 운전자 9급, 과실 30% → 상대 대인Ⅰ 2,226,000 / 내 자동차상해 954,000", () => {
    let c: Claim = myPolicy(setVictimCount(base(), "driver", 1));
    c = { ...c, victims: c.victims.map((v) => ({ ...v, injuryGrade: 9 })), fault: { mode: "known", myPercent: 30 } };
    for (const [code, amount] of [["treatment", 2_000_000], ["solatium_injury", 250_000], ["other_injury", 80_000], ["lost_income", 850_000]] as const) c = setItem(c, "driver-1", code, { confirmed: amount });
    const r = calculate(claimSchema.parse(c), 30);
    const at = (key: string) => r.lines.find((l) => l.key === key)?.confirmed;
    expect([at("driver-1:liability_bodily_1:counterparty_insurer"), at("driver-1:liability_bodily_2:counterparty_insurer"), at("driver-1:auto_injury:own_insurer")]).toEqual([2_226_000, 0, 954_000]);
    expect(r.totals.receive.confirmed).toBe(3_180_000);
  });

  it("사례 (2): 가족 동승자(배우자) 12급, 과실 40%, 휴업손해 추정 1,500,000(소득 증명 예)", () => {
    let c: Claim = myPolicy(setVictimCount(base(), "family_passenger", 1));
    c = { ...c, victims: c.victims.map((v) => ({ ...v, injuryGrade: 12, relationToNamedInsured: "spouse" as const, incomeProven: true })), fault: { mode: "known", myPercent: 40 } };
    for (const [code, amount] of [["treatment", 2_000_000], ["solatium_injury", 150_000], ["other_injury", 80_000]] as const) c = setItem(c, "family_passenger-1", code, { confirmed: amount });
    c = setItem(c, "family_passenger-1", "lost_income", { estimated: 1_500_000 });
    const r = calculate(claimSchema.parse(c), 40);
    const at = (key: string) => {
      const l = r.lines.find((x) => x.key === key)!;
      return [l.confirmed, l.withEstimates];
    };
    expect(at("family_passenger-1:liability_bodily_1:counterparty_insurer")).toEqual([1_200_000, 1_200_000]);
    expect(at("family_passenger-1:liability_bodily_2:counterparty_insurer")).toEqual([800_000, 1_038_000]);
    expect(at("family_passenger-1:liability_bodily_1:own_insurer")).toEqual([230_000, 1_200_000]);
    expect(at("family_passenger-1:liability_bodily_2:own_insurer")).toEqual([0, 0]);
    expect(at("family_passenger-1:auto_injury:own_insurer")).toEqual([0, 292_000]);
  });
});
