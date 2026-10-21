import { writeFileSync, mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculate } from "@/lib/engine/dual-run";
import { calculateScenarios } from "@/lib/engine/fault-scenarios";
import type { Result } from "@/lib/engine/types";
import { CASES } from "./cases";
import { claim, item, victim } from "./fixtures";
import { reportMarkdown } from "./report";

// 라운드 2 사례 (1)~(15)와 자기검사. REPORT=1이면 .tmp/round2-cases.md에 입력값 표와 결과 표를 쓴다.

const results = new Map<number, Result>(CASES.map((c) => [c.no, calculate(c.claim, c.claim.fault.mode === "known" ? c.claim.fault.myPercent : 0)]));

describe.each(CASES)("사례 ($no) $title", (c) => {
  const result = results.get(c.no) as Result;
  const line = (key: string) => result.lines.find((l) => l.key === key);

  it("기대값(손 검산)과 같다", () => {
    for (const [key, [confirmed, withEstimates]] of Object.entries(c.expected)) {
      const found = line(key);
      expect(found, `${key} 줄이 없음. 있는 줄: ${result.lines.map((l) => l.key).join(", ")}`).toBeDefined();
      expect([found!.confirmed, found!.withEstimates], key).toEqual([confirmed, withEstimates]);
    }
    for (const [key, [confirmed, withEstimates]] of Object.entries(c.burdens ?? {})) {
      const found = result.burdens.find((b) => b.key === key);
      expect(found, `내가 낼 돈 ${key}`).toBeDefined();
      expect([found!.confirmed, found!.withEstimates], key).toEqual([confirmed, withEstimates]);
    }
    for (const key of c.excluded ?? []) expect(line(key)?.status, key).toBe("excluded");
    // 기대값에 없는 지급 줄이 생기지 않는다
    for (const l of result.lines) if (l.status === "paid" && l.withEstimates > 0) expect(Object.keys(c.expected), `예상 밖 지급 줄 ${l.key}`).toContain(l.key);
  });

  it("자기검사: 사람·물건별 지급 합계 ≤ 실제손해", () => {
    for (const card of result.cards) {
      expect(card.paid.confirmed, `${card.cardId} 확정`).toBeLessThanOrEqual(card.actualLoss.confirmed);
      expect(card.paid.withEstimates, `${card.cardId} 추정 포함`).toBeLessThanOrEqual(card.actualLoss.withEstimates);
    }
  });

  it("자기검사: 확정액 ≤ 추정 포함액, 추정분 = 추정 포함액 − 확정액", () => {
    for (const l of [...result.lines, ...result.burdens]) {
      expect(l.confirmed, l.key).toBeLessThanOrEqual(l.withEstimates);
      expect(l.estimatePart, l.key).toBe(l.withEstimates - l.confirmed);
    }
  });

  it("모든 금액 줄에 계산식과 근거 조항이 있다", () => {
    for (const l of result.lines) {
      expect(l.formula.length, l.key).toBeGreaterThan(0);
      expect(l.basis.length, l.key).toBeGreaterThan(0);
    }
  });
});

