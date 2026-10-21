import { describe, expect, it } from "vitest";
import { findSensitive, maskText } from "@/lib/privacy/mask";

describe("개인정보 가림", () => {
  it.each([
    ["주민번호 900101-1234567 입니다", "주민번호 ●●●●●●-●●●●●●● 입니다"],
    ["9001011234567", "●●●●●●●●●●●●●"],
    ["연락처 010-1234-5678", "연락처 ●●●-●●●●-●●●●"],
    ["사무실 02-345-6789로", "사무실 ●●-●●●-●●●●로"],
    ["상대 차 12가3456, 내 차 서울123나4567", "상대 차 ●●●●●●●, 내 차 ●●●●●●●●●●"],
    ["증권번호 2026-123456789", "증권번호 ●●●●-●●●●●●●●●"],
  ])("%s", (input, expected) => {
    expect(maskText(input)).toBe(expected);
    expect(findSensitive(maskText(input))).toEqual([]);
  });

  it("줄이 다른 숫자나 더 긴 숫자 묶음 안은 주민번호로 보지 않는다", () => {
    expect(findSensitive("3180000\n3180000")).toEqual([]);
    expect(findSensitive("12345678901234567890")).toEqual(["증권번호"]);
  });

  it("금액·날짜·짧은 숫자는 그대로 둔다", () => {
    for (const text of ["치료비 2,000,000원", "사고일 2026-09-01", "12급, 과실 30%", "별표1 나. 3. (인쇄 76쪽)", "3,180,000원 × 70% = 2,226,000원"]) expect(maskText(text)).toBe(text);
  });
});
