import { flagText } from "@/lib/explain/default";
import { won } from "@/lib/engine/range";
import type { MatrixCell, Range } from "@/lib/engine/types";
import type { Result } from "@/lib/result/compute";

// 내려받기용 표를 만든다. 엑셀과 PDF가 같은 내용을 쓴다.
// 금액은 엔진의 칸과 summarize()의 합계를 그대로 옮긴다. 여기서 더하지 않고, 엑셀에도 수식을 넣지 않는다.

export type Value = string | number | null;
export type Sheet = { name: string; rows: Value[][]; widths: number[] };
export type Book = { sheets: Sheet[] };

export const DISCLAIMER = "참고용 추정이며 손해사정이나 보험금 지급 확정이 아닙니다";
const PRODUCT_LINES: Record<string, string> = { personal: "개인용 자동차보험", business: "업무용 자동차보험", commercial: "영업용 자동차보험", motorcycle: "이륜자동차보험" };
const GROUPS = { mine: "내가 받을 예상 보험금", others: "상대방에게 지급될 예상 금액" } as const;
export const STATUS_LABELS: Record<MatrixCell["status"], string> = { calculated: "계산됨", insufficient_info: "정보 부족", not_applicable: "해당 없음", needs_check: "약관 확인 필요" };

/** 계산은 되었지만 합계에 넣지 않은 칸에 붙이는 말. 화면·엑셀·PDF·읽어주기가 같은 말을 쓴다 */
export const EXCLUDED_LABEL = "대체 경로·합계 제외";
const NONE = "계산된 칸 없음";

const amounts = (range: Range | null): Value[] => (range ? [range.min, range.expected, range.max] : [null, null, null]);
/** 합계 줄. 더한 칸이 없으면 0이 아니라 "계산된 칸 없음"으로 적는다 */
const totals = (sum: { amount: Range; countedCells: number }): Value[] => (sum.countedCells > 0 ? amounts(sum.amount) : [NONE, null, null]);

/** 엑셀 시트 이름으로 쓸 수 없는 글자를 빼고 31자로 줄인다. 겹치면 번호를 붙인다 */
function sheetName(label: string, used: Set<string>) {
  const base = label.replace(/[\[\]:*?/\\']/g, " ").trim().slice(0, 28) || "사람";
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base} ${n}`;
  used.add(name);
  return name;
}

/** createdAt: 만든 날(화면이 넘겨 준다. 여기서 시계를 읽지 않는다) */
export function buildBook(result: Result, createdAt: string): Book {
  const { matrix, summary } = result;
  const columnLabel = (id: string) => matrix.columns.find((column) => column.id === id)?.label ?? id;
  const rowLabel = (id: string) => matrix.rows.find((row) => row.id === id)?.label ?? id;

  const overview: Value[][] = [
    ["자동차보험 예상 보험금 총괄표"],
    ["사고일", matrix.accidentDate],
    ["보험 종류", PRODUCT_LINES[matrix.productLine] ?? matrix.productLine],
    ["만든 날", createdAt],
    ["계산 엔진 버전", result.engineVersion],
    ["규칙 파일 버전", result.rulesVersion],
    [],
    ["구분", "최소", "예상", "최대", "더한 칸 수"],
    ...summary.groups.map((group): Value[] => [GROUPS[group.group], ...totals({ amount: group.total, countedCells: group.countedCells }), group.countedCells]),
    ["두 금액은 서로 더하지 않습니다."],
    [],
    ["사람별 합계", "구분", "최소", "예상", "최대"],
    ...summary.groups.flatMap((group) => group.byRow.map((row): Value[] => [rowLabel(row.rowId), GROUPS[group.group], ...totals(row)])),
    [],
    ["담보별 합계", "구분", "최소", "예상", "최대"],
    ...summary.groups.flatMap((group) => group.byColumn.map((column): Value[] => [columnLabel(column.columnId), GROUPS[group.group], ...totals(column)])),
    [],
    ["사람 × 담보 (예상 금액)", ...matrix.columns.map((column) => column.label)],
    ...matrix.rows.map((row): Value[] => [
      row.label,
      ...matrix.columns.map((column) => {
        const cell = matrix.cells.find((candidate) => candidate.rowId === row.id && candidate.columnId === column.id);
        if (!cell) return null;
        if (cell.status !== "calculated" || !cell.amount) return STATUS_LABELS[cell.status];
        // 합계에서 뺀 칸은 숫자로 두지 않는다. 표의 숫자를 더하면 합계와 같아야 한다.
        return cell.inTotal ? cell.amount.expected : `${won(cell.amount.expected)} (${EXCLUDED_LABEL})`;
      }),
    ]),
    [],
    [DISCLAIMER],
  ];

  const used = new Set<string>(["총괄표", "근거"]);
  const people: Sheet[] = matrix.rows.map((row) => {
    const rows: Value[][] = [[row.label, GROUPS[row.group]], [], ["담보 / 항목", "상태", "최소", "예상", "최대", "계산 내역"]];
    for (const cell of matrix.cells.filter((candidate) => candidate.rowId === row.id)) {
      rows.push([columnLabel(cell.columnId), STATUS_LABELS[cell.status], ...amounts(cell.amount), [cell.status === "calculated" && !cell.inTotal ? EXCLUDED_LABEL : null, cell.reason, ...cell.flags.map(flagText)].filter(Boolean).join(" / ") || null]);
      for (const line of cell.lines) rows.push([`  ${line.label}`, line.amount ? null : "계산에 넣지 않음", ...amounts(line.amount), line.formula]);
      for (const info of cell.missing) rows.push(["  부족 정보", null, null, null, null, info.message]);
    }
    rows.push([], [DISCLAIMER]);
    return { name: sheetName(row.label, used), rows, widths: [34, 16, 16, 16, 16, 90] };
  });

  const basis: Value[][] = [
    ["근거 조항"],
    ["규칙 파일 버전", result.rulesVersion],
    [],
    ["사람", "담보", "근거", "확인 상태"],
    ...matrix.cells.flatMap((cell) => [
      ...cell.basis.map((text): Value[] => [rowLabel(cell.rowId), columnLabel(cell.columnId), text, null]),
      ...(cell.needsCheckRuleIds.length ? [[rowLabel(cell.rowId), columnLabel(cell.columnId), `확인이 필요한 규칙: ${cell.needsCheckRuleIds.join(", ")}`, "약관 확인 필요"] as Value[]] : []),
    ]),
    [],
    [DISCLAIMER],
  ];

  return { sheets: [{ name: "총괄표", rows: overview, widths: [36, 28, 18, 18, 18, 18, 18, 18, 18, 18] }, ...people, { name: "근거", rows: basis, widths: [20, 26, 110, 18] }] };
}
