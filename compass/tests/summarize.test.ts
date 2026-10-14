import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calculateAccident } from "@/lib/engine/accident";
import { addRanges } from "@/lib/engine/range";
import { summarize } from "@/lib/engine/summarize";
import type { CoverageKey, Matrix, MatrixCell, Range } from "@/lib/engine/types";
import { rulesFor } from "@/lib/rules/person-rules";
import { accidentClaimSchema, matrixSchema } from "@/lib/schemas/accident-claim";

// 합산 불변식: 사람별 합계의 합 = 담보별 합계의 합 = 총합계. 어긋나면 실패한다.
// 내가 받을 금액(mine)과 상대방에게 지급될 금액(others)은 서로 더하지 않으므로 묶음마다 따로 확인한다.

function expectInvariants(matrix: Matrix) {
  const summary = summarize(matrix);
  expect(summary.groups.map((g) => g.group)).toEqual(["mine", "others"]);
  for (const group of summary.groups) {
    const byRow = addRanges(group.byRow.map((row) => row.amount));
    const byColumn = addRanges(group.byColumn.map((column) => column.amount));
    expect(byRow).toEqual(group.total);
    expect(byColumn).toEqual(group.total);
    // 총합계는 행렬의 칸을 직접 더한 값과 같다.
    const cells = matrix.cells.filter((cell) => cell.group === group.group && cell.status === "calculated" && cell.inTotal && cell.amount);
    for (const key of ["min", "expected", "max"] as const) expect(group.total[key]).toBe(cells.reduce((sum, cell) => sum + (cell.amount as Range)[key], 0));
    expect(group.countedCells).toBe(cells.length);
    // 사람별·담보별로 더한 칸 수도 칸에서 센 수와 같다.
    for (const row of group.byRow) expect(row.countedCells).toBe(cells.filter((cell) => cell.rowId === row.rowId).length);
    for (const column of group.byColumn) expect(column.countedCells).toBe(cells.filter((cell) => cell.columnId === column.columnId).length);
    expect(group.byRow.reduce((sum, row) => sum + row.countedCells, 0)).toBe(group.countedCells);
    expect(group.byColumn.reduce((sum, column) => sum + column.countedCells, 0)).toBe(group.countedCells);
    expect(group.total.min).toBeLessThanOrEqual(group.total.expected);
    expect(group.total.expected).toBeLessThanOrEqual(group.total.max);
  }
  return summary;
}

const COVERAGES: CoverageKey[] = ["liability_bodily_1", "liability_bodily_2", "auto_injury", "liability_property", "own_damage", "rider_legal", "rider_other"];

const cellArbitrary: fc.Arbitrary<MatrixCell> = fc
  .record({
    rowId: fc.constantFrom("p1", "p2", "p3", "p4", "row-not-listed"),
    coverage: fc.constantFrom(...COVERAGES),
    group: fc.constantFrom("mine" as const, "others" as const),
    status: fc.constantFrom("calculated" as const, "insufficient_info" as const, "not_applicable" as const, "needs_check" as const),
    inTotal: fc.boolean(),
    values: fc.array(fc.integer({ min: 0, max: 5_000_000_000 }), { minLength: 3, maxLength: 3 }),
  })
  .map(({ rowId, coverage, group, status, inTotal, values }) => {
    const [min, expected, max] = [...values].sort((a, b) => a - b);
    return {
      rowId,
      columnId: coverage,
      group,
      coverage,
      status,
      amount: status === "calculated" ? { min, expected, max } : null,
      inTotal: status === "calculated" && inTotal,
      lines: [],
      basis: [],
      missing: [],
      ruleIds: [],
      needsCheckRuleIds: [],
      flags: [],
      reason: null,
    };
  });

const matrixArbitrary: fc.Arbitrary<Matrix> = fc.array(cellArbitrary, { maxLength: 40 }).map((cells) => ({
  accidentDate: "2026-09-01",
  productLine: "personal",
  rows: ["p1", "p2", "p3", "p4"].map((id, index) => ({ id, label: `가상 인물 ${index + 1}`, group: index < 2 ? ("mine" as const) : ("others" as const) })),
  columns: COVERAGES.slice(0, 5).map((coverage) => ({ id: coverage, label: coverage, coverage })),
  cells,
}));

