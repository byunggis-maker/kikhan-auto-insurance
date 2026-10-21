import type { ClaimReading, PolicyReading } from "@/lib/ai/documents";
import { lossItemDef } from "@/lib/claim/lossItems";
import { COVERAGE_LABELS, PRODUCT_LINE_LABELS, type Claim, type Limit, type Recognition } from "@/lib/claim/types";
import { setCoverage, setItem, toggleCoverage, visibleItems } from "./flow";

// 서류·증권 인식값을 "확인을 기다리는 값"으로 만들고, 사용자가 고치거나 확인·지우는 상태 변경(라운드 7, MASTER.md 9장).
// React와 분리해 테스트한다(tests/ui/recognize.test.ts). 확인하기 전의 값은 계산에 쓰지 않는다.

const DRIVER_SCOPE_LABELS = { anyone: "누구나", named_only: "기명피보험자 1인", couple: "부부", family: "가족", named_plus_one: "기명 1인 + 지정 1인", employees: "임직원", other: "그 밖" } as const;
const FACT_LABELS = { hospitalDays: "입원일수", outpatientDays: "통원일수", monthlyIncome: "월 소득" } as const;

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const limitText = (limit: Limit | null) => (limit === null ? "모름" : limit === "unlimited" ? "무한" : won(limit));

/** 같은 칸을 가리키는 인식값은 하나만 둔다(새로 읽으면 바꾼다) */
export function targetKey(r: Recognition): string {
  switch (r.kind) {
    case "loss":
      return `loss:${r.cardId}:${r.code}`;
    case "fact":
      return `fact:${r.cardId}:${r.field}`;
    case "coverage":
      return `coverage:${r.value.coverage}`;
    default:
      return r.kind;
  }
}

/** 화면·검토서에 쓰는 한 줄 설명 */
export function recognitionLabel(r: Recognition): string {
  switch (r.kind) {
    case "loss":
      return `${lossItemDef(r.code)?.label ?? r.code} ${won(r.value)}`;
    case "fact":
      return `${FACT_LABELS[r.field]} ${r.field === "monthlyIncome" ? won(r.value) : `${r.value}일`}`;
    case "insurer":
      return `보험회사 ${r.value}`;
    case "productLine":
      return `보험 종류 ${PRODUCT_LINE_LABELS[r.value]}`;
    case "driverScope":
      return `운전자 범위 ${DRIVER_SCOPE_LABELS[r.value]}`;
    case "coverage": {
      const c = r.value;
      const split = c.injuryLimit !== null || c.deathLimit !== null || c.disabilityLimit !== null;
      return `${COVERAGE_LABELS[c.coverage]} ${split ? `부상 ${limitText(c.injuryLimit)} · 사망 ${limitText(c.deathLimit)} · 후유장애 ${limitText(c.disabilityLimit)}` : limitText(c.limit)}`;
    }
    case "deductible":
      return r.value.type === "rate" ? `자기차량손해 자기부담금 ${r.value.ratePercent}% (최저 ${won(r.value.min)}, 최고 ${won(r.value.max)})` : `자기차량손해 자기부담금 ${won(r.value.amount)}`;
  }
}

export type MakeId = () => string;

/** 화면에서 쓰는 id(같은 순간 여러 개를 만들어도 겹치지 않게) */
export const randomId: MakeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const POLICY_KINDS = new Set<Recognition["kind"]>(["insurer", "productLine", "driverScope", "coverage", "deductible"]);
export const isPolicyRecognition = (r: Recognition) => POLICY_KINDS.has(r.kind);

