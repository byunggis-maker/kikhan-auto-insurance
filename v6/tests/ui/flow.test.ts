import { describe, expect, it } from "vitest";
import { claimSchema, emptyClaim, type Claim } from "@/lib/claim/types";
import { calculate } from "@/lib/engine/dual-run";
import { counterpartyOf, limitFields, periodCheck, screensFor, setCoverage, setItem, setPropertyCount, setVictimCount, standardFillable, toggleCoverage, unknownLabels, visibleItems, withAssumptions } from "@/lib/ui/flow";
import { confirmPolicy, policyRecognitions } from "@/lib/ui/recognize";
import type { PolicyReading } from "@/lib/ai/documents";

// 입력 7단계의 화면 순서·항목 고르기(라운드 5, 라운드 9에서 증권 먼저·드롭다운으로 바꿈). 화면이 쓰는 함수만으로 사례 (1)·(2)를 입력해 엔진 값과 맞춰 본다.

const base = (): Claim => ({ ...emptyClaim(), accident: { ...emptyClaim().accident, occurredAt: "2026-09-01", type: "car_car" } });
const kinds = (claim: Claim) => screensFor(claim).map((s) => s.kind);

describe("화면 순서", () => {
  it("7단계가 순서대로 나오고 마지막은 보상 검토서(카드가 있어야 6단계가 생긴다)", () => {
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

  it("사람·물건 카드마다 3·6단계 화면이 생기고, 차량가액을 묻는 화면은 없다", () => {
    let c = setVictimCount(base(), "driver", 1);
    c = setVictimCount(c, "family_passenger", 1);
    c = setPropertyCount(c, "my_vehicle", 1);
    c = setPropertyCount(c, "counterparty_vehicle", 1);
    const screens = screensFor(c);
    const ids = screens.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["person:driver-1", "person:family_passenger-1", "facts:family_passenger-1", "losses:driver-1", "propertyLosses:my_vehicle-1", "propertyLosses:counterparty_vehicle-1"]));
    expect(screens.some((s) => /차량가액/.test(s.title + (s.hint ?? "")))).toBe(false);
    expect(c.properties.map((p) => p.label)).toEqual(["내 차", "상대 차량 1"]);
    expect(c.victims[0].label).toBe("피보험자(나)");
  });

  it("증권 → 사고일 순서. 가입한 담보만 가입금액을 묻는다", () => {
    const c = base();
    expect(kinds(c).slice(0, 2)).toEqual(["policy", "date"]);
    expect(kinds(c)).not.toContain("limits");
    expect(limitFields(toggleCoverage(c, "own_damage", true))).toEqual(["deductible"]);
    expect(limitFields(toggleCoverage(toggleCoverage(c, "auto_injury", true), "uninsured", true))).toEqual(["injury", "death", "uninsured"]);
  });
});

describe("증권에서 읽은 항목은 묻지 않는다(라운드 9)", () => {
  const reading: PolicyReading = {
    isPolicy: true,
    insurer: "현대해상",
    productLine: "personal",
    driverScope: "family",
    coverages: [
      { coverage: "liability_bodily_1", unlimited: false, limit: null, injuryLimit: null, deathLimit: null, disabilityLimit: null, text: "" },
      { coverage: "liability_bodily_2", unlimited: true, limit: null, injuryLimit: null, deathLimit: null, disabilityLimit: null, text: "무한" },
      { coverage: "liability_property", unlimited: false, limit: 200_000_000, injuryLimit: null, deathLimit: null, disabilityLimit: null, text: "2억" },
      { coverage: "auto_injury", unlimited: false, limit: null, injuryLimit: 200_000_000, deathLimit: 200_000_000, disabilityLimit: 200_000_000, text: "2억/2억" },
    ],
    periodStart: "2026-03-01",
    periodEnd: "2027-03-01",
    ageLimit: "만 26세 이상",
    vehicleModel: "쏘나타",
    vehicleYear: 2022,
    vehicleValue: 21_000_000,
    ownDamageDeductible: null,
    note: "",
  };
  let n = 0;
  const id = () => `r${n++}`;

  it("모두 확인하면 보험 종류·운전자 범위·가입담보·가입금액 화면이 사라지고, 보험기간을 점검한다", () => {
    const pending = { ...base(), recognized: policyRecognitions(reading, id) };
    expect(kinds(pending)).toEqual(expect.arrayContaining(["myPolicy", "coverages"]));
    const c = confirmPolicy(pending, pending.recognized.map((r) => r.id));
    expect(c.recognized).toEqual([]);
    expect(kinds(c)).not.toContain("myPolicy");
    expect(kinds(c)).not.toContain("coverages");
    expect(kinds(c)).not.toContain("limits");
    expect(c.myPolicy).toMatchObject({ insurer: "현대해상", productLine: "personal", driverScope: "family", periodStart: "2026-03-01", vehicleValue: 21_000_000 });
    expect(c.myPolicy.coverages.find((x) => x.coverage === "auto_injury")).toMatchObject({ injuryLimit: 200_000_000, deathLimit: 200_000_000 });
    expect(periodCheck(c)).toBe("inside");
    expect(periodCheck({ ...c, accident: { ...c.accident, occurredAt: "2027-05-01" } })).toBe("outside");
    // 내 차의 사고 직전 가액은 증권의 차량가액
    expect(setPropertyCount(c, "my_vehicle", 1).properties[0]).toMatchObject({ valueAtAccident: 21_000_000, valueSource: "policy" });
  });

  it("체크를 뺀 줄은 넣지 않고 그 칸은 묻는다", () => {
    const pending = { ...base(), recognized: policyRecognitions(reading, id) };
    const scope = pending.recognized.find((r) => r.kind === "driverScope")!;
    const c = confirmPolicy(pending, pending.recognized.filter((r) => r !== scope).map((r) => r.id));
    expect(c.myPolicy.driverScope).toBeNull();
    expect(kinds(c)).toContain("myPolicy");
  });
});

