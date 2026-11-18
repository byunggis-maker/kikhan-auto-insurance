import { documentsFor, itemsFor, lossItemDef, type LossItemDef } from "@/lib/claim/lossItems";
import { STANDARDS_AS_OF } from "@/lib/claim/standards";
import { emptyLossItem, type Claim, type Coverage, type Policy, type PolicyCoverage, type Property, type Victim } from "@/lib/claim/types";
import { pickValue } from "@/lib/engine/losses";

// MASTER.md 7장 입력 7단계의 화면 순서와 상태 변경. React와 분리해 테스트한다(tests/ui/flow.test.ts).
// 라운드 9: 증권을 먼저 읽고 못 읽은 것만 묻는다. 선택형 질문은 한 화면에 드롭다운 여러 개로 모았다.
// 같은 정보를 두 번 묻지 않고, 결과를 바꾸지 않는 질문(사고 장소·경위)은 뺐다. '모르면 건너뛰기' 대신 드롭다운 첫 항목 '모름'.

export const STEP_TITLES = ["증권·사고일", "사고 상황", "사람·물건", "상대 차량", "과실비율", "손해", "보상 검토서"] as const;

export type ScreenKind = "policy" | "date" | "myPolicy" | "coverages" | "limits" | "situation" | "parties" | "person" | "counterparty" | "fault" | "facts" | "losses" | "propertyLosses" | "result";

export type Screen = { id: string; step: number; kind: ScreenKind; cardId?: string; title: string; hint?: string };

const hasCoverage = (policy: Policy, coverage: Coverage) => policy.coverages.some((c) => c.coverage === coverage);
export const counterpartyVehicle = (claim: Claim) => claim.accident.type === null || claim.accident.type === "car_car" || claim.accident.type === "hit_and_run_or_uninsured";

/** 증권에서 읽어 확인한 칸인지(lib/ui/recognize.ts policyKeys) */
export const isRead = (claim: Claim, key: string) => (claim.policyRead ?? []).includes(key);

/** 내 보험의 가입금액 드롭다운 중 이 화면에 보일 것(증권에서 읽은 칸은 빼고) */
export type LimitField = "property" | "injury" | "death" | "uninsured" | "deductible";
export function limitFields(claim: Claim): LimitField[] {
  const my = claim.myPolicy;
  const personal: Coverage | null = hasCoverage(my, "auto_injury") ? "auto_injury" : hasCoverage(my, "self_injury") ? "self_injury" : null;
  const out: LimitField[] = [];
  if (hasCoverage(my, "liability_property") && !isRead(claim, "limit:liability_property")) out.push("property");
  if (personal && !isRead(claim, `injury:${personal}`)) out.push("injury");
  if (personal && !isRead(claim, `death:${personal}`)) out.push("death");
  if (hasCoverage(my, "uninsured") && !isRead(claim, "limit:uninsured")) out.push("uninsured");
  if (hasCoverage(my, "own_damage") && !isRead(claim, "deductible")) out.push("deductible");
  return out;
}

