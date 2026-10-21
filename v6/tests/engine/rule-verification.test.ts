import { describe, expect, it } from "vitest";
import { verificationNotice } from "@/lib/engine/legacy/verification";
import { withVerifiedProductLines } from "@/lib/engine/rule-verification";
import { FAULT_ITEMS } from "../legacy/helpers";

// 약관 대조로 같다고 확인한 보험 종류만 productLines에 더한다(결정 기록 D-2).

describe("검증된 보험 종류", () => {
  const verified = withVerifiedProductLines(FAULT_ITEMS);

  it("치료관계비 하한·경상 규정은 네 약관 별표4 문구가 같아 네 종류 모두 검증됨", () => {
    for (const id of ["fault.medicalFloor", "fault.minorInjuryGrades"])
      expect(verified.find((item) => item.id === id)?.productLines).toEqual(["personal", "business", "commercial", "motorcycle"]);
  });

  it("원본 규칙 목록은 바꾸지 않는다(legacy/data/fault.json은 원본 그대로)", () => {
    expect(FAULT_ITEMS.find((item) => item.id === "fault.medicalFloor")?.productLines).toEqual(["personal"]);
  });

  it("업무용에서 하한·경상 규정은 표시가 없고, 약관에 없는 원 미만 처리(rounding.won)만 '미검증'", () => {
    expect(verificationNotice(verified, ["fault.medicalFloor", "fault.minorInjuryGrades"], "business")).toBeNull();
    expect(verificationNotice(verified, ["fault.medicalFloor", "rounding.won"], "motorcycle")).toEqual({ notice: "미검증: 해당 약관 대조 필요", ruleIds: ["rounding.won"] });
  });
});