describe("사례별 추가 자기검사", () => {
  it("사례 8: 추정분 = 1,000,000, 내가 낼 돈(한도 초과)은 확정 0 / 추정 포함 2,000,000", () => {
    const r = results.get(8)!;
    expect(r.lines.find((l) => l.key === "상대차:liability_property:own_insurer")?.estimatePart).toBe(1_000_000);
    expect(r.totals.burden).toEqual({ confirmed: 0, withEstimates: 2_000_000, estimatePart: 2_000_000 });
  });

  it("사례 2: 내 대인Ⅱ = 0(면책), 상대 대인 + 내 대인Ⅰ + 내 자동차상해 ≤ 실제손해", () => {
    const r = results.get(2)!;
    const mine2 = r.lines.find((l) => l.key === "배우자:liability_bodily_2:own_insurer")!;
    expect([mine2.status, mine2.confirmed, mine2.withEstimates]).toEqual(["excluded", 0, 0]);
    expect(mine2.basis).toContain("제8조②1호");
    const card = r.cards.find((c) => c.cardId === "배우자")!;
    const sum = (k: "confirmed" | "withEstimates") =>
      r.lines.filter((l) => l.cardId === "배우자" && ["counterparty_insurer", "own_insurer"].includes(l.payer) && l.status === "paid").reduce((s, l) => s + l[k], 0);
    expect(sum("confirmed")).toBeLessThanOrEqual(card.actualLoss.confirmed);
    expect(sum("withEstimates")).toBeLessThanOrEqual(card.actualLoss.withEstimates);
    expect([card.actualLoss.confirmed, card.actualLoss.withEstimates]).toEqual([2_230_000, 3_730_000]);
  });

  it("사례 3: 경상 본인 부담분 540,000(확정)은 상대방 자동차상해·자기신체사고에서 처리 줄로 따로 표시", () => {
    const note = results.get(3)!.notes.find((n) => n.key === "상대운전자:minor_share")!;
    expect([note.confirmed, note.withEstimates]).toEqual([540_000, 333_000]);
    expect(note.text).toContain("자동차상해·자기신체사고에서 처리");
  });

  it("사례 4: 받을 곳은 정부보장사업뿐이고 이름은 '대인Ⅰ 상당액(정부보장사업)'", () => {
    const r = results.get(4)!;
    expect(r.lines.find((l) => l.payer === "government")?.label).toBe("대인Ⅰ 상당액(정부보장사업)");
    expect(r.totals.byPayer.government).toEqual({ confirmed: 9_000_000, withEstimates: 9_000_000, estimatePart: 0 });
    expect(r.cards[0].uncovered).toEqual({ confirmed: 750_000, withEstimates: 3_388_360, estimatePart: 2_638_360 });
  });

  it("사례 6: 운전자 범위 위반 대물은 '약관과 다르게 가정' 표시와 약관 문구대로의 금액(0원)을 함께 낸다", () => {
    const l = results.get(6)!.lines.find((x) => x.key === "상대차:liability_property:own_insurer")!;
    expect(l.flags.join()).toContain("약관과 다르게 가정");
    expect(l.alternative).toMatchObject({ confirmed: 0, withEstimates: 0 });
  });

  it("사례 7: 미분류 합계에는 치료관계비 하한을 쓰지 않고 '항목을 나누면 더 정확해집니다'를 안내", () => {
    const r = results.get(7)!;
    expect(r.cards[0].notes.join()).toContain("항목을 나누면 더 정확해집니다");
    expect(r.lines.find((l) => l.key === "나:liability_bodily_1:counterparty_insurer")?.withEstimates).toBe(900_000);
  });

  it("사례 11: 호의동승 감액은 자동으로 하지 않고, 고르면 적용하고 '검토 필요'", () => {
    const base = CASES.find((c) => c.no === 11)!.claim;
    const reduced = { ...base, victims: base.victims.map((v) => ({ ...v, rideAlongReductionPercent: 20 })) };
    const l = calculate(reduced, 30).lines.find((x) => x.key === "동료:liability_bodily_1:own_insurer")!;
    expect(l.confirmed).toBe(184_000); // 230,000 × 80%
    expect(l.flags.join()).toContain("검토 필요: 호의동승 감액 20%");
  });

  it("자기차량손해: 음주인데 운전자 관계를 모르면 지급액과 면책(0원)을 함께 내고 '운전자 관계 확인 필요'", () => {
    const base = CASES.find((c) => c.no === 14)!.claim;
    const unknown = { ...base, accident: { ...base.accident, violations: { ...base.accident.violations, drunk: true, driverRelation: null } } };
    const l = calculate(unknown, 30).lines.find((x) => x.key === "내차:own_damage:own_insurer")!;
    expect(l.confirmed).toBe(1_200_000);
    expect(l.alternative?.confirmed).toBe(0);
    expect(l.flags).toContain("운전자 관계 확인 필요");
    const other = { ...base, accident: { ...base.accident, violations: { ...base.accident.violations, drunk: true, driverRelation: "other" as const } } };
    expect(calculate(other, 30).lines.find((x) => x.key === "내차:own_damage:own_insurer")?.status).toBe("paid");
  });

  it("고의 사고는 계산하지 않고 안내만", () => {
    const base = CASES.find((c) => c.no === 1)!.claim;
    const r = calculate({ ...base, accident: { ...base.accident, violations: { ...base.accident.violations, intentional: true } } }, 30);
    expect(r.blocked).toContain("고의");
    expect(r.lines).toEqual([]);
  });
});

describe("과실 시나리오", () => {
  it("과실을 모르면 0·30·50·70%를 한 번에 계산한다", () => {
    const c = claim({ myFault: 0, victims: [victim({ id: "나", role: "driver", relationToNamedInsured: "self", vehicleDriver: true, injuryGrade: 14, losses: [item("treatment", { c: 800_000 }), item("solatium_injury", { c: 150_000 }), item("other_injury", { c: 80_000 })] })] });
    const scenarios = calculateScenarios({ ...c, fault: { mode: "unknown" } });
    expect(scenarios.map((r) => r.faultPercent)).toEqual([0, 30, 50, 70]);
    // 어느 과실이든 상대 대인 + 내 자동차상해 = 실제손해 1,030,000
    for (const r of scenarios) expect(r.totals.receive.confirmed).toBe(1_030_000);
    // 상대 보험 몫은 과실이 커질수록 줄어든다
    const fromCounterparty = scenarios.map((r) => r.totals.byPayer.counterparty_insurer.confirmed);
    expect(fromCounterparty).toEqual([...fromCounterparty].sort((a, b) => b - a));
    expect(calculateScenarios(c)).toHaveLength(1);
  });
});

if (process.env.REPORT === "1") {
  mkdirSync(".tmp", { recursive: true });
  writeFileSync(".tmp/round2-cases.md", reportMarkdown(CASES, results));
}
