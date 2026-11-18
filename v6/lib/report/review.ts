import { COVERAGE_DOCUMENTS, DOCUMENTS, lossItemDef, type DocumentId } from "@/lib/claim/lossItems";
import { STANDARDS_AS_OF, dailyWageFor } from "@/lib/claim/standards";
import { ESTIMATE_DISCLAIMER } from "@/lib/claim/vehicleValue";
import { ACCIDENT_TYPE_LABELS, COVERAGE_LABELS, PAYERS, PAYER_LABELS, positionOf, type Claim, type Coverage, type Payer } from "@/lib/claim/types";
import type { Amounts, Result } from "@/lib/engine/types";
import { maskText } from "@/lib/privacy/mask";
import { checklistKey } from "@/lib/state/checklist";
import { refsFromText } from "@/lib/law/refs";
import { recognitionLabel } from "@/lib/ui/recognize";

// MASTER.md 8장 보상 검토서의 내용. 화면(7단계)·엑셀·PDF가 모두 이 모델 하나를 쓴다(숫자가 서로 어긋나지 않게).
// 위에서 결론(세 숫자·받을 곳별), 아래로 근거(카드별 담보·과실 시나리오·입력 필요·필요 서류·다음 할 일).
// 모든 글자는 마지막에 개인정보 가림(lib/privacy/mask.ts)을 거친다.

export const ESTIMATE_NOTICE = "추정액이며 확정 금액은 보험사가 정합니다.";

export type ReviewLine = {
  label: string;
  payer: string;
  status: string;
  confirmed: number;
  withEstimates: number;
  estimatePart: number;
  formula: string;
  basis: string;
  /** 면책·해당 없음의 사유. 지급 줄이면 빈 글자 */
  exclusion: string;
  flags: string[];
};

/** laws: 이 카드의 판단에 쓴 법령 조문 id(라운드 9e, lib/law/refs.ts). 결과 화면이 카드 아래에 원문·기준일을 보인다 */
export type ReviewCard = { label: string; actualLoss: Amounts; paid: Amounts; uncovered: Amounts; lines: ReviewLine[]; notes: string[]; laws: string[] };
export type ReviewChecklist = { payer: string; coverage: string; docs: { key: string; label: string; clause27: number; checked: boolean }[] };

export type Review = {
  notice: string;
  accident: { date: string; type: string; place: string; narrative: string };
  faultPercent: number;
  faultKnown: boolean;
  edition: string;
  /** 계산에 쓴 기준과 대조 안내(약관 판, 일용근로자 임금 적용일) */
  standards: string[];
  top: { receiveConfirmed: number; receiveWithEstimates: number; receiveEstimatePart: number; burdenConfirmed: number; burdenWithEstimates: number; toCounterparty: number; receivePartial: boolean; toCounterpartyPartial: boolean };
  byPayer: { payer: string; confirmed: number; withEstimates: number; partial: boolean }[];
  cards: ReviewCard[];
  burdens: { label: string; confirmed: number; withEstimates: number; formula: string; basis: string }[];
  scenarios: { label: string; faultPercent: number; receiveConfirmed: number; receiveWithEstimates: number; burdenWithEstimates: number; receivePartial: boolean }[];
  missing: string[];
  checklist: ReviewChecklist[];
  /** 라운드 9c: 앱이 계산하지 않은 줄(받을 곳·사람·사유). 총괄표·엑셀에 '미계산'으로 보인다 */
  /**
   * 라운드 9c·9e: 앱이 계산하지 않은 줄. card·mine = 받는 사람(mine: 피보험자 측 사람·물건), payer·payerKey = 내는 곳.
   * 합계의 "+ 미계산"은 이 줄이 그 합계의 범위에 들 때만 붙인다(PARTIAL_SCOPE)
   */
  uncalculated: { payer: string; payerKey: Payer; card: string; mine: boolean; label: string; text: string }[];
  nextSteps: string[];
  notices: string[];
  blocked: string | null;
};

