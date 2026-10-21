import { documentsFor, itemsFor, lossItemDef, type LossItemDef } from "@/lib/claim/lossItems";
import { STANDARDS_AS_OF } from "@/lib/claim/standards";
import { emptyLossItem, type Claim, type Coverage, type Policy, type PolicyCoverage, type Property, type Victim } from "@/lib/claim/types";
import { pickValue } from "@/lib/engine/losses";

// MASTER.md 7장 입력 7단계의 화면 순서와 상태 변경. React와 분리해 테스트한다(tests/ui/flow.test.ts).
// 한 화면에 질문 하나가 원칙이다. 6단계의 "치료·휴업 사실"만 한 화면에 묶었다(사람마다 7개 질문이 되면 너무 길어서, 라운드 5 보고서).

export const STEP_TITLES = ["사고 접수", "사람·물건 정리", "내 보험", "상대 보험", "면책·과실", "손해 입력", "보상 검토서"] as const;

export type ScreenKind =
  | "narrative"
  | "date"
  | "place"
  | "type"
  | "parties"
  | "injury"
  | "outcome"
  | "relation"
  | "counterpartyRole"
  | "vehicleValue"
  | "productLine"
  | "coverages"
  | "propertyLimit"
  | "personalInjuryLimit"
  | "uninsuredLimit"
  | "ownDamage"
  | "driverScope"
  | "counterpartyStatus"
  | "counterpartyBodily2"
  | "counterpartyProperty"
  | "violations"
  | "driverRelation"
  | "fault"
  | "facts"
  | "losses"
  | "propertyLosses"
  | "result";

export type Screen = { id: string; step: number; kind: ScreenKind; cardId?: string; title: string; hint?: string; skippable: boolean };

const hasCoverage = (policy: Policy, coverage: Coverage) => policy.coverages.some((c) => c.coverage === coverage);
const counterpartyVehicle = (claim: Claim) => claim.accident.type === null || claim.accident.type === "car_car" || claim.accident.type === "hit_and_run_or_uninsured";

