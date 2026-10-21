import type { ClaimReading, PolicyReading } from "@/lib/ai/documents";
import { lossItemDef } from "@/lib/claim/lossItems";
import { SALARY_INCOME_PERIOD } from "@/lib/claim/standards";
import { COVERAGE_LABELS, FACT_FIELDS, PRODUCT_LINE_LABELS, type Claim, type FactReading, type Limit, type Period, type Recognition } from "@/lib/claim/types";
import { setCoverage, setItem, toggleCoverage, visibleItems } from "./flow";

// 서류·증권 인식값을 "확인을 기다리는 값"으로 만들고, 사용자가 고치거나 확인·지우는 상태 변경(라운드 7, MASTER.md 9장).
// React와 분리해 테스트한다(tests/ui/recognize.test.ts). 확인하기 전의 값은 계산에 쓰지 않는다.

const DRIVER_SCOPE_LABELS = { anyone: "누구나", named_only: "기명피보험자 1인", couple: "부부", family: "가족", named_plus_one: "기명 1인 + 지정 1인", employees: "임직원", other: "그 밖" } as const;
const FACT_LABELS = { hospitalDays: "입원일수", outpatientDays: "통원일수", daysOffWork: "휴업일수", monthlyIncome: "월 소득" } as const;

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const limitText = (limit: Limit | null) => (limit === null ? "모름" : limit === "unlimited" ? "무한" : won(limit));