describe("'모름'", () => {
  it("모름으로 둔 칸은 '입력 필요'에 모은다", () => {
    const c = setVictimCount({ ...base(), accident: { ...base().accident, type: null } }, "driver", 1);
    expect(unknownLabels(c)).toEqual(["보험 종류", "운전자 범위 한정특약", "사고 유형", "피보험자(나): 상해 급별"]);
  });

  it("상대 차량 보험을 모르면 일반적 가입 기준(대인Ⅱ 무한·대물 2억 원)으로 계산한다. 무보험이면 채우지 않는다", () => {
    const { claim, assumptions } = withAssumptions(base());
    expect(assumptions).toEqual(["cp_status"]);
    expect(claim.counterpartyPolicy?.coverages.map((c) => [c.coverage, c.limit])).toEqual([
      ["liability_bodily_1", null],
      ["liability_bodily_2", "unlimited"],
      ["liability_property", 200_000_000],
    ]);
    const full = { ...base(), counterpartyPolicy: counterpartyOf(base(), "full") };
    expect(withAssumptions(full).assumptions).toEqual(["cp_bodily2", "cp_property"]);
    const uninsured = { ...base(), counterpartyPolicy: counterpartyOf(base(), "uninsured") };
    expect(withAssumptions(uninsured).assumptions).toEqual([]);
  });

  it("상대 대인Ⅱ 가입 여부를 모르는 예전 저장값은 그대로 두 시나리오로 계산한다", () => {
    const unknown = { ...base(), counterpartyPolicy: counterpartyOf(base(), "full", null) };
    expect(calculate(claimSchema.parse(unknown), 0).bodily2Scenarios).not.toBeNull();
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

describe("지급기준으로 채울 수 있는 칸(라운드 5 보완 B)", () => {
  it("급수·통원일수·휴업 정보가 있으면 위자료·그 밖의 손해·휴업손해를 세고, 이미 쓰는 항목과 0원은 빼며, 6단계 그 카드 화면으로 보낸다", () => {
    let c = setVictimCount(base(), "driver", 1);
    c = { ...c, victims: c.victims.map((v) => ({ ...v, injuryGrade: 9, outpatientDays: 10, daysOffWork: 10, occupation: "homemaker" as const, incomeProven: true })) };
    expect(standardFillable(c).map((f) => f.code)).toEqual(["solatium_injury", "lost_income", "other_injury"]);
    expect(standardFillable(c)[0]).toMatchObject({ screenId: "losses:driver-1", label: "피보험자(나): 부상 위자료" });
    // 위자료를 약관 기준으로 쓰기 시작하면(빈 항목) 빠진다
    c = setItem(c, "driver-1", "solatium_injury", { standard: true });
    expect(standardFillable(c).map((f) => f.code)).toEqual(["lost_income", "other_injury"]);
    // 수입 감소를 증명하지 못하면 휴업손해 약관 기준은 0원이라 세지 않는다
    c = { ...c, victims: c.victims.map((v) => ({ ...v, incomeProven: false })) };
    expect(standardFillable(c).map((f) => f.code)).toEqual(["other_injury"]);
  });
});
