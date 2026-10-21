import { describe, expect, it } from "vitest";
import { ownDamage, type OwnDamageTerms } from "@/lib/engine/legacy/coverages/own-damage";
import { openRules } from "@/lib/engine/legacy/rules";
import type { Deductible, VehicleDamage } from "@/lib/engine/legacy/schemas/vehicle-claim";
import { ACCIDENT_DATE, FAULT_ITEMS } from "./helpers";

// 자기차량손해: 상대 대물 처리분 공제 후 자기부담금. 사례와 기대값은 compass/tests/vehicle-coverage.test.ts 136–181행을 옮겼다.
// 원본은 V2 차량 계산(vehicle.ts)이 상대 대물 처리분(recovered)을 구해 넘기지만, 여기서는 그 금액을 직접 넣는다.
// waivedOnTotalLoss·onNetOfRecovery는 compass/data/rules/standard/own-damage.json의 값(true)이다.

function damage(change: Partial<VehicleDamage>): VehicleDamage {
  return { id: "v1", label: "가상 차량", ownerId: "p1", faultPercent: 0, repairCost: null, totalLoss: false, valueAtAccident: null, extendedRepairCap: false, firstRegisteredOn: null, commercialUse: false, rental: null, idle: null, towingCost: null, ...change };
}

const RATE_20: Deductible = { type: "rate", ratePercent: 20, min: 200_000, max: 500_000 };
const terms = (limit: number, deductible: Deductible): OwnDamageTerms => ({ limit, deductible, waivedOnTotalLoss: true, onNetOfRecovery: true });

function run(vehicle: VehicleDamage, loss: number, own: OwnDamageTerms, recovered = 0) {
  const result = ownDamage(vehicle, loss, own, recovered, openRules(FAULT_ITEMS, ACCIDENT_DATE), []);
  expect(result).not.toBeNull();
  const step = (item: string) => result!.steps.find((s) => s.item === item)?.value;
  return { value: result!.value, step };
}

describe("자기차량손해", () => {
  it("단독사고: 수리비 5,000,000, 정액 자기부담금 500,000 → 4,500,000", () => {
    expect(run(damage({ faultPercent: 100, repairCost: 5_000_000 }), 5_000_000, terms(25_000_000, { type: "fixed", amount: 500_000 })).value).toBe(4_500_000);
  });

  it("약관의 예시: 수리비 200만원·20%(20만~50만원) → 자기부담금 40만원 / 수리비 400만원·30%(30만~100만원) → 100만원", () => {
    const first = run(damage({ repairCost: 2_000_000 }), 2_000_000, terms(25_000_000, RATE_20));
    expect(first.step("own_damage_deductible")).toBe(400_000);
    expect(first.value).toBe(1_600_000);
    const second = run(damage({ repairCost: 4_000_000 }), 4_000_000, terms(25_000_000, { type: "rate", ratePercent: 30, min: 300_000, max: 1_000_000 }));
    expect(second.step("own_damage_deductible")).toBe(1_000_000);
    expect(second.value).toBe(3_000_000);
  });

  it("쌍방과실(내 과실 30%): 5,000,000 − 상대 대물 처리분 3,500,000 = 1,500,000, 자기부담금 300,000 → 1,200,000", () => {
    const { value, step } = run(damage({ faultPercent: 30, repairCost: 5_000_000, valueAtAccident: 20_000_000 }), 5_000_000, terms(25_000_000, RATE_20), 3_500_000);
    expect(step("own_damage_net")).toBe(1_500_000);
    expect(step("own_damage_deductible")).toBe(300_000);
    expect(value).toBe(1_200_000);
  });

  it("내 과실 10%: 500,000 × 20% = 100,000 → 최소 200,000 → 300,000", () => {
    expect(run(damage({ faultPercent: 10, repairCost: 5_000_000, valueAtAccident: 20_000_000 }), 5_000_000, terms(25_000_000, RATE_20), 4_500_000).value).toBe(300_000);
  });

  it("전손이거나 손해액이 가입금액 전액 이상이면 자기부담금을 빼지 않는다", () => {
    expect(run(damage({ totalLoss: true, valueAtAccident: 8_000_000 }), 8_000_000, terms(10_000_000, RATE_20)).value).toBe(8_000_000);
    expect(run(damage({ repairCost: 12_000_000 }), 12_000_000, terms(10_000_000, RATE_20)).value).toBe(10_000_000);
  });
});
