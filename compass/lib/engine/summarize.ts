import { addRanges } from "./range";
import type { Matrix, MatrixCell, Range, RecipientGroup } from "./types";

// 합계를 내는 유일한 곳. 행렬의 칸에서만 더한다.
// 화면·저장·내보내기는 여기서 나온 값을 보여 주기만 하고, 저장된 합계는 믿지 않고 이 함수로 다시 계산한다.

export type GroupSummary = {
  /** mine: 내가(내 쪽이) 받을 금액, others: 상대방 쪽에 지급될 금액 */
  group: RecipientGroup;
  /** 사람별 합계. countedCells가 0이면 금액 0은 "0원"이 아니라 "계산된 칸 없음"이다 */
  byRow: { rowId: string; amount: Range; countedCells: number }[];
  /** 담보별 합계 */
  byColumn: { columnId: string; amount: Range; countedCells: number }[];
  /** 총합계 */
  total: Range;
  /** 합계에 넣은 칸의 수 */
  countedCells: number;
};

/** 두 묶음은 서로 더하지 않는다. 내가 받을 금액과 상대방에게 지급될 금액을 합친 값은 만들지 않는다 */
export type Summary = { groups: GroupSummary[] };

/** 합계에 들어가는 칸: 계산되었고, 합계에 넣기로 한 칸 */
export function isCounted(cell: MatrixCell): cell is MatrixCell & { amount: Range } {
  return cell.status === "calculated" && cell.inTotal && cell.amount !== null;
}

function sumBy(cells: (MatrixCell & { amount: Range })[], ids: string[], key: "rowId" | "columnId") {
  return ids.map((id) => {
    const own = cells.filter((cell) => cell[key] === id);
    return { id, amount: addRanges(own.map((cell) => cell.amount)), countedCells: own.length };
  });
}

export function summarize(matrix: Matrix): Summary {
  const groups = (["mine", "others"] as const).map((group): GroupSummary => {
    const counted = matrix.cells.filter((cell) => cell.group === group).filter(isCounted);
    // 행렬의 rows·columns에 없는 id를 가진 칸도 빠뜨리지 않도록 칸에서 id를 모은다.
    const rowIds = [...new Set([...matrix.rows.filter((row) => row.group === group).map((row) => row.id), ...counted.map((cell) => cell.rowId)])];
    const columnIds = [...new Set([...matrix.columns.map((column) => column.id), ...counted.map((cell) => cell.columnId)])].filter((id) => matrix.cells.some((cell) => cell.group === group && cell.columnId === id));
    return {
      group,
      byRow: sumBy(counted, rowIds, "rowId").map(({ id, ...sum }) => ({ rowId: id, ...sum })),
      byColumn: sumBy(counted, columnIds, "columnId").map(({ id, ...sum }) => ({ columnId: id, ...sum })),
      total: addRanges(counted.map((cell) => cell.amount)),
      countedCells: counted.length,
    };
  });
  return { groups };
}