/** 지금 입력 상태에서 보여 줄 화면 목록(순서대로) */
export function screensFor(claim: Claim): Screen[] {
  const s: Screen[] = [];
  const add = (screen: Screen) => s.push(screen);

  // 1 증권·사고일: 증권을 먼저 읽고, 사고일을 묻고, 증권에서 못 읽은 것만 묻는다
  add({ id: "policy", step: 1, kind: "policy", title: "가입증명서·증권 올리기", hint: "증권에서 읽은 항목은 다시 묻지 않습니다." });
  add({ id: "date", step: 1, kind: "date", title: "사고일은 언제인가요?" });
  if (!isRead(claim, "productLine") || !isRead(claim, "driverScope")) add({ id: "myPolicy", step: 1, kind: "myPolicy", title: "내 보험" });
  if (!isRead(claim, "coverages")) add({ id: "coverages", step: 1, kind: "coverages", title: "가입담보", hint: "대인배상Ⅰ은 의무보험이라 항상 있습니다." });
  if (limitFields(claim).length) add({ id: "limits", step: 1, kind: "limits", title: "가입금액" });

  // 2 사고 상황
  add({ id: "situation", step: 2, kind: "situation", title: "사고 당시 상황" });

  // 3 사람·물건
  add({ id: "parties", step: 3, kind: "parties", title: "다친 사람과 부서진 물건" });
  for (const v of claim.victims) add({ id: `person:${v.id}`, step: 3, kind: "person", cardId: v.id, title: `${v.label}의 상해` });

  // 4 상대 차량 보험(상대 차량이 있는 사고만)
  if (counterpartyVehicle(claim)) add({ id: "counterparty", step: 4, kind: "counterparty", title: "상대 차량 보험" });

  // 5 과실비율
  add({ id: "fault", step: 5, kind: "fault", title: "과실비율" });

  // 6 손해
  for (const victim of claim.victims) {
    add({ id: `facts:${victim.id}`, step: 6, kind: "facts", cardId: victim.id, title: `${victim.label}의 치료·휴업 정보`, hint: "아는 칸만 넣으세요. 넣은 값으로 지급기준 금액을 계산합니다." });
    add({ id: `losses:${victim.id}`, step: 6, kind: "losses", cardId: victim.id, title: `${victim.label}의 손해`, hint: "서류로 확인한 금액과 대략 생각하는 금액을 따로 적으세요." });
  }
  for (const p of claim.properties) add({ id: `propertyLosses:${p.id}`, step: 6, kind: "propertyLosses", cardId: p.id, title: `${p.label}의 손해`, hint: "서류로 확인한 금액과 대략 생각하는 금액을 따로 적으세요." });

  // 7 보상 검토서
  add({ id: "result", step: 7, kind: "result", title: "보상 검토서" });
  return s;
}

/** 보험기간 점검(라운드 9). 증권의 보험기간과 사고일을 비교한다. 둘 중 하나를 모르면 null */
export function periodCheck(claim: Claim): "inside" | "outside" | null {
  const { periodStart, periodEnd } = claim.myPolicy;
  const date = claim.accident.occurredAt?.slice(0, 10);
  if (!periodStart || !periodEnd || !date) return null;
  return date >= periodStart && date <= periodEnd ? "inside" : "outside";
}

// ── '모름'이면 일반적 가입 기준으로 추정(라운드 9) ──
/** 상대 차량 보험을 모를 때 쓰는 일반적 가입 기준 */
export const TYPICAL_COUNTERPARTY = { property: 200_000_000 } as const;
export const ASSUMPTION_TEXT = {
  cp_status: "상대 차량 보험을 몰라 일반적 가입 기준(대인배상Ⅰ, 대인배상Ⅱ 무한, 대물배상 2억 원)으로 추정했습니다.",
  cp_bodily2: "상대 차량 대인배상Ⅱ 가입금액을 몰라 일반적 가입 기준(무한)으로 추정했습니다.",
  cp_property: "상대 차량 대물배상 가입금액을 몰라 일반적 가입 기준(2억 원)으로 추정했습니다.",
} as const;

/**
 * 계산에 넣기 전에 상대 차량 보험의 '모름'을 일반적 가입 기준으로 채운다. 입력값(저장값)은 바꾸지 않는다.
 * 뺑소니·무보험 사고 유형이면 채우지 않는다(무보험을 종합보험으로 추정하면 안 되므로).
 */
export function withAssumptions(claim: Claim): { claim: Claim; assumptions: (keyof typeof ASSUMPTION_TEXT)[] } {
  if (!counterpartyVehicle(claim) || claim.accident.type === "hit_and_run_or_uninsured") return { claim, assumptions: [] };
  const cp = claim.counterpartyPolicy;
  const fill = (policy: Policy, keys: (keyof typeof ASSUMPTION_TEXT)[]) => {
    const coverages = policy.coverages.map((c) => (c.coverage === "liability_bodily_2" && c.limit === null ? { ...c, limit: "unlimited" as const } : c.coverage === "liability_property" && c.limit === null ? { ...c, limit: TYPICAL_COUNTERPARTY.property } : c));
    return { claim: { ...claim, counterpartyPolicy: { ...policy, coverages } }, assumptions: keys };
  };
  if (cp === null || cp.status === "unknown") return fill(counterpartyOf({ ...claim, counterpartyPolicy: null }, "full", true), ["cp_status"]);
  if (cp.status !== "full") return { claim, assumptions: [] };
  const limit = (coverage: Coverage) => cp.coverages.find((c) => c.coverage === coverage)?.limit;
  const keys: (keyof typeof ASSUMPTION_TEXT)[] = [];
  if (limit("liability_bodily_2") === null) keys.push("cp_bodily2");
  if (limit("liability_property") === null) keys.push("cp_property");
  return keys.length ? fill(cp, keys) : { claim, assumptions: [] };
}