describe("합산 불변식", () => {
  it("아무 행렬에서나 사람별 합계의 합 = 담보별 합계의 합 = 총합계 (fast-check)", () => {
    fc.assert(fc.property(matrixArbitrary, (matrix) => void expectInvariants(matrix)), { numRuns: 500 });
  });

  it("계산되지 않은 칸과 합계에서 뺀 칸은 더하지 않는다", () => {
    fc.assert(
      fc.property(matrixArbitrary, (matrix) => {
        const without = { ...matrix, cells: matrix.cells.filter((cell) => cell.status === "calculated" && cell.inTotal) };
        expect(summarize(matrix).groups.map((g) => g.total)).toEqual(summarize(without).groups.map((g) => g.total));
      }),
      { numRuns: 200 },
    );
  });

  it("빈 행렬의 합계는 0원이 아니라 '더한 칸 없음'으로 구분할 수 있다", () => {
    const summary = summarize({ accidentDate: "2026-09-01", productLine: "personal", rows: [], columns: [], cells: [] });
    expect(summary.groups.every((group) => group.countedCells === 0)).toBe(true);
  });
});

describe("사고 한 건 전체", () => {
  const injury = { grade: 9, treatmentCost: 2_000_000, futureTreatmentCost: 0, hospitalDays: 0, outpatientDays: 5, daysOffWork: 0, dailyIncomeLoss: null, mealsNotProvided: 0, nursingProven: false };
  const human = (id: string, label: string, faultPercent: number) => ({
    id,
    label,
    age: 40,
    faultPercent,
    occupationType: "unemployed",
    monthlyIncome: null,
    incomeProven: null,
    vehicleDriver: true,
    injury,
    death: null,
    disability: null,
    receivedFromThirdParty: 0,
    receivedFromLiableParty: 0,
  });
  const vehicle = (id: string, ownerId: string, faultPercent: number, repairCost: number) => ({
    id,
    label: "가상 차량",
    ownerId,
    faultPercent,
    repairCost,
    totalLoss: false,
    valueAtAccident: 20_000_000,
    extendedRepairCap: false,
    firstRegisteredOn: "2019-01-01",
    commercialUse: false,
    rental: { rented: null, days: 0, dailyRate: null, longRepair: null },
    idle: null,
    towingCost: null,
  });
  // 쌍방과실(나 30 : 상대 70). 나와 상대 운전자가 각각 9급 부상, 양쪽 차량 수리.
  const claim = accidentClaimSchema.parse({
    accidentDate: "2026-09-01",
    productLine: "personal",
    persons: [
      { side: "mine", liable: { status: "full", bodily2Limit: "unlimited" }, own: { autoInjury: { injuryLimit: 30_000_000, deathDisabilityLimit: 200_000_000 }, selfInjury: null, uninsured: { limit: 200_000_000 } }, person: human("me", "가상 본인", 30) },
      { side: "others", liable: { status: "full", bodily2Limit: "unlimited" }, own: null, person: human("other", "가상 상대 운전자", 70) },
    ],
    vehicles: [
      { side: "mine", liable: { status: "insured", propertyLimit: 100_000_000 }, own: { ownDamage: { limit: 20_000_000, deductible: { type: "rate", ratePercent: 20, min: 200_000, max: 500_000 } }, rentalRider: null }, damage: vehicle("v-me", "me", 30, 3_000_000) },
      { side: "others", liable: { status: "insured", propertyLimit: 200_000_000 }, own: null, damage: vehicle("v-other", "other", 70, 2_000_000) },
    ],
    legal: null,
    otherRiders: [{ name: "긴급출동서비스 특약", insuredId: "me", insuredLabel: "가상 본인" }],
  });
  const matrix = calculateAccident(claim, rulesFor("personal"));

  it("사람 × 담보 행렬을 만들고, 받는 사람 묶음별로 합계를 낸다", () => {
    // 한 사람의 손해액: 치료비 2,000,000 + 위자료 9급 250,000 + 통원 5일 × 8,000 = 2,290,000
    // 나(과실 30%): 대인배상Ⅰ 2,290,000 × 70% = 1,603,000 → 치료비 보장 2,000,000(9급 한도 2,400,000 이내), 대인배상Ⅱ 0, 자동차상해 290,000
    //   차량: 대물배상 3,000,000 × 70% = 2,100,000, 자기차량손해 (3,000,000 − 2,100,000) − 최소 자기부담금 200,000 = 700,000
    //   내가 받을 합계 = 2,000,000 + 290,000 + 2,100,000 + 700,000 = 5,090,000
    // 상대(과실 70%): 대인배상Ⅰ 2,290,000 × 30% = 687,000 → 치료비 보장 2,000,000, 대물배상 2,000,000 × 30% = 600,000 → 합계 2,600,000
    const summary = expectInvariants(matrix);
    const [mine, others] = summary.groups;
    expect(mine.total).toEqual({ min: 5_090_000, expected: 5_090_000, max: 5_090_000 });
    expect(mine.byRow).toEqual([{ rowId: "me", amount: mine.total, countedCells: mine.countedCells }]);
    expect(Object.fromEntries(mine.byColumn.map((c) => [c.columnId, c.amount.expected]))).toMatchObject({ liability_bodily_1: 2_000_000, auto_injury: 290_000, liability_property: 2_100_000, own_damage: 700_000 });
    expect(others.total.expected).toBe(2_600_000);
    expect(others.byRow).toEqual([{ rowId: "other", amount: others.total, countedCells: others.countedCells }]);
    // 두 묶음을 더한 값은 어디에도 없다.
    expect(JSON.stringify(summary)).not.toContain(String(5_090_000 + 2_600_000));
  });

  it("행렬은 저장용 스키마를 통과하고, 다시 읽어 합산해도 같은 값이다", () => {
    const stored = JSON.parse(JSON.stringify(matrix));
    expect(matrixSchema.safeParse(stored).success).toBe(true);
    expect(summarize(stored as Matrix)).toEqual(summarize(matrix));
  });

  it("모든 칸에서 최소 ≤ 예상 ≤ 최대이고, 계산되지 않은 칸은 금액이 null이다", () => {
    for (const cell of matrix.cells) {
      if (cell.status !== "calculated") expect(cell.amount).toBeNull();
      else {
        expect(cell.amount?.min).toBeLessThanOrEqual(cell.amount?.expected as number);
        expect(cell.amount?.expected).toBeLessThanOrEqual(cell.amount?.max as number);
      }
      expect(cell.inTotal).toBe(cell.status === "calculated");
    }
  });
});

