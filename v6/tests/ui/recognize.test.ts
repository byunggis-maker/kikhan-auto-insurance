import { describe, expect, it } from "vitest";
import type { ClaimReading, PolicyReading } from "@/lib/ai/documents";
import { claimSchema, emptyClaim, type Claim } from "@/lib/claim/types";
import { calculate } from "@/lib/engine/dual-run";
import { buildReview } from "@/lib/report/review";
import { setPropertyCount, setVictimCount, toggleCoverage } from "@/lib/ui/flow";
import { addRecognitions, claimRecognitions, confirmAll, confirmRecognition, dismissRecognition, editRecognition, policyRecognitions } from "@/lib/ui/recognize";

// 라운드 7: 인식값은 "확인해 주세요" 상태로 두고, 확인해야 입력칸에 들어가며 계산에 쓰인다.

let n = 0;
const makeId = () => `r${++n}`;
const base = (): Claim => {
  let c: Claim = { ...emptyClaim(), accident: { ...emptyClaim().accident, occurredAt: "2026-09-01", type: "car_car" }, fault: { mode: "known", myPercent: 30 } };
  c = toggleCoverage(toggleCoverage(c, "auto_injury", true), "own_damage", true);
  c = setVictimCount(c, "driver", 1);
  c = setPropertyCount(c, "my_vehicle", 1);
  return { ...c, victims: c.victims.map((v) => ({ ...v, injuryGrade: 9 })) };
};
const receipt: ClaimReading = {
  documentType: "진료비 영수증",
  amounts: [
    { code: "treatment", amount: 1_500_000, basis: "외래" },
    { code: "treatment", amount: 500_000, basis: "입원" },
    { code: "future_treatment", amount: 300_000, basis: "소견서" },
  ],
  facts: { hospitalDays: 5, outpatientDays: 4, monthlyIncome: null },
  note: "",
};

describe("보상 서류 인식값", () => {
  it("같은 항목은 합치고, 날수는 치료 정보 대기 값으로 둔다. 확인 전에는 계산에 쓰지 않는다", () => {
    const { recognitions, dropped } = claimRecognitions(base(), "driver-1", receipt, makeId);
    expect(dropped).toBe(0);
    expect(recognitions.map((r) => (r.kind === "loss" ? [r.code, r.value] : r.kind === "fact" ? [r.field, r.value] : null))).toEqual([
      ["treatment", 2_000_000],
      ["future_treatment", 300_000],
      ["hospitalDays", 5],
      ["outpatientDays", 4],
    ]);
    const c = claimSchema.parse(addRecognitions(base(), recognitions));
    expect(c.victims[0].losses).toEqual([]);
    expect(calculate(c, 30).totals.receive.withEstimates).toBe(0);
    // 검토서 '입력 필요'에 확인 필요로 나온다
    const review = buildReview(c, [calculate(c, 30)], 0);
    expect(review.missing.filter((m) => m.startsWith("확인 필요(서류 인식)"))).toHaveLength(4);
  });

  it("이 카드에 보이지 않는 항목(12급의 향후치료비)은 넣지 않고 수를 알려 준다", () => {
    const c = { ...base(), victims: base().victims.map((v) => ({ ...v, injuryGrade: 12 })) };
    const { recognitions, dropped } = claimRecognitions(c, "driver-1", receipt, makeId);
    expect(dropped).toBe(1);
    expect(recognitions.some((r) => r.kind === "loss" && r.code === "future_treatment")).toBe(false);
  });

  it("고친 뒤 확인하면 확정 칸(서류)에 들어가고 대기 목록에서 빠진다. 지우면 아무것도 들어가지 않는다", () => {
    const { recognitions } = claimRecognitions(base(), "driver-1", receipt, makeId);
    let c = addRecognitions(base(), recognitions);
    const treatment = recognitions.find((r) => r.kind === "loss" && r.code === "treatment")!;
    c = editRecognition(c, treatment.id, 1_900_000);
    c = confirmRecognition(c, treatment.id);
    expect(c.victims[0].losses.find((i) => i.code === "treatment")).toMatchObject({ confirmed: 1_900_000, evidence: "서류 인식 확인: 진료비 영수증", source: { confirmed: "document" } });
    const days = recognitions.find((r) => r.kind === "fact" && r.field === "hospitalDays")!;
    c = confirmRecognition(c, days.id);
    expect(c.victims[0].hospitalDays).toBe(5);
    const future = recognitions.find((r) => r.kind === "loss" && r.code === "future_treatment")!;
    c = dismissRecognition(c, future.id);
    expect(c.victims[0].losses.some((i) => i.code === "future_treatment")).toBe(false);
    expect(c.recognized.map((r) => r.id)).toEqual([recognitions.find((r) => r.kind === "fact" && r.field === "outpatientDays")!.id]);
    expect(calculate(claimSchema.parse(c), 30).cards[0].actualLoss.confirmed).toBe(1_900_000);
  });

  it("같은 칸을 다시 읽으면 예전 대기 값을 바꾼다", () => {
    const first = claimRecognitions(base(), "driver-1", receipt, makeId).recognitions;
    const again = claimRecognitions(base(), "driver-1", { ...receipt, amounts: [{ code: "treatment", amount: 100, basis: "" }], facts: { hospitalDays: null, outpatientDays: null, monthlyIncome: null } }, makeId).recognitions;
    const c = addRecognitions(addRecognitions(base(), first), again);
    expect(c.recognized.filter((r) => r.kind === "loss" && r.code === "treatment").map((r) => r.value)).toEqual([100]);
    expect(c.recognized).toHaveLength(4);
  });

  it("물건 카드: 수리비·견인비", () => {
    const reading: ClaimReading = { documentType: "수리비 견적서", amounts: [{ code: "repair", amount: 1_980_000, basis: "" }, { code: "towing", amount: 100_000, basis: "" }], facts: { hospitalDays: null, outpatientDays: null, monthlyIncome: null }, note: "" };
    const { recognitions } = claimRecognitions(base(), "my_vehicle-1", reading, makeId);
    const c = confirmAll(addRecognitions(base(), recognitions), recognitions.map((r) => r.id));
    expect(c.properties[0].losses.map((i) => [i.code, i.confirmed])).toEqual([
      ["repair", 1_980_000],
      ["towing", 100_000],
    ]);
  });
});