const STATUS = { paid: "지급", excluded: "보상 안 됨", needs_input: "입력 필요", not_implemented: "미계산" } as const;
/** 라운드 9c: 앱이 계산하지 않은 줄의 상태 이름(화면·엑셀·PDF가 금액 대신 이 글자를 보인다) */
export const UNCALCULATED_STATUS = STATUS.not_implemented;
/** 라운드 9c: 상대 차량 동승자(공동불법행위) 안내 */
export const JOINT_NOTICE = "피해자는 두 보험사 중 어느 쪽에든 손해 전액을 청구할 수 있습니다(부진정연대). 위 비율은 보험사 간 정산 기준입니다.";
export const RIDE_ALONG_NOTICE = "동승자가 호의동승(대가 없이 태워 준 경우)이면 손해배상금이 감액될 수 있습니다(별표5 동승자 유형별 감액비율). 이 계산에는 감액을 넣지 않았습니다.";
/** 라운드 9d: '미계산' 줄이 하나라도 있으면 합계 옆에 붙이는 문구와 표시(화면·엑셀·PDF 공통, 여기 한 곳에서 관리) */
export const PARTIAL_NOTE = "일부 미계산 포함 — 실제 금액은 이보다 클 수 있음";
export const PARTIAL_SUFFIX = " + 미계산";
/**
 * 라운드 9e: "+ 미계산"을 붙이는 범위. 미계산 줄(받는 사람 side, 내는 곳 payer)이 그 합계에 들어갈 줄일 때만 붙인다.
 * - 나의 받을 돈·받을 곳별: 받는 사람이 피보험자 측(side "mine")인 미계산(받을 곳별은 그 내는 곳만)
 * - 내 보험이 상대방에게 줄 돈: 받는 사람이 상대 측이고 내는 곳이 내 보험인 미계산
 */
type ScopeLine = { status: string; side: "mine" | "counterparty"; payer: Payer };
const uncalc = (l: ScopeLine) => l.status === "not_implemented";
export const PARTIAL_SCOPE = {
  receive: (lines: ScopeLine[]) => lines.some((l) => uncalc(l) && l.side === "mine"),
  payer: (lines: ScopeLine[], payer: Payer) => lines.some((l) => uncalc(l) && l.side === "mine" && l.payer === payer),
  toCounterparty: (lines: ScopeLine[]) => lines.some((l) => uncalc(l) && l.side === "counterparty" && l.payer === "own_insurer"),
};
/** 합계 글자: 범위 안에 미계산이 있으면 숫자 뒤에 " + 미계산"을 붙여 확정 금액처럼 보이지 않게 한다 */
export const totalText = (text: string, partial: boolean) => (partial ? `${text}${PARTIAL_SUFFIX}` : text);
export const TO_COUNTERPARTY_NOTE = "최종 분담 기준입니다. 피해자가 청구하면 내 보험사가 먼저 전액 지급한 뒤 상대 보험사에 구상할 수 있습니다.";
const PAYER_ORDER: Payer[] = ["counterparty_insurer", "government", "own_insurer"];