/** 지금 입력 상태에서 보여 줄 화면 목록(순서대로) */
export function screensFor(claim: Claim): Screen[] {
  const s: Screen[] = [];
  const add = (screen: Omit<Screen, "skippable"> & { skippable?: boolean }) => s.push({ skippable: true, ...screen });

  // 1 사고 접수
  add({ id: "narrative", step: 1, kind: "narrative", title: "어떤 사고였나요?", hint: "기억나는 대로 적어 주세요. 음성 입력은 준비 중입니다." });
  add({ id: "type", step: 1, kind: "type", title: "어떤 사고였나요?", hint: "가장 가까운 것을 고르세요." });
  add({ id: "date", step: 1, kind: "date", title: "언제 일어났나요?", hint: "날짜에 따라 적용되는 약관 판이 달라집니다." });
  add({ id: "place", step: 1, kind: "place", title: "어디서 일어났나요?" });

  // 2 사람·물건 정리
  add({ id: "parties", step: 2, kind: "parties", title: "누가 다치고, 무엇이 부서졌나요?", hint: "사람·물건마다 카드가 하나씩 생깁니다.", skippable: false });
  for (const v of claim.victims) {
    if (v.role === "family_passenger") add({ id: `relation:${v.id}`, step: 2, kind: "relation", cardId: v.id, title: `${v.label}은(는) 보험에 적힌 분(기명피보험자)과 어떤 관계인가요?` });
    if (v.role === "counterparty") add({ id: `counterpartyRole:${v.id}`, step: 2, kind: "counterpartyRole", cardId: v.id, title: `${v.label}은(는) 사고 때 무엇을 하고 있었나요?` });
    add({ id: `injury:${v.id}`, step: 2, kind: "injury", cardId: v.id, title: `${v.label}의 상해급수는 몇 급인가요?`, hint: "진단서나 보험사 안내에 적힌 급수(1급이 가장 무겁고 14급이 가장 가볍습니다)." });
    add({ id: `outcome:${v.id}`, step: 2, kind: "outcome", cardId: v.id, title: `${v.label}은(는) 치료 뒤 어떻게 되었나요?` });
  }
  for (const p of claim.properties) if (p.role === "my_vehicle") add({ id: `vehicleValue:${p.id}`, step: 2, kind: "vehicleValue", cardId: p.id, title: "내 차의 사고 직전 차량가액은 얼마인가요?", hint: "보험증권의 차량가액이나 시세. 전손·시세하락 계산에 씁니다." });

  // 3 내 보험
  add({ id: "productLine", step: 3, kind: "productLine", title: "내 자동차보험은 어떤 종류인가요?" });
  add({ id: "coverages", step: 3, kind: "coverages", title: "내 보험에 가입한 담보를 골라 주세요", hint: "증권의 '가입담보' 칸을 보세요. 대인배상Ⅰ은 의무보험이라 항상 있습니다.", skippable: false });
  const my = claim.myPolicy;
  if (hasCoverage(my, "liability_property")) add({ id: "propertyLimit", step: 3, kind: "propertyLimit", title: "대물배상 가입금액은 얼마인가요?" });
  if (hasCoverage(my, "auto_injury") || hasCoverage(my, "self_injury"))
    add({ id: "personalInjuryLimit", step: 3, kind: "personalInjuryLimit", title: hasCoverage(my, "auto_injury") ? "자동차상해 가입금액은 얼마인가요?" : "자기신체사고 가입금액은 얼마인가요?" });
  if (hasCoverage(my, "uninsured")) add({ id: "uninsuredLimit", step: 3, kind: "uninsuredLimit", title: "무보험차상해 가입금액은 얼마인가요?" });
  if (hasCoverage(my, "own_damage")) add({ id: "ownDamage", step: 3, kind: "ownDamage", title: "자기차량손해의 자기부담금은 어떻게 되나요?" });
  add({ id: "driverScope", step: 3, kind: "driverScope", title: "운전할 수 있는 사람의 범위는 어떻게 되나요?", hint: "증권의 '운전자 한정' 특약." });

  // 4 상대 보험(상대 차량이 있는 사고만)
  if (counterpartyVehicle(claim)) {
    add({ id: "counterpartyStatus", step: 4, kind: "counterpartyStatus", title: "상대 차는 어떤 보험에 들어 있나요?", hint: "모르면 '모름'을 고르세요. 보험사가 확인해 줍니다." });
    const cp = claim.counterpartyPolicy;
    // 대인Ⅱ 가입 여부를 모르면(hasBodily2 = null) 금액은 묻지 않고 "있음/없음" 두 시나리오로 계산한다(결정 기록 D-19)
    if (cp && cp.status === "full" && cp.hasBodily2 === true) add({ id: "counterpartyBodily2", step: 4, kind: "counterpartyBodily2", title: "상대 차의 대인배상Ⅱ 가입금액은 얼마인가요?" });
    if (cp && cp.status === "full") add({ id: "counterpartyProperty", step: 4, kind: "counterpartyProperty", title: "상대 차의 대물배상 가입금액은 얼마인가요?" });
  }

  // 5 면책·과실
  add({ id: "violations", step: 5, kind: "violations", title: "사고 당시 해당하는 것이 있나요?", hint: "보상 범위와 내가 낼 돈(사고부담금)이 달라집니다. 솔직하게 고를수록 정확합니다." });
  const v = claim.accident.violations;
  if (v.drunk || v.unlicensed || v.drugs) add({ id: "driverRelation", step: 5, kind: "driverRelation", title: "운전한 사람은 이 보험과 어떤 관계인가요?", hint: "자기차량손해 보상 여부가 이 관계로 정해집니다(약관 제23조 14호)." });
  add({ id: "fault", step: 5, kind: "fault", title: "내 과실은 몇 %인가요?", hint: "모르면 '모름'을 고르세요. 0·30·50·70% 네 경우를 모두 계산해 보여 드립니다." });

  // 6 손해 입력
  for (const victim of claim.victims) {
    add({ id: `facts:${victim.id}`, step: 6, kind: "facts", cardId: victim.id, title: `${victim.label}의 치료·휴업 정보`, hint: "아는 칸만 넣으세요. 넣은 값으로 약관 기준 금액을 계산합니다." });
    add({ id: `losses:${victim.id}`, step: 6, kind: "losses", cardId: victim.id, title: `${victim.label}의 손해`, hint: "서류로 확인한 금액과 대략 생각하는 금액을 따로 적으세요." });
  }
  for (const p of claim.properties) add({ id: `propertyLosses:${p.id}`, step: 6, kind: "propertyLosses", cardId: p.id, title: `${p.label}의 손해`, hint: "서류로 확인한 금액과 대략 생각하는 금액을 따로 적으세요." });

  // 7 결과 미리보기
  add({ id: "result", step: 7, kind: "result", title: "보상 검토서", skippable: false });
  return s;
}

// ── 건너뛰기 ──
/** 건너뛴 칸을 기록한다. 값은 비운다(모름) */
export function skip(claim: Claim, screen: Screen): Claim {
  const skipped = claim.skipped.includes(screen.id) ? claim.skipped : [...claim.skipped, screen.id];
  return { ...clearFor(claim, screen), skipped };
}

/** 값을 넣으면 "건너뜀" 표시를 지운다 */
export function unskip(claim: Claim, screenId: string): Claim {
  return claim.skipped.includes(screenId) ? { ...claim, skipped: claim.skipped.filter((id) => id !== screenId) } : claim;
}

