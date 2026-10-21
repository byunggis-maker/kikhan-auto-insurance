import { writeFileSync, mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculate } from "@/lib/engine/dual-run";
import { calculateScenarios } from "@/lib/engine/fault-scenarios";
import type { Result } from "@/lib/engine/types";
import { CASES } from "./cases";
import { policySchema } from "@/lib/claim/types";
import { claim, item, myPolicy, selfInjuryPolicy, victim } from "./fixtures";
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

  it("사례 6: 운전자 범위 위반 — 대물 0원(약관대로), 대물 손해 전액 25,000,000이 '대물로 보상 안 되는 배상책임'", () => {
    const r = results.get(6)!;
    const l = r.lines.find((x) => x.key === "상대차:liability_property:own_insurer")!;
    expect([l.status, l.confirmed, l.withEstimates, l.alternative]).toEqual(["excluded", 0, 0, undefined]);
    expect(l.basis).toContain("운전자 한정운전 특별약관");
    const burden = r.burdens.find((b) => b.key === "상대차:property_uncovered")!;
    expect([burden.label, burden.confirmed]).toEqual(["상대차: 대물로 보상 안 되는 배상책임", 25_000_000]);
    expect(r.totals.burden.confirmed).toBe(25_530_000);
  });

  it("안내 줄(합계 제외)은 추정분을 비운다: 사례 3 경상 본인 부담분 확정 540,000 / 추정 포함 333,000 / 추정분 없음", () => {
    const note = results.get(3)!.notes.find((n) => n.key === "상대운전자:minor_share")!;
    expect([note.confirmed, note.withEstimates, note.estimatePart]).toEqual([540_000, 333_000, null]);
  });

  it("가족 동승자: '상대 보험은 상대 과실분만 지급, 나머지는 내 대인Ⅰ·자동차상해'(피해자 측 과실, 결정 기록 D-22)", () => {
    const family = results.get(10)!.lines.find((l) => l.key === "자녀:liability_bodily_1:counterparty_insurer")!;
    expect(family.flags).toContain("상대 보험은 상대 과실분(70%)만 지급합니다(운전자 과실을 피해자 측 과실로 뺌). 나머지는 내 대인Ⅰ·자동차상해에서 받습니다");
    const spouse = results.get(2)!.lines.find((l) => l.key === "배우자:liability_bodily_1:counterparty_insurer")!;
    expect(spouse.flags.join()).toContain("상대 과실분(60%)");
    expect(spouse.flags.join()).not.toContain("전액 청구");
    const other = results.get(11)!.lines.find((l) => l.key === "동료:liability_bodily_1:counterparty_insurer")!;
    expect(other.flags).toContain("어느 한쪽 보험사에 전액 청구할 수 있습니다(공동 배상)");
  });

  it("약관 기준 자동 산정(사례 20): 계산식에 근거 쪽이 붙고, 사용자가 금액을 넣으면 그 값이 우선", () => {
    const card = results.get(20)!.cards[0];
    const detail = (code: string) => card.details.find((d) => d.code === code)!;
    expect([detail("lost_income").confirmed, detail("lost_income").withEstimates]).toEqual([0, 850_000]);
    expect(detail("lost_income").formula).toBe("월소득 3,000,000원 ÷ 30일 × 휴업 10일 × 85% = 850,000원 (별표1 나. 부상 3. 휴업손해, 인쇄 76쪽; 한 달을 30일로 보고 계산, 원 미만 버림)");
    expect(detail("other_injury").withEstimates).toBe(80_000);
    expect(detail("other_injury").formula).toContain("인쇄 78쪽");
    expect(detail("solatium_injury").formula).toContain("인쇄 76쪽");
    // 사용자가 휴업손해 추정 금액을 직접 넣으면 그 값을 쓴다
    const base = CASES.find((c) => c.no === 20)!.claim;
    const typed = { ...base, victims: base.victims.map((v) => ({ ...v, losses: v.losses.map((i) => (i.code === "lost_income" ? { ...i, estimated: 500_000, source: { confirmed: null, estimated: "user_estimate" as const } } : i)) })) };
    expect(calculate(typed, 30).cards[0].details.find((d) => d.code === "lost_income")?.withEstimates).toBe(500_000);
    // 입원 식대: 병원 식사를 받지 않은 끼니 수로 계산. 입원일수만 있으면 끼니 수를 물어본다
    const meals = { ...base, victims: base.victims.map((v) => ({ ...v, outpatientDays: null, mealsNotProvided: 12 })) };
    expect(calculate(meals, 30).cards[0].details.find((d) => d.code === "other_injury")?.withEstimates).toBe(48_360);
    const daysOnly = { ...base, victims: base.victims.map((v) => ({ ...v, outpatientDays: null, hospitalDays: 5 })) };
    expect(calculate(daysOnly, 30).cards[0].notes.join()).toContain("병원 식사를 받지 않은 끼니 수를 넣으면 계산합니다");
  });

  it("사고일에 시행 중인 판의 PDF가 없으면 최신 판으로 계산하고 알린다(사고일 2026-09-01, 등록된 판 2026-10-25)", () => {
    const r = results.get(1)!;
    expect(r.edition).toEqual({ id: "2026-10-25", matched: false });
    expect(r.notices.join()).toContain("2026-10-25 개정 약관 기준으로 계산했습니다. 사고일(2026-09-01)에 시행되던 약관과 내용이 다를 수 있으니 보험사에 확인하세요.");
    expect(r.notices.join()).not.toContain("data/raw");
    const base = CASES.find((c) => c.no === 1)!.claim;
    const after = calculate({ ...base, accident: { ...base.accident, occurredAt: "2026-11-01" } }, 30);
    expect(after.edition).toEqual({ id: "2026-10-25", matched: true });
    expect(after.notices.join()).not.toContain("다를 수 있으니");
  });

  it("휴업손해: '소득 증명 가능'이 아니면 0원이고 증명했을 때의 금액은 참고로 남긴다(결정 기록 D-24)", () => {
    const base = CASES.find((c) => c.no === 20)!.claim;
    for (const incomeProven of [false, null]) {
      const r = calculate({ ...base, victims: base.victims.map((v) => ({ ...v, incomeProven })) }, 30);
      const d = r.cards[0].details.find((x) => x.code === "lost_income")!;
      expect(d.withEstimates).toBe(0);
      expect(d.formula).toContain("참고: 증명하면 월소득 3,000,000원 ÷ 30일 × 휴업 10일 × 85% = 850,000원");
    }
    // 사용자가 넣은 휴업손해 추정액도 같은 요건. 서류 금액(확정)은 증명된 것으로 본다
    const c2 = CASES.find((c) => c.no === 2)!.claim;
    const unproven = calculate({ ...c2, victims: c2.victims.map((v) => ({ ...v, incomeProven: false })) }, 40);
    expect(unproven.cards[0].actualLoss.withEstimates).toBe(2_230_000);
    const c1 = CASES.find((c) => c.no === 1)!.claim;
    expect(calculate(c1, 30).cards[0].actualLoss.confirmed).toBe(3_180_000);
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

describe("휴업손해 직업 구분(별표1 나. 3. 다., 인쇄 77쪽, 결정 기록 D-27)", () => {
  const base = CASES.find((c) => c.no === 20)!.claim;
  const withJob = (occupation: "employed" | "homemaker" | "unemployed" | "no_income") => calculate({ ...base, victims: base.victims.map((v) => ({ ...v, occupation })) }, 30).cards[0];

  it("무직자·유아·학생·연금생활자 등은 수입 감소가 없는 것으로 0원(사용자 추정액이 있어도)", () => {
    for (const job of ["unemployed", "no_income"] as const) {
      const d = withJob(job).details.find((x) => x.code === "lost_income")!;
      expect(d.withEstimates).toBe(0);
      expect(d.formula).toContain("수입의 감소가 없는 것으로 함");
    }
  });

  it("유직자는 월소득 기준(지금과 같음)", () => {
    expect(withJob("employed").details.find((x) => x.code === "lost_income")?.withEstimates).toBe(850_000);
  });

  it("가사종사자 휴업손해는 월 환산(라운드 6c): 사고일 2026-09-01, 휴업 10일 → 월 3,355,800원(일 134,232원 × 25일) ÷ 30 × 85% × 10일 = 950,810원", () => {
    const d = withJob("homemaker").details.find((x) => x.code === "lost_income")!;
    // 3,355,800 ÷ 30 = 111,860 → × 85% = 95,081 → × 10일 = 950,810
    expect(d.withEstimates).toBe(950_810);
    expect(d.formula).toContain("가사종사자: 월 3,355,800원(일 134,232원 × 25일) ÷ 30 × 85% × 10일 = 950,810원");
    expect(d.formula).toContain("(보통인부 172,698원 + 단순노무 95,767원) ÷ 2 = 134,232원, 약관 별표1(인쇄 74쪽)");
    expect(d.formula).not.toContain("검토 필요");
    expect(d.formula).not.toContain("적용일 추정");
  });

  it("일용근로자 임금은 사고일에 적용 중인 두 단가의 평균, 원 미만은 단계마다 버림. 2026-01-01 전은 입력 필요", () => {
    const at = (occurredAt: string) => calculate({ ...base, accident: { ...base.accident, occurredAt }, victims: base.victims.map((v) => ({ ...v, occupation: "homemaker" as const })) }, 30).cards[0];
    // 2026-08: (172,068 + 95,767) ÷ 2 = 133,917 → 월 3,347,925 ÷ 30 = 111,597 → × 85% = 94,857 → × 10 = 948,570
    const august = at("2026-08-15").details.find((x) => x.code === "lost_income")!;
    expect(august.withEstimates).toBe(948_570);
    expect(august.formula).toContain("보통인부 172,068원 + 단순노무 95,767원");
    // 2026-03: (172,068 + 90,694) ÷ 2 = 131,381 → 월 3,284,525 ÷ 30 = 109,484 → × 85% = 93,061 → × 10 = 930,610, 단순노무 적용일 추정
    const march = at("2026-03-10").details.find((x) => x.code === "lost_income")!;
    expect(march.withEstimates).toBe(930_610);
    expect(march.formula).toContain("보통인부 172,068원 + 단순노무 90,694원(적용일 추정)");
    const before = at("2025-12-31");
    expect(before.missing).toContain("lost_income");
    expect(before.notes.join()).toContain("적용할 일용근로자 임금 값이 아직 없습니다");
  });

  it("유직자가 월소득 금액을 증명하지 못하면(incomeAmountProven = false) 일용근로자 임금으로 계산(결정 기록 D-32)", () => {
    const r = calculate({ ...base, victims: base.victims.map((v) => ({ ...v, occupation: "employed" as const, incomeAmountProven: false })) }, 30);
    const d = r.cards[0].details.find((x) => x.code === "lost_income")!;
    expect(d.withEstimates).toBe(950_810);
    expect(d.formula).toContain("소득 금액 증명 곤란(유직자): 월 3,355,800원(일 134,232원 × 25일) ÷ 30 × 85% × 10일");
    expect(d.formula).toContain("인쇄 74쪽");
    expect(r.notices.join()).toContain("일용근로자 임금 134,232원으로 계산했습니다");
    // 수입 감소(휴업) 사실도 증명하지 못하면 0원(D-24)
    const none = calculate({ ...base, victims: base.victims.map((v) => ({ ...v, occupation: "employed" as const, incomeAmountProven: false, incomeProven: false })) }, 30);
    expect(none.cards[0].details.find((x) => x.code === "lost_income")?.withEstimates).toBe(0);
  });
});

describe("상대 대인Ⅱ 가입 여부 모름(라운드 2 결정 4)", () => {
  // 운전자 14급, 내 과실 0%, 손해 1,030,000. 상대는 보험에 들었지만 대인Ⅱ 가입 여부를 모른다.
  const base = claim({ myFault: 0, victims: [victim({ id: "나", role: "driver", relationToNamedInsured: "self", vehicleDriver: true, injuryGrade: 14, losses: [item("treatment", { c: 800_000 }), item("solatium_injury", { c: 150_000 }), item("other_injury", { c: 80_000 })] })] });
  const unknown = { ...base, counterpartyPolicy: { ...base.counterpartyPolicy!, hasBodily2: null } };
  const r = calculate(unknown, 0);

  it("'상대 대인Ⅱ 있음 / 없음' 두 시나리오를 함께 낸다", () => {
    expect(r.bodily2Scenarios).not.toBeNull();
    const { withBodily2, withoutBodily2 } = r.bodily2Scenarios!;
    const amount = (x: typeof r, key: string) => x.lines.find((l) => l.key === key)?.withEstimates ?? 0;
    // 있음: 상대 대인Ⅰ 500,000 + 상대 대인Ⅱ 530,000, 내 보험 0
    expect([amount(withBodily2, "나:liability_bodily_1:counterparty_insurer"), amount(withBodily2, "나:liability_bodily_2:counterparty_insurer"), withBodily2.totals.byPayer.own_insurer.withEstimates]).toEqual([500_000, 530_000, 0]);
    // 없음(책임보험만): 상대 대인Ⅰ 500,000 + 내 무보험차상해 530,000(공제 후 자동차상해 0)
    expect([amount(withoutBodily2, "나:liability_bodily_1:counterparty_insurer"), amount(withoutBodily2, "나:uninsured:own_insurer"), amount(withoutBodily2, "나:auto_injury:own_insurer")]).toEqual([500_000, 530_000, 0]);
    expect(r.notices.join()).toContain("상대 대인Ⅱ 있음: 받을 돈 1,030,000원 / 상대 대인Ⅱ 없음: 받을 돈 1,030,000원");
  });

  it("두 경우의 받는 총액은 같다(1,030,000), 받을 곳만 다르다", () => {
    const { withBodily2, withoutBodily2 } = r.bodily2Scenarios!;
    expect(withBodily2.totals.receive).toEqual(withoutBodily2.totals.receive);
    expect(withBodily2.totals.receive.withEstimates).toBe(1_030_000);
    expect(withBodily2.totals.byPayer.counterparty_insurer.withEstimates).toBe(1_030_000);
    expect(withoutBodily2.totals.byPayer.counterparty_insurer.withEstimates).toBe(500_000);
  });

  it("무보험차상해가 없는 내 보험이면 '없음' 시나리오에서는 자동차상해가 530,000을 준다", () => {
    const noUninsured = { ...unknown, myPolicy: { ...unknown.myPolicy, coverages: unknown.myPolicy.coverages.filter((c) => c.coverage !== "uninsured") } };
    const without = calculate(noUninsured, 0).bodily2Scenarios!.withoutBodily2;
    expect(without.lines.find((l) => l.key === "나:auto_injury:own_insurer")?.withEstimates).toBe(530_000);
    expect(without.totals.receive.withEstimates).toBe(1_030_000);
  });
});

describe("입력 검증", () => {
  it("자동차상해와 자기신체사고는 둘 중 하나만 가입할 수 있다", () => {
    const both = myPolicy({ add: [{ coverage: "self_injury", limit: null, injuryLimit: 30_000_000, deathLimit: 30_000_000, disabilityLimit: 30_000_000 }] });
    const result = policySchema.safeParse(both);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("자동차상해와 자기신체사고는 둘 중 하나만 가입할 수 있습니다");
    expect(policySchema.safeParse(selfInjuryPolicy()).success).toBe(true);
  });

  it("자기신체사고 부상 가입금액이 별표3 표에 없으면 '입력 필요'", () => {
    const base = CASES.find((c) => c.no === 16)!.claim;
    const odd = { ...base, myPolicy: { ...base.myPolicy, coverages: base.myPolicy.coverages.map((c) => (c.coverage === "self_injury" ? { ...c, injuryLimit: 20_000_000 } : c)) } };
    const l = calculate(odd, 30).lines.find((x) => x.coverage === "self_injury")!;
    expect(l.status).toBe("needs_input");
    expect(l.formula).toContain("별표3 부상 가입금액표에 없는 금액");
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
