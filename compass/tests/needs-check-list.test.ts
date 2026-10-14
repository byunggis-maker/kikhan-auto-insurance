import { describe, expect, it } from "vitest";
import { rulesFor } from "@/lib/rules/person-rules";

// 확인 상태가 needs_check인 규칙의 수를 고정해 둔다. 늘거나 줄면 의도한 변화인지 확인하고 숫자를 고친다.
describe("needs_check 규칙", () => {
  const list = (line: Parameters<typeof rulesFor>[0]) => rulesFor(line).filter((item) => item.status === "needs_check" || item.value === null);

  it("개인용: 5개", () => {
    expect(list("personal").map((item) => item.id).sort()).toEqual(["dailyWage.amount", "lostIncome.daysPerMonth", "rounding.won", "solatium.disability.overlap", "solatium.disability.overlapMax"]);
  });

  it("업무용·영업용·이륜차: 약관의 개정일을 확인하지 못해 모든 항목이 needs_check다", () => {
    for (const line of ["business", "commercial", "motorcycle"] as const) expect(list(line).length, line).toBe(rulesFor(line).length);
  });
});