function updateVictim(claim: Claim, id: string | undefined, change: Partial<Victim>): Claim {
  return { ...claim, victims: claim.victims.map((v) => (v.id === id ? { ...v, ...change } : v)) };
}

function clearFor(claim: Claim, screen: Screen): Claim {
  const a = claim.accident;
  switch (screen.kind) {
    case "narrative":
      return { ...claim, accident: { ...a, narrative: "" } };
    case "date":
      return { ...claim, accident: { ...a, occurredAt: null } };
    case "place":
      return { ...claim, accident: { ...a, place: "" } };
    case "type":
      return { ...claim, accident: { ...a, type: null } };
    case "injury":
      return updateVictim(claim, screen.cardId, { injuryGrade: null });
    case "outcome":
      return updateVictim(claim, screen.cardId, { died: null, disabilityGrade: null });
    case "relation":
      return updateVictim(claim, screen.cardId, { relationToNamedInsured: null });
    case "counterpartyRole":
      return updateVictim(claim, screen.cardId, { vehicleDriver: null });
    case "facts":
      return updateVictim(claim, screen.cardId, { hospitalDays: null, outpatientDays: null, mealsNotProvided: null, daysOffWork: null, monthlyIncome: null, incomeProven: null, occupation: null, incomeAmountProven: null });
    case "vehicleValue":
      return { ...claim, properties: claim.properties.map((p) => (p.id === screen.cardId ? { ...p, valueAtAccident: null } : p)) };
    case "productLine":
      return { ...claim, myPolicy: { ...claim.myPolicy, productLine: null } };
    case "propertyLimit":
      return setCoverage(claim, "liability_property", { limit: null });
    case "personalInjuryLimit": {
      const key = hasCoverage(claim.myPolicy, "auto_injury") ? "auto_injury" : "self_injury";
      return setCoverage(claim, key, { injuryLimit: null, deathLimit: null, disabilityLimit: null });
    }
    case "uninsuredLimit":
      return setCoverage(claim, "uninsured", { limit: null });
    case "ownDamage":
      return { ...claim, myPolicy: { ...claim.myPolicy, deductible: null } };
    case "driverScope":
      return { ...claim, myPolicy: { ...claim.myPolicy, driverScope: null } };
    case "counterpartyStatus":
      return { ...claim, counterpartyPolicy: counterpartyOf(claim, "unknown") };
    case "counterpartyBodily2":
      return claim.counterpartyPolicy ? { ...claim, counterpartyPolicy: { ...claim.counterpartyPolicy, coverages: claim.counterpartyPolicy.coverages.map((c) => (c.coverage === "liability_bodily_2" ? { ...c, limit: null } : c)) } } : claim;
    case "counterpartyProperty":
      return claim.counterpartyPolicy ? { ...claim, counterpartyPolicy: { ...claim.counterpartyPolicy, coverages: claim.counterpartyPolicy.coverages.map((c) => (c.coverage === "liability_property" ? { ...c, limit: null } : c)) } } : claim;
    case "violations":
      return { ...claim, accident: { ...a, violations: { ...a.violations, drunk: null, unlicensed: null, drugs: null, fledScene: null, outsideDriverScope: null, intentional: null } } };
    case "driverRelation":
      return { ...claim, accident: { ...a, violations: { ...a.violations, driverRelation: null } } };
    case "fault":
      return { ...claim, fault: { mode: "unknown" } };
    default:
      return claim;
  }
}

// ── 사람·물건 카드 ──
const VICTIM_LABEL: Record<Victim["role"], string> = { driver: "나(운전자)", family_passenger: "가족 동승자", other_passenger: "남 동승자", counterparty: "상대방" };
const PROPERTY_LABEL: Record<Property["role"], string> = { my_vehicle: "내 차", counterparty_vehicle: "상대 차", counterparty_property: "상대 물건" };

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

export function newProperty(role: Property["role"], n: number): Property {
  return { id: `${role}-${n}`, role, label: role === "my_vehicle" ? PROPERTY_LABEL.my_vehicle : `${PROPERTY_LABEL[role]} ${n}`, valueAtAccident: null, firstRegisteredOn: null, commercialUse: false, losses: [], userTotal: null };
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
  for (let n = kept.length + 1; n <= count; n++) kept.push(newProperty(role, n));
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
    if (counterpartyVehicle(claim) && cp && cp.status !== "uninsured" && cp.status !== "hit_and_run") coverages.push("liability_property");
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

// ── 7단계 "입력 필요" 목록 ──
export function skippedLabels(claim: Claim): string[] {
  const screens = screensFor(claim);
  return claim.skipped.map((id) => screens.find((s) => s.id === id)?.title ?? id);
}
