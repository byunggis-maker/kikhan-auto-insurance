import type { PolicyDraft } from "@/lib/draft/types";
import { PRODUCT_LINE_LABELS } from "@/lib/draft/types";
import { rangeText } from "@/lib/engine/range";
import type { Result } from "@/lib/result/compute";

// 읽어주기에 쓸 글을 만든다. 금액은 엔진의 결과를 그대로 적고, 여기서 더하거나 빼지 않는다.
// 이름·차량번호·증권번호는 음성 제공자에게 보내지 않으므로 글에 넣지 않는다.

const DISCLAIMER = "참고용 추정이며 손해사정이나 보험금 지급 확정이 아닙니다.";
const STATUS_TEXT = { insufficient_info: "정보가 부족해 계산하지 못했습니다", not_applicable: "해당하지 않습니다", needs_check: "약관 확인이 필요합니다" } as const;

/** 결과 요약. rowNames: 행 id → 읽어 줄 이름("첫 번째 사람" 등, 실제 이름 아님) */
export function resultSpeech(result: Result): string[] {
  const { matrix, summary } = result;
  const paragraphs: string[] = ["예상 보험금 결과를 읽어 드립니다."];
  const [mine, others] = summary.groups;
  paragraphs.push(mine.countedCells > 0 ? `내가 받을 예상 보험금은 ${rangeText(mine.total)}입니다.` : "내가 받을 보험금은 아직 계산된 것이 없습니다. 부족한 정보를 입력하면 계산됩니다.");
  if (others.countedCells > 0) paragraphs.push(`상대방에게 지급될 예상 금액은 ${rangeText(others.total)}입니다. 이 금액은 내가 받을 금액과 따로입니다.`);
  matrix.rows.forEach((row, index) => {
    const cells = matrix.cells.filter((cell) => cell.rowId === row.id && cell.status !== "not_applicable");
    if (cells.length === 0) return;
    const parts = cells.map((cell) => {
      const label = matrix.columns.find((column) => column.id === cell.columnId)?.label ?? "담보";
      return cell.status === "calculated" && cell.amount ? `${label} ${rangeText(cell.amount)}${cell.inTotal ? "" : ", 이 금액은 합계에 넣지 않았습니다"}` : `${label}은 ${STATUS_TEXT[cell.status as keyof typeof STATUS_TEXT]}`;
    });
    paragraphs.push(`${index + 1}번째, ${row.group === "mine" ? "내 쪽" : "상대방 쪽"}. ${parts.join(". ")}.`);
  });
  paragraphs.push(DISCLAIMER);
  return paragraphs;
}

/** 올린 증권에서 읽은 내용 */
export function documentSpeech(policy: PolicyDraft): string[] {
  const joined = policy.coverages.filter((coverage) => coverage.joined && coverage.name.trim());
  if (!policy.insurer && !policy.productName && joined.length === 0) return [];
  const paragraphs = ["증권에서 읽은 내용입니다."];
  const head = [
    policy.insurer && `보험회사 ${policy.insurer}`,
    policy.productName && `상품 ${policy.productName}`,
    policy.productLine && PRODUCT_LINE_LABELS[policy.productLine],
    policy.periodStart && policy.periodEnd && `보험기간 ${policy.periodStart}부터 ${policy.periodEnd}까지`,
    policy.driverScope && `운전자 범위 ${policy.driverScope}`,
    policy.driverAgeLimit && `연령 한정 ${policy.driverAgeLimit}`,
  ].filter(Boolean);
  if (head.length) paragraphs.push(`${head.join(", ")}.`);
  for (const coverage of joined) paragraphs.push(`${coverage.name}${coverage.limit ? `, 가입금액 ${coverage.limit}` : ""}${coverage.deductible ? `, 자기부담금 ${coverage.deductible}` : ""}.`);
  if (policy.riders.length) paragraphs.push(`특약: ${policy.riders.join(", ")}.`);
  return paragraphs;
}

/** 문단을 한 번에 보낼 수 있는 길이로 묶는다. 한 문단이 너무 길면 자른다 */
export function chunkText(paragraphs: string[], max: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs.flatMap((text) => text.match(new RegExp(`[\\s\\S]{1,${max}}`, "g")) ?? [])) {
    if (current && current.length + paragraph.length + 1 > max) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}