/** 보상 서류 인식 결과 → 이 카드의 확인 대기 값. 이 카드에 보이지 않는 항목은 넣지 않고 그 수를 알려 준다 */
export function claimRecognitions(claim: Claim, cardId: string, reading: ClaimReading, makeId: MakeId): { recognitions: Recognition[]; dropped: number } {
  const source = reading.documentType || "서류";
  const visible = new Set(visibleItems(claim, cardId).map((d) => d.code));
  const sums = new Map<string, { amount: number; basis: string[] }>();
  let dropped = 0;
  for (const a of reading.amounts) {
    if (!visible.has(a.code)) {
      dropped++;
      continue;
    }
    const sum = sums.get(a.code) ?? { amount: 0, basis: [] };
    sums.set(a.code, { amount: sum.amount + a.amount, basis: [...sum.basis, a.basis].filter(Boolean) });
  }
  const recognitions: Recognition[] = [...sums].map(([code, sum]) => ({ id: makeId(), kind: "loss", cardId, code, value: sum.amount, source, note: sum.basis.join(" · ") }));
  if (claim.victims.some((v) => v.id === cardId))
    for (const field of ["hospitalDays", "outpatientDays", "monthlyIncome"] as const) {
      const value = reading.facts[field];
      if (value !== null) recognitions.push({ id: makeId(), kind: "fact", cardId, field, value, source, note: "" });
    }
  return { recognitions, dropped };
}

/** 증권 인식 결과 → 내 보험의 확인 대기 값 */
export function policyRecognitions(reading: PolicyReading, makeId: MakeId): Recognition[] {
  if (!reading.isPolicy) return [];
  const source = "증권";
  const out: Recognition[] = [];
  if (reading.insurer) out.push({ id: makeId(), kind: "insurer", value: reading.insurer, source, note: "" });
  if (reading.productLine) out.push({ id: makeId(), kind: "productLine", value: reading.productLine, source, note: "" });
  if (reading.driverScope) out.push({ id: makeId(), kind: "driverScope", value: reading.driverScope, source, note: "" });
  for (const c of reading.coverages) {
    const value = { coverage: c.coverage, limit: c.unlimited ? ("unlimited" as const) : c.limit, injuryLimit: c.injuryLimit, deathLimit: c.deathLimit, disabilityLimit: c.disabilityLimit };
    out.push({ id: makeId(), kind: "coverage", value, source, note: c.text });
  }
  if (reading.ownDamageDeductible) out.push({ id: makeId(), kind: "deductible", value: { type: "rate", ...reading.ownDamageDeductible }, source, note: "" });
  return out;
}

/** 확인 대기 값을 더한다. 같은 칸의 예전 대기 값은 새 값으로 바꾼다 */
export function addRecognitions(claim: Claim, recognitions: Recognition[]): Claim {
  const keys = new Set(recognitions.map(targetKey));
  return { ...claim, recognized: [...claim.recognized.filter((r) => !keys.has(targetKey(r))), ...recognitions] };
}

/** 확인 전에 숫자를 고친다(금액·날수 칸만) */
export function editRecognition(claim: Claim, id: string, value: number): Claim {
  return { ...claim, recognized: claim.recognized.map((r) => (r.id === id && (r.kind === "loss" || r.kind === "fact") ? { ...r, value } : r)) };
}

export function dismissRecognition(claim: Claim, id: string): Claim {
  return { ...claim, recognized: claim.recognized.filter((r) => r.id !== id) };
}

/** 확인: 값을 입력칸에 넣고 대기 목록에서 뺀다 */
export function confirmRecognition(claim: Claim, id: string): Claim {
  const r = claim.recognized.find((x) => x.id === id);
  if (!r) return claim;
  const rest = dismissRecognition(claim, id);
  const policy = (change: Partial<Claim["myPolicy"]>) => ({ ...rest, myPolicy: { ...rest.myPolicy, ...change } });
  switch (r.kind) {
    case "loss":
      return setItem(rest, r.cardId, r.code, { confirmed: r.value, evidence: `서류 인식 확인: ${r.source}` });
    case "fact":
      return { ...rest, victims: rest.victims.map((v) => (v.id === r.cardId ? { ...v, [r.field]: r.value } : v)) };
    case "insurer":
      return policy({ insurer: r.value });
    case "productLine":
      return policy({ productLine: r.value });
    case "driverScope":
      return policy({ driverScope: r.value });
    case "deductible":
      return policy({ deductible: r.value });
    case "coverage": {
      const { coverage, ...limits } = r.value;
      const on = rest.myPolicy.coverages.some((c) => c.coverage === coverage) ? rest : toggleCoverage(rest, coverage, true);
      return setCoverage(on, coverage, limits);
    }
  }
}

export function confirmAll(claim: Claim, ids: string[]): Claim {
  return ids.reduce(confirmRecognition, claim);
}
