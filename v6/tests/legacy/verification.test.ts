import { describe, expect, it } from "vitest";
import { UNVERIFIED_NOTICE, verificationNotice } from "@/lib/engine/legacy/verification";
import { FAULT_ITEMS } from "./helpers";

// MASTER.md 6장: medicalFloor는 productLines ["personal"]로만 검증됐다. 다른 보험 종류에서 쓰면 표시를 붙인다.

describe("미검증 표시", () => {
  it("이식한 fault.json은 개인용으로만 검증된 상태 그대로다", () => {
    expect(FAULT_ITEMS.find((item) => item.id === "fault.medicalFloor")?.productLines).toEqual(["personal"]);
  });

  it("개인용이면 표시가 없다", () => {
    expect(verificationNotice(FAULT_ITEMS, ["fault.medicalFloor", "fault.minorInjuryGrades"], "personal")).toBeNull();
  });

  it.each(["business", "commercial", "motorcycle"] as const)("%s에서 쓰면 '미검증: 해당 약관 대조 필요'", (productLine) => {
    const result = verificationNotice(FAULT_ITEMS, ["fault.medicalFloor", "fault.medicalFloor"], productLine);
    expect(result).toEqual({ notice: UNVERIFIED_NOTICE, ruleIds: ["fault.medicalFloor"] });
    expect(UNVERIFIED_NOTICE).toBe("미검증: 해당 약관 대조 필요");
  });

  it("규칙 목록에 없는 id는 판단하지 않는다", () => {
    expect(verificationNotice(FAULT_ITEMS, ["liability1.injury.limit.grade9"], "business")).toBeNull();
  });
});
