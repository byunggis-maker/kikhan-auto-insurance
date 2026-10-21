import { PAYERS, type Claim, type Payer } from "@/lib/claim/types";
import { runOnce } from "./calculate";
import type { Amounts, Result, ResultBurden, ResultCard, ResultDetail, ResultLine, ResultNote, Run } from "./types";

// MASTER.md 5장 확정·추정 이중 계산.
// 확정 계산(confirmed만)과 추정 포함 계산(빈 칸만 estimated·약관 기준으로)을 따로 실행하고, 추정분 = 두 결과의 차이로 낸다.
// 하한·한도·자기부담금 때문에 비선형이므로 항목 금액을 더하지 않고, 엔진 결과를 줄(key)마다 맞춰 뺀다.
// 계산식·근거·표시는 추정 포함 계산의 것을 보여 준다(더 많은 항목이 들어간 쪽).

const amounts = (confirmed: number, withEstimates: number): Amounts => ({ confirmed, withEstimates, estimatePart: withEstimates - confirmed });
const add = (a: Amounts, b: Amounts): Amounts => amounts(a.confirmed + b.confirmed, a.withEstimates + b.withEstimates);
const ZERO = amounts(0, 0);

function byKey<T extends { key: string }>(items: T[]) {
  return new Map(items.map((item) => [item.key, item]));
}

function merge(claim: Claim, faultPercent: number): Result {
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

  // 합계에서 빠지는 안내 줄: 확정값과 추정 포함값만 두고 추정분은 비운다(라운드 2 결정 5)
  const confirmedNotes = byKey(confirmed.notes);
  const notes: ResultNote[] = estimated.notes.map(({ amount, ...note }) => ({ ...note, confirmed: confirmedNotes.get(note.key)?.amount ?? 0, withEstimates: amount, estimatePart: null }));
  for (const { amount, ...note } of confirmed.notes) if (!notes.some((n) => n.key === note.key)) notes.push({ ...note, confirmed: amount, withEstimates: 0, estimatePart: null });

  const confirmedBurdens = byKey(confirmed.burdens);
  const burdens: ResultBurden[] = estimated.burdens.map(({ amount, ...burden }) => ({ ...burden, ...amounts(confirmedBurdens.get(burden.key)?.amount ?? 0, amount) }));
  for (const { amount, ...burden } of confirmed.burdens) if (!burdens.some((b) => b.key === burden.key)) burdens.push({ ...burden, ...amounts(amount, 0) });

  const confirmedCards = new Map(confirmed.cards.map((card) => [card.cardId, card]));
  const cards: ResultCard[] = estimated.cards.map(({ actualLoss, details, ...card }) => {
    const before = confirmedCards.get(card.cardId);
    const loss = amounts(before?.actualLoss ?? 0, actualLoss);
    const paid = lines.filter((line) => line.cardId === card.cardId && line.status === "paid").reduce((sum, line) => add(sum, line), ZERO);
    const uncovered = amounts(Math.max(0, loss.confirmed - paid.confirmed), Math.max(0, loss.withEstimates - paid.withEstimates));
    const mergedDetails: ResultDetail[] = details.map(({ amount, ...detail }) => ({ ...detail, ...amounts(before?.details.find((d) => d.code === detail.code)?.amount ?? 0, amount) }));
    // "입력 필요"는 확정 계산 기준(서류 금액이 없는 항목)
    return { ...card, missing: before?.missing ?? card.missing, actualLoss: loss, paid, uncovered, details: mergedDetails };
  });

  const paidLines = lines.filter((line) => line.status === "paid");
  const receiveLines = paidLines.filter((line) => line.side === "mine");
  const byPayer = Object.fromEntries(PAYERS.map((payer) => [payer, receiveLines.filter((line) => line.payer === payer).reduce((sum, line) => add(sum, line), ZERO)])) as Record<Payer, Amounts>;

  return {
    faultPercent,
    edition: estimated.edition,
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
    bodily2Scenarios: null,
  };
}

/** 상대 차량이 보험에 들었지만 대인배상Ⅱ 가입 여부를 모르는지(hasBodily2 = null) */
function bodily2Unknown(claim: Claim) {
  const cp = claim.counterpartyPolicy;
  return cp !== null && cp.hasBodily2 === null && (cp.status === "full" || cp.status === "mandatory_only") && claim.accident.type !== "single";
}

/**
 * 한 과실비율의 결과. 상대 대인배상Ⅱ 가입 여부를 모르면 "있음"(종합보험, 가입금액을 모르면 무한)과 "없음"(책임보험만)
 * 두 시나리오를 모두 계산해 bodily2Scenarios에 담고, 본 결과는 "있음" 시나리오로 둔다.
 */
export function calculate(claim: Claim, faultPercent: number): Result {
  if (!bodily2Unknown(claim)) return merge(claim, faultPercent);
  const cp = claim.counterpartyPolicy!;
  const withClaim: Claim = { ...claim, counterpartyPolicy: { ...cp, status: "full", hasBodily2: true } };
  const withoutClaim: Claim = { ...claim, counterpartyPolicy: { ...cp, status: "mandatory_only", hasBodily2: false, coverages: cp.coverages.filter((c) => c.coverage !== "liability_bodily_2") } };
  const withBodily2 = merge(withClaim, faultPercent);
  const withoutBodily2 = merge(withoutClaim, faultPercent);
  const note = `상대 대인Ⅱ 가입 여부를 몰라 두 경우로 계산했습니다 — 상대 대인Ⅱ 있음: 받을 돈 ${withBodily2.totals.receive.withEstimates.toLocaleString("ko-KR")}원 / 상대 대인Ⅱ 없음: 받을 돈 ${withoutBodily2.totals.receive.withEstimates.toLocaleString("ko-KR")}원(추정 포함)`;
  return { ...withBodily2, notices: [...withBodily2.notices, note], bodily2Scenarios: { withBodily2, withoutBodily2 } };
}