/** 필요 서류 체크리스트: 받을 곳 × 담보마다 제27조 공통 서류 + 그 카드에 넣은 손해 항목의 서류 */
function checklist(claim: Claim, result: Result, checked: string[]): ReviewChecklist[] {
  const groups = new Map<string, { payer: Payer; coverage: Coverage; docs: Set<DocumentId> }>();
  for (const line of result.lines) {
    if (line.status === "excluded") continue;
    const key = `${line.payer}:${line.coverage}`;
    const group = groups.get(key) ?? { payer: line.payer, coverage: line.coverage, docs: new Set<DocumentId>(COVERAGE_DOCUMENTS[line.coverage]) };
    const card = [...claim.victims, ...claim.properties].find((c) => c.id === line.cardId);
    for (const item of card?.losses ?? []) {
      const def = lossItemDef(item.code);
      if (def && def.coverages.includes(line.coverage)) for (const doc of def.requiredDocs) group.docs.add(doc);
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => PAYER_ORDER.indexOf(a.payer) - PAYER_ORDER.indexOf(b.payer) || a.coverage.localeCompare(b.coverage))
    .map((g) => {
      const payer = PAYER_LABELS[g.payer];
      const coverage = g.payer === "government" ? "대인Ⅰ 상당액(정부보장사업)" : COVERAGE_LABELS[g.coverage];
      const docs = [...g.docs].map((id) => {
        const key = checklistKey(payer, coverage, DOCUMENTS[id].label);
        return { key, label: DOCUMENTS[id].label, clause27: DOCUMENTS[id].clause27, checked: checked.includes(key) };
      });
      return { payer, coverage, docs: docs.sort((a, b) => a.clause27 - b.clause27) };
    });
}

function nextSteps(claim: Claim, result: Result, missingCount: number): string[] {
  const steps: string[] = [];
  const paid = result.lines.filter((l) => l.status === "paid" && l.withEstimates > 0);
  const has = (payer: Payer, side?: "mine" | "counterparty") => paid.some((l) => l.payer === payer && (!side || l.side === side));
  if (has("counterparty_insurer")) steps.push("상대 보험사에 사고 접수번호를 받고, 대인배상·대물배상을 먼저 청구하세요. 내 보험 담보는 상대 보험 지급액을 뺀 나머지를 줍니다.");
  if (has("government")) steps.push("정부보장사업(대인Ⅰ 상당액)은 손해보험사 창구에서 청구합니다(자동차손해배상보장법 제30조). 경찰서 교통사고사실확인원이 필요합니다.");
  if (has("own_insurer", "mine")) steps.push("내 보험사에도 사고를 접수하고 자동차상해·자기신체사고·무보험차상해·자기차량손해 등 해당 담보를 청구하세요.");
  if (has("own_insurer", "counterparty")) steps.push("상대방 피해는 내 보험사가 처리합니다. 보험료 할증이 있을 수 있으니 보험사에 확인하세요.");
  const burden = result.burdens.filter((b) => b.withEstimates > 0);
  if (burden.some((b) => b.key.startsWith("burden:"))) steps.push("사고부담금은 보험사에 지체 없이 납입해야 합니다(보통약관 제11조②). 금액은 위 '내가 낼 돈'을 보세요.");
  if (burden.some((b) => !b.key.startsWith("burden:"))) steps.push("보험으로 보상되지 않는 배상책임은 내가 직접 갚아야 합니다. 합의 전 보험사·법률 상담을 받으세요.");
  if (!claim.fault.mode || claim.fault.mode === "unknown") steps.push("과실비율이 정해지면 5단계에서 넣고 다시 계산하세요. 지금은 0·30·50·70% 네 경우를 보여 줍니다.");
  if (missingCount > 0) steps.push(`'입력 필요' ${missingCount}개를 채우면 금액이 더 정확해집니다.`);
  if (!result.edition.matched) steps.push("사고 당시 약관 내용은 보험사에 확인하세요(아래 안내).");
  steps.push("서류를 모으면 '서류로 확인한 금액(확정)' 칸에 넣어 확정 기준 금액을 늘려 가세요.");
  return steps;
}

function missingList(claim: Claim, result: Result, unknownLabels: string[]): string[] {
  return [
    // 서류에서 인식했지만 아직 확인하지 않은 값은 계산에 쓰지 않는다
    ...claim.recognized.map((r) => `확인 필요(서류 인식): ${recognitionLabel(r)}${r.kind === "loss" && r.excluded ? " (뺀 서류)" : ""}`),
    ...(claim.pendingNarrative ? ["확인 필요: 음성으로 옮긴 사고 경위"] : []),
    ...unknownLabels.map((label) => `모름: ${label}`),
    ...result.cards.flatMap((card) => card.missing.map((code) => `${card.label}: ${lossItemDef(code)?.label ?? code} 금액(서류)`)),
    ...result.lines.filter((l) => l.status === "needs_input").map((l) => `${l.cardLabel} ${l.label}: ${l.formula}`),
  ];
}

const WAGE_USED = "일용근로자 임금 ";

function standardsLines(claim: Claim, result: Result): string[] {
  const date = claim.accident.occurredAt?.slice(0, 10) ?? STANDARDS_AS_OF;
  const lines = [
    result.edition.matched
      ? `약관: ${result.edition.id} 개정판(사고일에 시행 중인 판)`
      : `약관: ${result.edition.id} 개정판으로 계산했습니다. 사고일(${claim.accident.occurredAt ?? "모름"})에 시행되던 약관과 다를 수 있으니 보험사에 확인하세요.`,
  ];
  const wage = dailyWageFor(date);
  if (wage && result.cards.some((card) => card.details.some((d) => d.formula.includes(WAGE_USED))))
    lines.push(
      `일용근로자 임금: 1일 ${wage.formula} (월 25일 기준 ${wage.monthly.toLocaleString("ko-KR")}원). 보통인부 ${wage.construction.effectiveFrom} 적용(${wage.construction.source}), 단순노무 ${wage.manufacturing.effectiveFrom} 적용(${wage.manufacturing.source}).`,
    );
  return lines;
}

/** 과실 시나리오 표. 상대 대인Ⅱ 가입 여부를 모르면 "없음" 경우를 한 줄씩 더한다(결정 기록 D-19) */
function scenarioRows(results: Result[]): Review["scenarios"] {
  const row = (r: Result, label: string) => ({ label, faultPercent: r.faultPercent, receiveConfirmed: r.totals.receive.confirmed, receiveWithEstimates: r.totals.receive.withEstimates, burdenWithEstimates: r.totals.burden.withEstimates, receivePartial: PARTIAL_SCOPE.receive(r.lines) });
  return results.flatMap((r) =>
    r.bodily2Scenarios
      ? [row(r, `내 과실 ${r.faultPercent}% · 상대 대인Ⅱ 있음`), row(r.bodily2Scenarios.withoutBodily2, `내 과실 ${r.faultPercent}% · 상대 대인Ⅱ 없음`)]
      : [row(r, `내 과실 ${r.faultPercent}%`)],
  );
}

/** 앱이 추정한 사고 직전 가액(라운드 9b: 추정값 옆에 앱 자체 추정치라고 밝힌다) */
function vehicleValueNote(claim: Claim, cardId: string): string[] {
  const p = claim.properties.find((x) => x.id === cardId);
  if (!p || p.valueAtAccident === null || !p.valueSource) return [];
  return [p.valueSource === "estimate" ? `사고 직전 가액(추정) ${p.valueAtAccident.toLocaleString("ko-KR")}원 — ${ESTIMATE_DISCLAIMER}` : `사고 직전 가액 ${p.valueAtAccident.toLocaleString("ko-KR")}원(증권 차량가액)`];
}

/**
 * 라운드 9e: 카드에 이어 보일 법령 조문. 그 카드의 근거 글자에 인용된 조문 + 그 카드에서 실제로 쓴 판단의 기본 조문만.
 * - 부진정연대 안내(공동불법행위)가 붙은 카드 → 민법 제760조
 * - 과실상계로 실제로 줄인 지급 줄("× (100 − N)%", N > 0)이 있는 카드 → 민법 제396조·제763조
 */
export function cardLaws(card: { lines: { status: string; formula: string; basis: string }[]; notes: string[] }): string[] {
  const ids = refsFromText([...card.lines.map((l) => l.basis), ...card.notes].join("\n")).map((r) => r.id);
  if (card.notes.includes(JOINT_NOTICE)) ids.push("civil-760");
  if (card.lines.some((l) => l.status === "지급" && /×\s*\(100\s*−\s*[1-9]\d*\)%/.test(l.formula))) ids.push("civil-396", "civil-763");
  return [...new Set(ids)];
}

/** 라운드 9c: 동승자 안내. 상대 차량 동승자로 두 보험사에 나눠 계산했으면 부진정연대 안내, 동승자면 호의동승 감액 안내(계산에는 넣지 않음) */
function passengerNotes(claim: Claim, result: Result, cardId: string): string[] {
  const v = claim.victims.find((x) => x.id === cardId);
  if (!v || v.role === "driver") return [];
  const position = positionOf(v);
  const passenger = position === "my_vehicle" || (position === "counterparty_vehicle" && (v.seat === "passenger" || v.seat === "passenger_family"));
  const split = position === "counterparty_vehicle" && result.lines.some((l) => l.cardId === cardId && l.payer === "counterparty_insurer" && l.status === "paid") && result.lines.some((l) => l.cardId === cardId && l.payer === "own_insurer" && l.status === "paid");
  return [...(split ? [JOINT_NOTICE] : []), ...(passenger ? [RIDE_ALONG_NOTICE] : [])];
}

/** 문자열을 모두 개인정보 가림 처리한다 */
function deepMask<T>(value: T): T {
  if (typeof value === "string") return maskText(value) as T;
  if (Array.isArray(value)) return value.map(deepMask) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepMask(v)])) as T;
  return value;
}

