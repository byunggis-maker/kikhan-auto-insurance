import { describe, expect, it } from "vitest";
import { moneyAfterLabel, parseDeductible, parseMoney, singleMoney } from "@/lib/engine/money";

// 원본 앱에서 확인된 금액 변환 사례와 그 예외.

describe("금액 표현 변환", () => {
  it("단위를 정확히 바꾸고, 이미 원 단위인 값에 단위를 다시 곱하지 않는다", () => {
    for (const [raw, value] of [
      ["3천만원", 30_000_000],
      ["3억원", 300_000_000],
      ["30,000,000원", 30_000_000],
      ["30000000", 30_000_000],
      ["0원", 0],
      ["3백만원", 3_000_000],
      ["3십만원", 300_000],
      ["1,543만원", 15_430_000],
      ["1억 5천만원", 150_000_000],
      ["1.5억", 150_000_000],
      ["가입금액: 2억원", 200_000_000],
    ] as const) {
      expect(parseMoney(raw), raw).toBe(value);
      expect(parseMoney(parseMoney(raw)), raw).toBe(value);
    }
    expect(parseMoney("무한")).toBe("unlimited");
  });

  it("모호한 표현은 짐작하지 않고 null", () => {
    for (const raw of ["", "확인 필요", "3천원", "3천만원 또는 5천만원", "20% 최소 5만원 최대 50만원", "-100", "1억/2억", "1억 2억만원", null]) expect(parseMoney(raw), String(raw)).toBeNull();
  });

  it("'부상 3천만원'에서 3만 읽지 않는다", () => {
    const limit = "1인당 사망/후유장애 3억원, 1인당 부상 3천만원";
    expect(moneyAfterLabel(limit, ["부상"])).toBe(30_000_000);
    expect(moneyAfterLabel(limit, ["사망", "후유장애", "후유장해"])).toBe(300_000_000);
    expect(moneyAfterLabel("자동차상해 사망/후유장애 2억원 부상 3천만원", ["부상"])).toBe(30_000_000);
    expect(moneyAfterLabel("부상 3", ["부상"])).toBeNull();
    expect(moneyAfterLabel("부상 3천만원, 부상 5천만원", ["부상"])).toBeNull();
    expect(moneyAfterLabel("사망 1억원", ["부상"])).toBeNull();
  });

  it("금액이 하나만 든 글에서 그 금액을 꺼낸다", () => {
    expect(singleMoney("사고당 10억원 한도")).toBe(1_000_000_000);
    expect(singleMoney("차량가액 1,543만원 한도")).toBe(15_430_000);
    expect(singleMoney("1인당 무한")).toBe("unlimited");
    expect(singleMoney("1인당 2억원 한도")).toBe(200_000_000);
    expect(singleMoney("사망 3억원, 부상 3천만원")).toBeNull();
    expect(singleMoney("자동차손해배상 보장법에서 정한 금액")).toBeNull();
  });

  it("자기부담금 표현", () => {
    expect(parseDeductible("손해액의 20%(최저 20만원, 최고 50만원)")).toEqual({ type: "rate", ratePercent: 20, min: 200_000, max: 500_000 });
    expect(parseDeductible("손해액의 30% (최소 30만원, 최대 100만원)")).toEqual({ type: "rate", ratePercent: 30, min: 300_000, max: 1_000_000 });
    expect(parseDeductible("50만원")).toEqual({ type: "fixed", amount: 500_000 });
    expect(parseDeductible("20%")).toBeNull();
    expect(parseDeductible("")).toBeNull();
  });
});
