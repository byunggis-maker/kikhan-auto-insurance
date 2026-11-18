import { describe, expect, it } from "vitest";
import { hasApiKey, keyState } from "@/lib/ai/anthropic";
import { emptyClaim, type Claim } from "@/lib/claim/types";
import { calculate } from "@/lib/engine/dual-run";
import { buildReview } from "@/lib/report/review";
import { counterpartyOf, newProperty, setItem, setOtherCount, setPersonFacts, setVictimCount } from "@/lib/ui/flow";

// 라운드 9b: 키 만료, 다친 사람의 위치에 따른 받을 곳, 차량가액 추정 표시.

describe("키 만료(AI_KEY_EXPIRES)", () => {
  const env = { ANTHROPIC_API_KEY: "x", AI_KEY_EXPIRES: "2026-11-21" };
  const at = (iso: string) => new Date(iso);
  it("8일 전은 ok, 7일 전부터 soon, 만료일 당일까지 쓸 수 있고 다음 날 expired", () => {
    expect(keyState(env, at("2026-11-13T12:00:00+09:00"))).toBe("ok");
    expect(keyState(env, at("2026-11-14T12:00:00+09:00"))).toBe("soon");
    expect(keyState(env, at("2026-11-21T23:00:00+09:00"))).toBe("soon");
    expect(keyState(env, at("2026-11-22T00:30:00+09:00"))).toBe("expired");
    expect(hasApiKey(env, at("2026-11-22T00:30:00+09:00"))).toBe(false);
    expect(hasApiKey(env, at("2026-11-18T12:00:00+09:00"))).toBe(true);
    expect(keyState({ ANTHROPIC_API_KEY: "x" })).toBe("ok");
  });
});

// 법령 API 시험은 라운드 9d에서 원문 미리받기 스크립트 시험으로 옮겼다(tests/ui/round9d.test.ts)

describe("다친 사람의 위치(내 차 동승자 / 상대 차량 탑승자 / 보행자)", () => {
  const base = (): Claim => ({
    ...emptyClaim(),
    accident: { ...emptyClaim().accident, occurredAt: "2026-10-01", type: "car_car" },
    myPolicy: { ...emptyClaim().myPolicy, productLine: "personal", coverages: [{ coverage: "liability_bodily_1", limit: null, injuryLimit: null, deathLimit: null, disabilityLimit: null }, { coverage: "liability_bodily_2", limit: "unlimited", injuryLimit: null, deathLimit: null, disabilityLimit: null }] },
    counterpartyPolicy: counterpartyOf(emptyClaim(), "full"),
  });
  // 치료비만 넣으면 치료관계비 하한(별표4)으로 과실과 관계없이 전액이라, 위자료로 과실 나눔을 본다
  const withLoss = (c: Claim) => setItem({ ...c, victims: c.victims.map((v) => (v.id === "other-1" ? { ...v, injuryGrade: 5 } : v)) }, "other-1", "solatium_injury", { confirmed: 1_000_000 });
  const payers = (c: Claim) =>
    calculate(c, 30)
      .lines.filter((l) => l.cardId === "other-1" && l.status === "paid" && l.confirmed > 0)
      .map((l) => `${l.payer}:${l.coverage}:${l.confirmed}`);

  it("새 사람은 상대 차량 탑승자(차대사람이면 보행자), 위치를 바꾸면 역할·이름이 바뀐다", () => {
    let c = setOtherCount(setVictimCount(base(), "driver", 1), 1);
    expect(c.victims[1]).toMatchObject({ id: "other-1", role: "counterparty", position: "counterparty_vehicle", label: "상대 차량 탑승자 1" });
    c = setPersonFacts(c, "other-1", { position: "my_vehicle", relationToNamedInsured: "spouse" });
    expect(c.victims[1]).toMatchObject({ role: "family_passenger", label: "내 차 동승자 1", vehicleDriver: false });
    c = setPersonFacts(c, "other-1", { relationToNamedInsured: "none" });
    expect(c.victims[1].role).toBe("other_passenger");
    expect(setOtherCount({ ...base(), accident: { ...base().accident, type: "car_person" } }, 1).victims[0]).toMatchObject({ position: "pedestrian", label: "보행자 1" });
  });

  it("보행자·상대 차량 운전자: 내 대인배상이 내 과실분만", () => {
    const c = withLoss(setPersonFacts(setOtherCount(base(), 1), "other-1", { position: "pedestrian" }));
    expect(payers(c)).toEqual(["own_insurer:liability_bodily_1:300000"]);
    const driver = withLoss(setPersonFacts(setOtherCount(base(), 1), "other-1", { seat: "driver", vehicleDriver: true }));
    expect(payers(driver)).toEqual(["own_insurer:liability_bodily_1:300000"]);
  });

  it("상대 차량 동승자: 내 과실분은 내 대인배상, 상대 운전자 과실분은 상대 대인배상. '상대방에게 줄 돈'에는 내 보험분만", () => {
    const c = withLoss(setPersonFacts(setOtherCount(base(), 1), "other-1", { seat: "passenger" }));
    expect(payers(c)).toEqual(["own_insurer:liability_bodily_1:300000", "counterparty_insurer:liability_bodily_1:700000"]);
    expect(calculate(c, 30).totals.toCounterparty.confirmed).toBe(300_000);
  });

  it("내 차 동승자(가족 아님): 상대 대인배상 상대 과실분 + 내 대인배상 나머지", () => {
    const c = withLoss(setPersonFacts(setOtherCount(base(), 1), "other-1", { position: "my_vehicle", relationToNamedInsured: "none" }));
    expect(payers(c)).toEqual(["counterparty_insurer:liability_bodily_1:700000", "own_insurer:liability_bodily_1:300000"]);
  });
});

describe("차량가액 추정 표시", () => {
  it("검토서 카드에 '앱 자체 추정치' 한 줄", () => {
    const p = { ...newProperty("counterparty_vehicle", 1), valueAtAccident: 8_250_000, valueSource: "estimate" as const };
    const c: Claim = { ...emptyClaim(), accident: { ...emptyClaim().accident, occurredAt: "2026-10-01", type: "car_car" }, properties: [p] };
    const review = buildReview(c, [calculate(c, 30)], 0);
    expect(review.cards[0].notes[0]).toBe("사고 직전 가액(추정) 8,250,000원 — 보험개발원 차량기준가액이 아닌 앱 자체 추정치입니다");
  });
});
