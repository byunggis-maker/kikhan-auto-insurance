import { rangeText } from "@/lib/engine/range";
import { NOTICES, type MatrixCell, type Notice } from "@/lib/engine/types";

// "왜 이 금액?"의 기본 문장. 엔진이 남긴 내역을 그대로 늘어놓는다. 금액을 새로 계산하지 않는다.
// LLM 설명을 쓸 수 없거나 버렸을 때 이 문장을 보여 준다.

const FLAG_TEXT: Record<string, string> = {
  ...NOTICES,
  partial: "입력하지 않은 항목은 빼고 계산했습니다",
  deduction_unknown: "다른 보험에서 받을 금액을 알 수 없어 최소와 최대의 차이가 큽니다",
  government_guarantee: "상대 차량이 무보험·뺑소니라 정부보장사업에서 같은 한도로 보상합니다",
  minor_injury_driver_unknown: "차량 운전자인지에 따라 치료비 부담이 달라질 수 있습니다",
  deductible_not_in_table: "증권의 자기부담금 조건이 약관의 안내표에 없는 조합입니다. 증권을 다시 확인해 주세요",
};

export function flagText(flag: string): string {
  return FLAG_TEXT[flag as Notice] ?? flag;
}

export function defaultExplanation(cell: MatrixCell, coverageLabel: string): string[] {
  if (cell.status !== "calculated" || !cell.amount) return [cell.reason ?? "계산하지 못했습니다."];
  const sentences = [`${coverageLabel}의 예상 금액은 ${rangeText(cell.amount)}입니다.`];
  for (const line of cell.lines) {
    if (line.amount) sentences.push(`${line.label}: ${line.formula}`);
    else if (line.kind === "loss") sentences.push(`${line.label}: 계산에 넣지 않았습니다. ${line.formula}`);
  }
  for (const flag of cell.flags) sentences.push(`${flagText(flag)}.`);
  return sentences;
}
