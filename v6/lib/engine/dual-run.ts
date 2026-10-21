import { PAYERS, type Claim, type Payer } from "@/lib/claim/types";
import { runOnce } from "./calculate";
import type { Amounts, Result, ResultBurden, ResultCard, ResultLine, ResultNote, Run } from "./types";

// MASTER.md 5장 확정·추정 이중 계산.
// 확정 계산(confirmed만)과 추정 포함 계산(빈 칸만 estimated로)을 따로 실행하고, 추정분 = 두 결과의 차이로 낸다.
// 하한·한도·자기부담금 때문에 비선형이므로 항목 금액을 더하지 않고, 엔진 결과를 줄(key)마다 맞춰 뺀다.
// 계산식·근거·표시는 추정 포함 계산의 것을 보여 준다(더 많은 항목이 들어간 쪽).

const amounts = (confirmed: number, withEstimates: number): Amounts => ({ confirmed, withEstimates, estimatePart: withEstimates - confirmed });
const add = (a: Amounts, b: Amounts): Amounts => amounts(a.confirmed + b.confirmed, a.withEstimates + b.withEstimates);
const ZERO = amounts(0, 0);

function byKey<T extends { key: string }>(items: T[]) {
  return new Map(items.map((item) => [item.key, item]));
}

export function calculate(claim: Claim, faultPercent: number): Result {
  const confirmed: Run = runOnce(claim, faultPercent, "confirmed");
  const estimated: Run = runOnce(claim, faultPercent, "with_estimates");
  const cardInfo = new Map(estimated.cards.map((card) => [card.cardId, card]));

  const confirmedLines = byKey(confirmed.lines);
  const lines: ResultLine[] = estimated.lines.map((line) => {
    const base = confirmedLines.get(line.key);
    const card = cardInfo.get(line.cardId);
    const { amount, alternative, ...rest } = line;
    const result: ResultLine = { ...rest, cardLabel: card?.label ?? line.cardId, side: card?.side ?? "mine", ...amounts(base?.amount ?? 0, amount) };
    if (alternative) result.alternative = { label: alternative.label, ...amounts(base?.alternative?.amount ?? 0, alternative.amount) };
    return result;
  });

  const confirmedNotes = byKey(confirmed.notes);
  const notes: ResultNote[] = estimated.notes.map(({ amount, ...note }) => ({ ...note, ...amounts(confirmedNotes.get(note.key)?.amount ?? 0, amount) }));
  // 확정 계산에만 있는 안내·부담은 추정 포함 0원으로 두지 않고 그대로 더한다(드문 경우: 추정값이 오히려 조건을 없앤 때)
  for (const note of confirmed.notes) if (!notes.some((n) => n.key === note.key)) notes.push({ ...note, ...amounts(note.amount, 0) });

  const confirmedBurdens = byKey(confirmed.burdens);
  const burdens: ResultBurden[] = estimated.burdens.map(({ amount, ...burden }) => ({ ...burden, ...amounts(confirmedBurdens.get(burden.key)?.amount ?? 0, amount) }));
  for (const burden of confirmed.burdens) if (!burdens.some((b) => b.key === burden.key)) burdens.push({ ...burden, ...amounts(burden.amount, 0) });

  const confirmedCards = new Map(confirmed.cards.map((card) => [card.cardId, card]));
  const cards: ResultCard[] = estimated.cards.map(({ actualLoss, ...card }) => {
    const loss = amounts(confirmedCards.get(card.cardId)?.actualLoss ?? 0, actualLoss);
    const paid = lines.filter((line) => line.cardId === card.cardId && line.status === "paid").reduce((sum, line) => add(sum, line), ZERO);
    const uncovered = amounts(Math.max(0, loss.confirmed - paid.confirmed), Math.max(0, loss.withEstimates - paid.withEstimates));
    // "입력 필요"는 확정 계산 기준(서류 금액이 없는 항목)
    return { ...card, missing: confirmedCards.get(card.cardId)?.missing ?? card.missing, actualLoss: loss, paid, uncovered };
  });

  const paidLines = lines.filter((line) => line.status === "paid");
  const receiveLines = paidLines.filter((line) => line.side === "mine");
  const byPayer = Object.fromEntries(PAYERS.map((payer) => [payer, receiveLines.filter((line) => line.payer === payer).reduce((sum, line) => add(sum, line), ZERO)])) as Record<Payer, Amounts>;

  return {
    faultPercent,
    blocked: estimated.blocked,
    lines,
    notes,
    burdens,
    cards,
    totals: {
      receive: receiveLines.reduce((sum, line) => add(sum, line), ZERO),
      byPayer,
      toCounterparty: paidLines.filter((line) => line.side === "counterparty").reduce((sum, line) => add(sum, line), ZERO),
      burden: burdens.reduce((sum, burden) => add(sum, burden), ZERO),
    },
    notices: [...new Set([...estimated.notices, ...confirmed.notices])],
  };
}