/** 검토서의 '입력 필요'에 모을 '모름' 칸 */
export function unknownLabels(claim: Claim): string[] {
  const out: string[] = [];
  if (!claim.accident.occurredAt) out.push("사고일");
  if (!claim.myPolicy.productLine) out.push("보험 종류");
  if (!claim.myPolicy.driverScope) out.push("운전자 범위 한정특약");
  if (!claim.accident.type) out.push("사고 유형");
  for (const v of claim.victims) if (v.injuryGrade === null && v.died !== true) out.push(`${v.label}: 상해 급별`);
  return out;
}

// ── 사람·물건 카드 ──
const VICTIM_LABEL: Record<Victim["role"], string> = { driver: "피보험자(나)", family_passenger: "가족 동승자", other_passenger: "남 동승자", counterparty: "상대방" };
const PROPERTY_LABEL: Record<Property["role"], string> = { my_vehicle: "내 차", counterparty_vehicle: "상대 차량", counterparty_property: "상대 물건" };

export function newVictim(role: Victim["role"], n: number, claim: Claim): Victim {
  const label = role === "driver" ? VICTIM_LABEL.driver : `${VICTIM_LABEL[role]} ${n}`;
  return {
    id: `${role}-${n}`,
    role,
    label,
    relationToNamedInsured: role === "driver" ? "self" : role === "other_passenger" ? "none" : null,
    // 자동차(이륜자동차 제외) 운전자인지: 내가 운전자면 내 보험이 이륜차가 아닐 때 예(별표4 (*1))
    vehicleDriver: role === "driver" ? claim.myPolicy.productLine !== "motorcycle" : role === "counterparty" ? null : false,
    age: null,
    injuryGrade: null,
    disabilityGrade: null,
    died: false,
    rideAlongReductionPercent: 0,
    hospitalDays: null,
    outpatientDays: null,
    mealsNotProvided: null,
    daysOffWork: null,
    monthlyIncome: null,
    incomeProven: null,
    occupation: null,
    incomeAmountProven: null,
    losses: [],
    userTotal: null,
  };
}

export function newProperty(role: Property["role"], n: number, claim?: Claim): Property {
  // 내 차의 사고 직전 가액은 증권의 차량가액(차량가입금액)을 쓴다(라운드 9)
  const policyValue = role === "my_vehicle" ? (claim?.myPolicy.vehicleValue ?? null) : null;
  return {
    id: `${role}-${n}`,
    role,
    label: role === "my_vehicle" ? PROPERTY_LABEL.my_vehicle : `${PROPERTY_LABEL[role]} ${n}`,
    valueAtAccident: policyValue,
    valueSource: policyValue === null ? null : "policy",
    firstRegisteredOn: null,
    commercialUse: false,
    losses: [],
    userTotal: null,
  };
}

/** 역할별 사람 수를 맞춘다. 줄일 때는 뒤에서부터 지운다(입력한 손해도 함께) */
export function setVictimCount(claim: Claim, role: Victim["role"], count: number): Claim {
  const same = claim.victims.filter((v) => v.role === role);
  const others = claim.victims.filter((v) => v.role !== role);
  const kept = same.slice(0, count);
  for (let n = kept.length + 1; n <= count; n++) kept.push(newVictim(role, n, claim));
  const order: Victim["role"][] = ["driver", "family_passenger", "other_passenger", "counterparty"];
  return { ...claim, victims: [...others, ...kept].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)) };
}