/** 인식값이 가리키는 칸. 금액(loss)은 서류마다 줄을 쌓고, 나머지는 칸마다 한 줄이다(addRecognitions) */
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
  const issuer = reading.issuer || null;
  const docDate = reading.documentDate || null;
  const recognitions: Recognition[] = [...sums].map(([code, sum]) => ({ id: makeId(), kind: "loss", cardId, code, value: sum.amount, source, note: sum.basis.join(" · "), issuer, docDate }));
  if (claim.victims.some((v) => v.id === cardId))
    for (const field of FACT_FIELDS) {
      const value = reading.facts[field];
      if (value === null) continue;
      // 서류별 값에 기간·급여 월을 함께 둔다. 여러 서류를 합칠 때 쓴다(mergeFact)
      const one: FactReading = { source, value, periods: readingPeriods(reading, field), month: field === "monthlyIncome" ? monthOf(reading.facts.incomeMonth) : null };
      recognitions.push({ id: makeId(), kind: "fact", cardId, field, value, source, note: "", readings: [one] });
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

/**
 * 확인 대기 값을 더한다(라운드 8b).
 * - 금액: 덮어쓰지 않고 서류마다 한 줄씩 쌓는다. 화면은 같은 칸의 줄을 묶어 합계를 낸다(lossGroup).
 * - 날수·소득: 더하지 않는다. 한 줄에 서류별 값을 모으고 가장 큰 값을 넣는다(값이 다르면 화면이 각 값을 보여 준다).
 * - 증권 값: 같은 칸의 예전 대기 값을 새 값으로 바꾼다.
 */
export function addRecognitions(claim: Claim, recognitions: Recognition[]): Claim {
  let recognized = claim.recognized;
  for (const r of recognitions) {
    if (r.kind === "loss") {
      recognized = [...recognized, r];
      continue;
    }
    const key = targetKey(r);
    const old = recognized.find((x) => targetKey(x) === key);
    if (r.kind === "fact" && old?.kind === "fact") {
      const readings = [...factReadings(old), ...factReadings(r)];
      const { value, formula } = mergeFact(r.field, readings, claim.accident.occurredAt);
      const merged: Recognition = { ...old, value, formula: formula ?? undefined, readings, source: [...new Set(readings.map((x) => x.source))].join(" · ") };
      recognized = recognized.map((x) => (x === old ? merged : x));
      continue;
    }
    recognized = [...recognized.filter((x) => targetKey(x) !== key), r];
  }
  return { ...claim, recognized };
}

type LossRecognition = Extract<Recognition, { kind: "loss" }>;
type FactRecognition = Extract<Recognition, { kind: "fact" }>;

/** 날수·소득 한 줄에 모인 서류별 값 */
export function factReadings(r: FactRecognition): FactReading[] {
  return r.readings ?? [{ source: r.source, value: r.value }];
}

/** 서류마다 값이 다른지("서류마다 다르게 적혀 있어요"). 날짜로 합쳤거나 평균을 냈으면(formula) 계산식을 대신 보여 준다 */
export function factDiffers(r: FactRecognition): boolean {
  return !r.formula && new Set(factReadings(r).map((x) => x.value)).size > 1;
}

// ── 여러 서류의 날수·소득 합치기(라운드 8c) ──

const DAY_MS = 24 * 60 * 60 * 1000;
const isDate = (s: string | null | undefined): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const monthOf = (s: string | null | undefined) => (typeof s === "string" && /^\d{4}-\d{2}$/.test(s) ? s : null);
const mmdd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 서류에서 읽은 기간(날수 칸별). 날짜가 하나라도 이상하면 null(기간을 읽지 못한 서류로 본다) */
function readingPeriods(reading: ClaimReading, field: (typeof FACT_FIELDS)[number]): Period[] | null {
  const f = reading.facts;
  const list = field === "hospitalDays" ? f.hospitalPeriods : field === "daysOffWork" ? f.daysOffWorkPeriods : field === "outpatientDays" ? f.outpatientDates?.map((d) => ({ start: d, end: d })) : null;
  if (!list?.length) return null;
  return list.every((p) => isDate(p.start) && isDate(p.end) && p.start <= p.end) ? list : null;
}

/** 기간들을 날짜로 합쳐 센 날수(시작·종료일 포함, 겹치는 날은 한 번) */
export function countPeriodDays(periods: Period[]): number {
  const days = new Set<number>();
  for (const p of periods) for (let t = Date.parse(p.start); t <= Date.parse(p.end); t += DAY_MS) days.add(t);
  return days.size;
}

/**
 * 같은 칸을 읽은 여러 서류의 값을 하나로 합친다.
 * - 날수: 모든 서류에 기간이 있으면 날짜로 합친다(겹치지 않으면 더하고, 겹치는 날은 한 번). 하나라도 없으면 큰 값(화면은 "서류마다 다르게").
 * - 월 소득: 급여 월을 아는 서류 중 사고일 직전 최근 3개월치(사고 달 이전, 같은 달은 한 번)의 월평균(원 미만 버림).
 *   급여소득자 산정대상기간: 별표1 가. 사망 3. 나.(1)(가)①, 인쇄 72쪽(휴업손해 다.(1)(가) 인쇄 77쪽 준용). 급여 월을 아는 서류가 없으면 전체 평균.
 */
export function mergeFact(field: (typeof FACT_FIELDS)[number], readings: FactReading[], accidentDate: string | null): { value: number; formula: string | null } {
  const max = Math.max(...readings.map((x) => x.value));
  if (readings.length < 2) return { value: readings[0]?.value ?? 0, formula: null };
  if (field === "monthlyIncome") {
    const before = accidentDate && isDate(accidentDate) ? accidentDate.slice(0, 7) : null;
    const byMonth = new Map<string, number>();
    for (const r of readings) if (r.month && (!before || r.month < before) && !byMonth.has(r.month)) byMonth.set(r.month, r.value);
    const months = [...byMonth.keys()].sort().slice(-SALARY_INCOME_PERIOD.months);
    const used = months.length ? months.map((m) => byMonth.get(m)!) : readings.map((r) => r.value);
    const value = Math.floor(used.reduce((a, b) => a + b, 0) / used.length);
    const sum = `(${used.map((v) => v.toLocaleString("ko-KR")).join(" + ")}) ÷ ${used.length}`;
    const label = months.length ? `${months.map((m) => `${Number(m.slice(5))}월`).join("·")} 평균` : "서류 평균(급여 월을 몰라 모두 평균)";
    return { value, formula: `${label} ${sum} = ${value.toLocaleString("ko-KR")}원 — 사고 직전 3개월 평균(별표1 가. 3. 나.(1)(가)①, 인쇄 ${SALARY_INCOME_PERIOD.basis.page}쪽)` };
  }
  const periods = readings.map((r) => r.periods);
  if (periods.every((p): p is Period[] => !!p?.length)) {
    const all = periods.flat();
    const value = countPeriodDays(all);
    const total = all.reduce((sum, p) => sum + countPeriodDays([p]), 0);
    const ranges = all.map((p) => (p.start === p.end ? mmdd(p.start) : `${mmdd(p.start)}~${mmdd(p.end)}`)).join(" + ");
    return { value, formula: `${ranges} = ${value}일${total > value ? `(겹치는 ${total - value}일은 한 번만)` : ""}` };
  }
  return { value: max, formula: null };
}

/** 한 카드·한 항목에 쌓인 금액 줄 */
export function lossGroup(claim: Claim, cardId: string, code: string): LossRecognition[] {
  return claim.recognized.filter((r): r is LossRecognition => r.kind === "loss" && r.cardId === cardId && r.code === code);
}

/** 뺀 줄을 빼고 더한 합계 */
export function groupTotal(rows: LossRecognition[]): number {
  return rows.reduce((sum, r) => sum + (r.excluded ? 0 : r.value), 0);
}

/** 날짜·금액·기관명이 같은 줄("같은 서류로 보여요"). 날짜나 기관명을 못 읽은 줄은 둘 다 못 읽었을 때 같다고 본다 */
export function duplicateIds(rows: LossRecognition[]): Set<string> {
  const key = (r: LossRecognition) => JSON.stringify([r.value, r.docDate ?? null, r.issuer ?? null]);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  return new Set(rows.filter((r) => counts.get(key(r))! > 1).map((r) => r.id));
}

/** 줄 빼기(체크 해제)·되돌리기 */
export function setExcluded(claim: Claim, id: string, excluded: boolean): Claim {
  return { ...claim, recognized: claim.recognized.map((r) => (r.id === id && r.kind === "loss" ? { ...r, excluded } : r)) };
}

/** 묶음 확인: 빼지 않은 줄의 합계를 확정 칸에 넣고, 이 항목의 줄을 모두 대기 목록에서 뺀다 */
export function confirmLossGroup(claim: Claim, cardId: string, code: string): Claim {
  const rows = lossGroup(claim, cardId, code);
  const kept = rows.filter((r) => !r.excluded);
  const ids = new Set(rows.map((r) => r.id));
  const rest = { ...claim, recognized: claim.recognized.filter((r) => !ids.has(r.id)) };
  if (!kept.length) return rest;
  return setItem(rest, cardId, code, { confirmed: groupTotal(rows), evidence: `서류 인식 확인: ${kept.map((r) => r.source).join(" + ")}` });
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
