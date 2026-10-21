import { describe, expect, it } from "vitest";
import { PAYER_LABELS, claimSchema, emptyClaim, emptyLossItem, lossItemSchema, victimSchema, type Victim } from "@/lib/claim/types";

describe("자료 구조(MASTER.md 4장)", () => {
  it("빈 입력은 스키마를 통과하고, 과실은 모르는 상태로 시작한다", () => {
    const claim = claimSchema.parse(emptyClaim());
    expect(claim.fault).toEqual({ mode: "unknown" });
    expect(claim.victims).toEqual([]);
  });

  it("지급처는 상대 보험 | 내 보험 | 정부보장사업 세 가지다", () => {
    expect(Object.values(PAYER_LABELS)).toEqual(["상대 보험", "내 보험", "정부보장사업"]);
  });

  it("손해 항목은 확정(서류)·추정(출처)·필요 서류를 따로 가진다", () => {
    const item = lossItemSchema.parse({
      code: "treatment",
      confirmed: 1_900_000,
      evidence: "진료비 세부내역서",
      estimated: 2_100_000,
      source: { confirmed: "document", estimated: "user_estimate" },
      requiredDocs: ["medical_bills"],
    });
    expect(item.confirmed).toBe(1_900_000);
    expect(item.estimated).toBe(2_100_000);
  });

  it("금액과 출처가 짝이 맞지 않으면 거부한다", () => {
    const base = emptyLossItem("treatment", []);
    expect(lossItemSchema.safeParse({ ...base, confirmed: 100 }).success).toBe(false);
    expect(lossItemSchema.safeParse({ ...base, source: { confirmed: null, estimated: "app_default" } }).success).toBe(false);
    expect(lossItemSchema.safeParse({ ...base, confirmed: -1, source: { confirmed: "document", estimated: null } }).success).toBe(false);
  });

  it("사람 카드마다 userTotal을 두고, 호의동승 감액은 기본 0%다", () => {
    const victim: Victim = {
      id: "v1",
      role: "other_passenger",
      label: "남 동승자",
      relationToNamedInsured: "none",
      vehicleDriver: false,
      age: null,
      injuryGrade: 12,
      disabilityGrade: null,
      died: false,
      rideAlongReductionPercent: 0,
      hospitalDays: null,
      outpatientDays: null,
      mealsNotProvided: null,
      daysOffWork: null,
      monthlyIncome: null,
      incomeProven: null,
      occupation: null,
      incomeAmountProven: null,
      losses: [],
      userTotal: 3_000_000,
    };
    expect(victimSchema.parse(victim).userTotal).toBe(3_000_000);
    expect(victimSchema.safeParse({ ...victim, rideAlongReductionPercent: 101 }).success).toBe(false);
    expect(victimSchema.safeParse({ ...victim, injuryGrade: 15 }).success).toBe(false);
  });
});