export function setPropertyCount(claim: Claim, role: Property["role"], count: number): Claim {
  const same = claim.properties.filter((p) => p.role === role);
  const others = claim.properties.filter((p) => p.role !== role);
  const kept = same.slice(0, count);
  for (let n = kept.length + 1; n <= count; n++) kept.push(newProperty(role, n, claim));
  const order: Property["role"][] = ["my_vehicle", "counterparty_vehicle", "counterparty_property"];
  return { ...claim, properties: [...others, ...kept].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)) };
}

// ── 보험 ──
export function setCoverage(claim: Claim, coverage: Coverage, change: Partial<PolicyCoverage>): Claim {
  const coverages = claim.myPolicy.coverages.map((c) => (c.coverage === coverage ? { ...c, ...change } : c));
  return { ...claim, myPolicy: { ...claim.myPolicy, coverages } };
}

export function toggleCoverage(claim: Claim, coverage: Coverage, on: boolean): Claim {
  let coverages = claim.myPolicy.coverages.filter((c) => c.coverage !== coverage);
  // 자동차상해와 자기신체사고는 둘 중 하나만(policySchema)
  if (on && coverage === "auto_injury") coverages = coverages.filter((c) => c.coverage !== "self_injury");
  if (on && coverage === "self_injury") coverages = coverages.filter((c) => c.coverage !== "auto_injury");
  if (on) coverages.push({ coverage, limit: coverage === "liability_bodily_2" ? "unlimited" : null, injuryLimit: null, deathLimit: null, disabilityLimit: null });
  return { ...claim, myPolicy: { ...claim.myPolicy, coverages, hasBodily2: coverages.some((c) => c.coverage === "liability_bodily_2") } };
}

export function counterpartyOf(claim: Claim, status: Policy["status"], hasBodily2: boolean | null = status === "full" ? true : status === "mandatory_only" ? false : null): Policy {
  const previous = claim.counterpartyPolicy;
  const keep = (coverage: Coverage, fallback: PolicyCoverage["limit"]) => previous?.coverages.find((c) => c.coverage === coverage)?.limit ?? fallback;
  const entry = (coverage: Coverage, limit: PolicyCoverage["limit"]): PolicyCoverage => ({ coverage, limit, injuryLimit: null, deathLimit: null, disabilityLimit: null });
  const coverages =
    status === "full" || status === "mandatory_only"
      ? [entry("liability_bodily_1", null), ...(hasBodily2 === false ? [] : [entry("liability_bodily_2", keep("liability_bodily_2", null))]), entry("liability_property", status === "mandatory_only" ? 20_000_000 : keep("liability_property", null))]
      : [];
  return { side: "counterparty", productLine: null, insurer: previous?.insurer ?? "", status, coverages, driverScope: null, deductible: null, hasBodily2 };
}

// ── 6단계 손해 항목 ──
/** 이 카드에 보일 항목: 가입한(또는 상대가 가진) 담보에 해당하고, 사람의 상태(후유장애·사망·급수)에 맞는 것 */
export function visibleItems(claim: Claim, cardId: string): LossItemDef[] {
  const victim = claim.victims.find((v) => v.id === cardId);
  if (victim) {
    // 사람 손해는 누구에게나 대인배상Ⅰ(또는 정부보장사업)이 있으므로 별표1 항목이 기본이다
    const coverages: Coverage[] = ["liability_bodily_1", ...claim.myPolicy.coverages.map((c) => c.coverage)];
    return itemsFor("person", coverages).filter((item) => {
      if (item.category === "death") return victim.died === true;
      if (item.category === "disability") return victim.disabilityGrade !== null && victim.died !== true;
      if (victim.died === true) return item.code === "treatment" || item.code === "rescue_cost";
      if (item.code === "future_treatment") return victim.injuryGrade === null || victim.injuryGrade <= 11;
      return true;
    });
  }
  const property = claim.properties.find((p) => p.id === cardId);
  if (!property) return [];
  const coverages: Coverage[] = [];
  if (property.role === "my_vehicle") {
    const cp = claim.counterpartyPolicy;
    // 상대 차량 보험을 모르면(null) 일반적 가입 기준으로 계산하므로(withAssumptions) 대물배상 항목을 보인다
    if (counterpartyVehicle(claim) && (!cp || (cp.status !== "uninsured" && cp.status !== "hit_and_run"))) coverages.push("liability_property");
    if (hasCoverage(claim.myPolicy, "own_damage")) coverages.push("own_damage");
  } else coverages.push("liability_property");
  return itemsFor("property", coverages).filter((item) => (item.code === "idle" ? property.commercialUse === true : item.code === "rental" ? property.commercialUse !== true : item.code === "business_loss" ? property.role === "counterparty_property" : true));
}