describe("증권 인식값", () => {
  const policy: PolicyReading = {
    isPolicy: true,
    insurer: "가상화재해상보험",
    productLine: "personal",
    driverScope: "family",
    coverages: [
      { coverage: "liability_bodily_2", unlimited: true, limit: null, injuryLimit: null, deathLimit: null, disabilityLimit: null, text: "무한" },
      { coverage: "liability_property", unlimited: false, limit: 200_000_000, injuryLimit: null, deathLimit: null, disabilityLimit: null, text: "1사고당 2억원" },
      { coverage: "self_injury", unlimited: false, limit: null, injuryLimit: 15_000_000, deathLimit: 15_000_000, disabilityLimit: 15_000_000, text: "" },
    ],
    ownDamageDeductible: { ratePercent: 20, min: 200_000, max: 500_000 },
    note: "",
  };

  it("모두 확인하면 내 보험 칸이 채워진다(자기신체사고를 켜면 자동차상해는 꺼진다)", () => {
    const found = policyRecognitions(policy, makeId);
    expect(found.map((r) => r.kind)).toEqual(["insurer", "productLine", "driverScope", "coverage", "coverage", "coverage", "deductible"]);
    const c = claimSchema.parse(confirmAll(addRecognitions(base(), found), found.map((r) => r.id)));
    expect(c.myPolicy).toMatchObject({ insurer: "가상화재해상보험", productLine: "personal", driverScope: "family", hasBodily2: true, deductible: { type: "rate", ratePercent: 20, min: 200_000, max: 500_000 } });
    expect(c.myPolicy.coverages.find((x) => x.coverage === "liability_bodily_2")?.limit).toBe("unlimited");
    expect(c.myPolicy.coverages.find((x) => x.coverage === "liability_property")?.limit).toBe(200_000_000);
    expect(c.myPolicy.coverages.find((x) => x.coverage === "self_injury")?.injuryLimit).toBe(15_000_000);
    expect(c.myPolicy.coverages.some((x) => x.coverage === "auto_injury")).toBe(false);
    expect(c.recognized).toEqual([]);
  });

  it("증권이 아니면 아무것도 만들지 않는다", () => {
    expect(policyRecognitions({ ...policy, isPolicy: false }, makeId)).toEqual([]);
  });
});
