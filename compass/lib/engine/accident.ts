import type { AccidentClaim } from "@/lib/schemas/accident-claim";
import type { RuleItem } from "@/lib/schemas/rules";
import { notApplicableCell } from "./cell";
import { calculatePersonCoverages } from "./coordinate";
import { legalCostRider, unregisteredRider } from "./coverages/riders";
import { openRules } from "./rules";
import type { CoverageCell, CoverageKey, Matrix, MatrixCell, RecipientGroup } from "./types";
import { calculateVehicleCoverages } from "./vehicle";

// 사고 한 건의 사람·차량·특약 칸을 모아 사람 × 담보 행렬을 만든다. 합계는 여기서 내지 않는다(summarize.ts).

export const COVERAGE_LABELS: Record<CoverageKey, string> = {
  liability_bodily_1: "대인배상Ⅰ",
  liability_bodily_2: "대인배상Ⅱ",
  uninsured: "무보험자동차에 의한 상해",
  auto_injury: "자동차상해",
  self_injury: "자기신체사고",
  liability_property: "대물배상",
  own_damage: "자기차량손해",
  rider_rental: "렌트비용지원 특약",
  rider_legal: "법률비용 지원 특약",
  rider_other: "그 밖의 특약",
};

const COLUMN_ORDER: CoverageKey[] = ["liability_bodily_1", "liability_bodily_2", "uninsured", "auto_injury", "self_injury", "liability_property", "own_damage", "rider_rental", "rider_legal"];
/** 상대방의 보험에서 나올 수도 있는 담보. 내 쪽 사람·차량의 이 칸은 상대방 계약이라 내 보험 종류로 거르지 않는다 */
const LIABILITY: CoverageKey[] = ["liability_bodily_1", "liability_bodily_2", "liability_property"];

/** ruleItems: 내 증권의 보험 종류에 맞춰 고른 규칙 목록(lib/rules의 rulesFor) */
export function calculateAccident(claim: AccidentClaim, ruleItems: RuleItem[]): Matrix {
  const { accidentDate } = claim;
  const rules = openRules(ruleItems, accidentDate);
  const productUsed: string[] = [];
  const productCoverages = rules.list<string>("product.coverages", productUsed);
  const productRiders = rules.list<string>("product.riders", productUsed);

  /** 이 보험 종류의 약관에 없는 담보·특약을 걸러 낸다 */
  function byProduct(cell: CoverageCell, group: RecipientGroup): CoverageCell {
    if (cell.status === "not_applicable" || cell.coverage === "rider_other") return cell;
    if (cell.coverage === "rider_legal" || cell.coverage === "rider_rental")
      return productRiders !== null && !productRiders.includes(cell.coverage) ? unregisteredRider(rules, cell.coverage, COVERAGE_LABELS[cell.coverage], ["product.riders"]) : cell;
    if (LIABILITY.includes(cell.coverage) && group === "mine") return cell;
    return productCoverages !== null && !productCoverages.includes(cell.coverage) ? notApplicableCell(rules, cell.coverage, "이 보험 종류의 약관에 없는 담보입니다") : cell;
  }

  const rows: Matrix["rows"] = [];
  const cells: MatrixCell[] = [];
  const addRow = (id: string, label: string, group: RecipientGroup) => {
    if (!rows.some((row) => row.id === id)) rows.push({ id, label, group });
  };
  const put = (rowId: string, group: RecipientGroup, cell: CoverageCell, columnId: string = cell.coverage) => cells.push({ ...byProduct(cell, group), rowId, columnId, group });

  for (const input of claim.persons) {
    addRow(input.person.id, input.person.label, input.side);
    for (const cell of calculatePersonCoverages({ ...input, accidentDate }, ruleItems).cells) put(input.person.id, input.side, cell);
  }
  for (const vehicle of claim.vehicles) {
    addRow(vehicle.damage.ownerId, vehicle.damage.label, vehicle.side);
    for (const cell of calculateVehicleCoverages(vehicle, accidentDate, rules)) put(vehicle.damage.ownerId, vehicle.side, cell);
  }
  if (claim.legal) {
    addRow(claim.legal.insuredId, claim.legal.insuredLabel, "mine");
    put(claim.legal.insuredId, "mine", legalCostRider(claim.legal, rules));
  }
  const otherColumns: Matrix["columns"] = [];
  for (const rider of claim.otherRiders) {
    const columnId = `rider_other:${rider.name}`;
    addRow(rider.insuredId, rider.insuredLabel, "mine");
    if (!otherColumns.some((column) => column.id === columnId)) otherColumns.push({ id: columnId, label: rider.name, coverage: "rider_other" });
    put(rider.insuredId, "mine", unregisteredRider(rules, "rider_other", rider.name), columnId);
  }

  const columns: Matrix["columns"] = [
    ...COLUMN_ORDER.filter((coverage) => cells.some((cell) => cell.columnId === coverage)).map((coverage) => ({ id: coverage as string, label: COVERAGE_LABELS[coverage], coverage })),
    ...otherColumns,
  ];
  return { accidentDate, productLine: claim.productLine, rows, columns, cells };
}