describe("엔진이 만든 행렬의 합산 불변식(만 나이·사망·후유장애 포함)", () => {
  const personArbitrary = fc.record({
    age: fc.option(fc.integer({ min: 0, max: 95 }), { nil: null }),
    faultPercent: fc.integer({ min: 0, max: 100 }),
    monthlyIncome: fc.option(fc.integer({ min: 0, max: 20_000_000 }), { nil: null }),
    incomeProven: fc.option(fc.boolean(), { nil: null }),
    kind: fc.constantFrom("injury", "death", "disability"),
    lossRate: fc.integer({ min: 0, max: 100 }),
    deathAfterDays: fc.integer({ min: 0, max: 400 }),
  });
  const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  it("무작위 사람 1~3명: 칸마다 최소 ≤ 예상 ≤ 최대, 사람별 합 = 담보별 합 = 총합", () => {
    fc.assert(
      fc.property(fc.array(personArbitrary, { minLength: 1, maxLength: 3 }), (people) => {
        const claim = accidentClaimSchema.parse({
          accidentDate: "2026-09-01",
          productLine: "personal",
          persons: people.map((p, index) => ({
            side: index === 0 ? "mine" : "others",
            liable: { status: "full", bodily2Limit: "unlimited" },
            own: index === 0 ? { autoInjury: { injuryLimit: 30_000_000, deathDisabilityLimit: 200_000_000 }, selfInjury: null, uninsured: { limit: 200_000_000 } } : null,
            person: {
              id: `p${index}`,
              label: `사람 ${index}`,
              age: p.age,
              faultPercent: p.faultPercent,
              occupationType: "employee",
              monthlyIncome: p.monthlyIncome,
              incomeProven: p.incomeProven,
              vehicleDriver: true,
              injury: { grade: 7, treatmentCost: 3_000_000, futureTreatmentCost: 0, hospitalDays: 10, outpatientDays: 5, daysOffWork: 0, dailyIncomeLoss: null, mealsNotProvided: 0, nursingProven: false },
              death: p.kind === "death" ? { date: addDays("2026-09-01", p.deathAfterDays) } : null,
              disability: p.kind === "disability" ? { lossRatePercent: String(p.lossRate), grade: 9, determinedOn: null } : null,
              receivedFromThirdParty: 0,
              receivedFromLiableParty: 0,
            },
          })),
          vehicles: [],
          legal: null,
          otherRiders: [],
        });
        const matrix = calculateAccident(claim, rulesFor("personal"));
        for (const cell of matrix.cells) {
          if (!cell.amount) continue;
          expect(cell.amount.min).toBeLessThanOrEqual(cell.amount.expected);
          expect(cell.amount.expected).toBeLessThanOrEqual(cell.amount.max);
          expect(Number.isInteger(cell.amount.min) && Number.isInteger(cell.amount.max)).toBe(true);
        }
        expectInvariants(matrix);
      }),
      { numRuns: 300 },
    );
  });
});