/** 항목 값을 바꾼다. 처음 넣으면 항목을 만든다. 확정·추정이 모두 비고 약관 기준도 끄면 항목을 지운다 */
export function setItem(claim: Claim, cardId: string, code: string, change: { confirmed?: number | null; estimated?: number | null; evidence?: string | null; standard?: boolean }): Claim {
  const covered = [...claim.myPolicy.coverages.map((c) => c.coverage), "liability_bodily_1" as Coverage];
  const docs = documentsFor(code, covered);
  const apply = (losses: Victim["losses"]) => {
    const current = losses.find((i) => i.code === code) ?? emptyLossItem(code, docs);
    const confirmed = change.confirmed !== undefined ? change.confirmed : current.confirmed;
    const estimated = change.estimated !== undefined ? change.estimated : current.estimated;
    const next = {
      ...current,
      confirmed,
      estimated,
      evidence: confirmed === null ? null : (change.evidence !== undefined ? change.evidence : current.evidence) ?? "서류",
      source: { confirmed: confirmed === null ? null : ("document" as const), estimated: estimated === null ? null : ("user_estimate" as const) },
    };
    const keepEmpty = change.standard ?? (losses.some((i) => i.code === code) && current.confirmed === null && current.estimated === null);
    const empty = next.confirmed === null && next.estimated === null;
    const rest = losses.filter((i) => i.code !== code);
    if (empty && !keepEmpty) return rest;
    // 항목 순서는 lossItems.ts 순서를 따른다
    return [...rest, next].sort((a, b) => order(a.code) - order(b.code));
  };
  return {
    ...claim,
    victims: claim.victims.map((v) => (v.id === cardId ? { ...v, losses: apply(v.losses) } : v)),
    properties: claim.properties.map((p) => (p.id === cardId ? { ...p, losses: apply(p.losses) } : p)),
  };
}

const order = (code: string) => {
  const def = lossItemDef(code);
  return def ? ["rescue_cost", "treatment", "future_treatment", "solatium_injury", "lost_income", "nursing", "other_injury", "solatium_disability", "lost_earnings_disability", "home_nursing", "funeral", "solatium_death", "lost_earnings_death", "repair", "replacement_value", "rental", "idle", "business_loss", "depreciation", "towing"].indexOf(code) : 99;
};

/** 계산에 쓰는 날짜(사고일, 모르면 금액 기준의 날짜). 약관 기준 금액과 일용근로자 임금이 이 날짜로 정해진다 */
export function claimDate(claim: Claim): string {
  return claim.accident.occurredAt?.slice(0, 10) ?? STANDARDS_AS_OF;
}

// ── 7단계 "약관 기준으로 채울 수 있는 칸"(라운드 5 보완 B) ──
/** 약관 기준 금액이 0원보다 크게 나오는데 아직 쓰지 않은(항목이 없는) 칸. 순서는 6단계 화면 순서 */
export function standardFillable(claim: Claim): { cardId: string; code: string; label: string; screenId: string }[] {
  const date = claimDate(claim);
  return claim.victims.flatMap((victim) =>
    visibleItems(claim, victim.id)
      .filter((def) => !victim.losses.some((i) => i.code === def.code))
      .filter((def) => (pickValue(emptyLossItem(def.code, []), "with_estimates", victim, date)?.amount ?? 0) > 0)
      .map((def) => ({ cardId: victim.id, code: def.code, label: `${victim.label}: ${def.label}`, screenId: `losses:${victim.id}` })),
  );
}
