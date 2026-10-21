import type { Claim } from "@/lib/claim/types";
import { calculate } from "./dual-run";
import type { Result } from "./types";

// MASTER.md 6장: 과실을 모르면 0·30·50·70% 시나리오를 한 번에 계산한다. 과실을 알면 그 값 하나만.

export const FAULT_SCENARIOS = [0, 30, 50, 70] as const;

export function calculateScenarios(claim: Claim): Result[] {
  if (claim.fault.mode === "known") return [calculate(claim, claim.fault.myPercent)];
  return FAULT_SCENARIOS.map((percent) => calculate(claim, percent));
}