/**
 * checked: 사용자가 체크한 서류 키(lib/state/checklist.ts). 화면·엑셀·PDF에 같은 체크 상태가 나온다.
 * unknownLabels: '모름'으로 둔 칸(lib/ui/flow.ts unknownLabels). assumptionNotes: '모름'을 일반적 가입 기준으로 채운 안내(라운드 9)
 */
export function buildReview(claim: Claim, results: Result[], index: number, unknownLabels: string[] = [], checked: string[] = [], assumptionNotes: string[] = []): Review {
  const result = results[Math.min(index, results.length - 1)];
  const missing = missingList(claim, result, unknownLabels);
  const review: Review = {
    notice: ESTIMATE_NOTICE,
    accident: {
      date: claim.accident.occurredAt ?? "모름",
      type: claim.accident.type ? ACCIDENT_TYPE_LABELS[claim.accident.type] : "모름",
      place: claim.accident.place || "모름",
      narrative: claim.accident.narrative,
    },
    faultPercent: result.faultPercent,
    faultKnown: claim.fault.mode === "known",
    edition: `${result.edition.id} 개정판${result.edition.matched ? "" : "(사고 당시 약관과 다를 수 있음 — 보험사 확인)"}`,
    standards: standardsLines(claim, result),
    top: {
      receiveConfirmed: result.totals.receive.confirmed,
      receiveWithEstimates: result.totals.receive.withEstimates,
      receiveEstimatePart: result.totals.receive.estimatePart,
      burdenConfirmed: result.totals.burden.confirmed,
      burdenWithEstimates: result.totals.burden.withEstimates,
      toCounterparty: result.totals.toCounterparty.withEstimates,
      receivePartial: PARTIAL_SCOPE.receive(result.lines),
      toCounterpartyPartial: PARTIAL_SCOPE.toCounterparty(result.lines),
    },
    byPayer: PAYERS.filter((p) => result.totals.byPayer[p].withEstimates > 0 || result.totals.byPayer[p].confirmed > 0 || PARTIAL_SCOPE.payer(result.lines, p)).map((p) => ({ payer: PAYER_LABELS[p], confirmed: result.totals.byPayer[p].confirmed, withEstimates: result.totals.byPayer[p].withEstimates, partial: PARTIAL_SCOPE.payer(result.lines, p) })),
    cards: result.cards.map((card) => ({
      label: card.label,
      actualLoss: card.actualLoss,
      paid: card.paid,
      uncovered: card.uncovered,
      lines: result.lines
        .filter((l) => l.cardId === card.cardId)
        .map((l) => ({
          label: l.label,
          payer: PAYER_LABELS[l.payer],
          status: STATUS[l.status],
          confirmed: l.confirmed,
          withEstimates: l.withEstimates,
          estimatePart: l.estimatePart,
          formula: l.status === "excluded" ? "" : l.formula,
          basis: l.basis,
          exclusion: l.status === "excluded" ? l.formula : "",
          flags: [...l.flags, ...(l.alternative ? [`다른 경우: ${l.alternative.label} → ${l.alternative.withEstimates.toLocaleString("ko-KR")}원`] : [])],
        })),
      notes: [...vehicleValueNote(claim, card.cardId), ...passengerNotes(claim, result, card.cardId), ...result.notes.filter((n) => n.cardId === card.cardId).map((n) => n.text), ...card.notes],
    })).map((card) => ({ ...card, laws: cardLaws(card) })),
    burdens: result.burdens.map((b) => ({ label: b.label, confirmed: b.confirmed, withEstimates: b.withEstimates, formula: b.formula, basis: b.basis })),
    scenarios: scenarioRows(results),
    missing,
    checklist: checklist(claim, result, checked),
    uncalculated: result.lines.filter((l) => l.status === "not_implemented").map((l) => ({ payer: PAYER_LABELS[l.payer], payerKey: l.payer, card: l.cardLabel, mine: l.side === "mine", label: l.label, text: l.formula })),
    nextSteps: nextSteps(claim, result, missing.length),
    // 같은 안내가 사람마다 반복되지 않게 한 번씩만. 일용근로자 임금 안내는 위 standards에 있다
    notices: [...assumptionNotes, ...[...new Set(result.notices)].filter((n) => !n.startsWith(WAGE_USED))],
    blocked: result.blocked,
  };
  return deepMask(review);
}
