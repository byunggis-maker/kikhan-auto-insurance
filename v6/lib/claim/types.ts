import { z } from "zod";

// MASTER.md 4장 자료 구조. 계산 단위는 담보가 아니라 사람 한 명(Victim), 물건 한 개(Property)다.
// 금액은 모두 원 단위 정수. 모르면 null, 없다고 확인했으면 0.
// 이 스키마는 화면 입력과 localStorage 저장값 확인(lib/claim/persist.ts)에 함께 쓴다.

export const moneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export type Money = z.infer<typeof moneySchema>;

const percentSchema = z.number().int().min(0).max(100);
const gradeSchema = z.number().int().min(1).max(14);
const daysSchema = z.number().int().min(0).max(36_500);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ── 지급처 ──
export const PAYERS = ["counterparty_insurer", "own_insurer", "government"] as const;
export const payerSchema = z.enum(PAYERS);
export type Payer = z.infer<typeof payerSchema>;
export const PAYER_LABELS: Record<Payer, string> = { counterparty_insurer: "상대 보험", own_insurer: "내 보험", government: "정부보장사업" };

// ── 사고 ──
export const ACCIDENT_TYPES = ["car_car", "car_person", "single", "hit_and_run_or_uninsured"] as const;
export const ACCIDENT_TYPE_LABELS: Record<(typeof ACCIDENT_TYPES)[number], string> = {
  car_car: "차대차",
  car_person: "차대사람",
  single: "단독",
  hit_and_run_or_uninsured: "뺑소니·무보험",
};

export const DRIVER_RELATIONS = ["policyholder_or_named", "long_term_lessee", "cohabiting_relative", "other"] as const;
export type DriverRelation = (typeof DRIVER_RELATIONS)[number];

/** 면책·제한 확인에 쓰는 사고 사실(MASTER.md 6장 (1)). 모르면 null */
export const violationsSchema = z.object({
  drunk: z.boolean().nullable(),
  unlicensed: z.boolean().nullable(),
  drugs: z.boolean().nullable(),
  /** 사고발생 시의 조치의무 위반(도주) */
  fledScene: z.boolean().nullable(),
  /** 운전자가 증권의 운전자 범위 밖인지 */
  outsideDriverScope: z.boolean().nullable(),
  intentional: z.boolean().nullable(),
  /**
   * 운전자와 이 보험의 관계. 음주·무면허·마약일 때 자기차량손해 면책은 운전자가 보험계약자·기명피보험자,
   * 30일을 넘는 임대차의 임차인, 기명피보험자와 같이 살거나 생계를 같이하는 친족일 때만이다(제23조 14호). 모르면 null
   */
  driverRelation: z.enum(DRIVER_RELATIONS).nullable(),
});

export const accidentSchema = z.object({
  /** 사고 일시(현지 시각, "2026-09-01T14:30"). 모르면 null */
  occurredAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
    .nullable(),
  place: z.string(),
  /** 사고 경위(말하거나 쓴 그대로) */
  narrative: z.string(),
  type: z.enum(ACCIDENT_TYPES).nullable(),
  violations: violationsSchema,
});
export type Accident = z.infer<typeof accidentSchema>;

// ── 보험 ──
export const PRODUCT_LINES = ["personal", "business", "commercial", "motorcycle"] as const;
export const productLineSchema = z.enum(PRODUCT_LINES);
export type ProductLine = z.infer<typeof productLineSchema>;
export const PRODUCT_LINE_LABELS: Record<ProductLine, string> = { personal: "개인용", business: "업무용", commercial: "영업용", motorcycle: "이륜차" };

export const COVERAGES = ["liability_bodily_1", "liability_bodily_2", "liability_property", "self_injury", "auto_injury", "uninsured", "own_damage"] as const;
export const coverageSchema = z.enum(COVERAGES);
export type Coverage = z.infer<typeof coverageSchema>;
export const COVERAGE_LABELS: Record<Coverage, string> = {
  liability_bodily_1: "대인배상Ⅰ",
  liability_bodily_2: "대인배상Ⅱ",
  liability_property: "대물배상",
  self_injury: "자기신체사고",
  auto_injury: "자동차상해",
  uninsured: "무보험자동차에 의한 상해",
  own_damage: "자기차량손해",
};

export const limitSchema = z.union([moneySchema, z.literal("unlimited")]);
export type Limit = z.infer<typeof limitSchema>;

/** 가입담보 하나. 자기신체사고·자동차상해는 부상과 사망·후유장애 가입금액이 따로 있다 */
export const policyCoverageSchema = z.object({
  coverage: coverageSchema,
  /** 대표 가입금액(대인Ⅱ 무한 등). 모르면 null */
  limit: limitSchema.nullable(),
  injuryLimit: limitSchema.nullable(),
  deathLimit: limitSchema.nullable(),
  disabilityLimit: limitSchema.nullable(),
});
export type PolicyCoverage = z.infer<typeof policyCoverageSchema>;

export const deductibleSchema = z.union([
  z.object({ type: z.literal("fixed"), amount: moneySchema }),
  z.object({ type: z.literal("rate"), ratePercent: z.number().int().min(1).max(100), min: moneySchema, max: moneySchema }),
]);
export type Deductible = z.infer<typeof deductibleSchema>;

export const DRIVER_SCOPES = ["anyone", "named_only", "couple", "family", "named_plus_one", "employees", "other"] as const;
/** 운전자 범위 한정특약(약관 용어) */
export const DRIVER_SCOPE_LABELS: Record<(typeof DRIVER_SCOPES)[number], string> = {
  anyone: "누구나(한정 없음)",
  family: "가족한정",
  couple: "부부한정",
  named_only: "기명피보험자 1인 한정",
  named_plus_one: "기명피보험자 1인 및 지정 1인 한정",
  employees: "임직원 한정",
  other: "그 밖의 한정",
};

/** 상대 차량의 보험 상태. 대인Ⅰ의 지급처를 정한다(lib/claim/payer.ts) */
export const INSURANCE_STATUSES = ["full", "mandatory_only", "uninsured", "hit_and_run", "no_counterparty", "unknown"] as const;
export const insuranceStatusSchema = z.enum(INSURANCE_STATUSES);
export type InsuranceStatus = z.infer<typeof insuranceStatusSchema>;

export const policySchema = z.object({
  side: z.enum(["mine", "counterparty"]),
  productLine: productLineSchema.nullable(),
  insurer: z.string(),
  /** 상대 차량이면 보험 가입 상태. 내 보험이면 "full"로 둔다 */
  status: insuranceStatusSchema,
  coverages: z.array(policyCoverageSchema),
  driverScope: z.enum(DRIVER_SCOPES).nullable(),
  /** 자기차량손해 자기부담금 */
  deductible: deductibleSchema.nullable(),
  /** 대인배상Ⅱ 가입 여부. 모르면 null */
  hasBodily2: z.boolean().nullable(),
  // 라운드 9: 증권에서 읽는 칸(모두 선택. 예전 저장값도 그대로 읽힌다)
  /** 보험기간 시작·끝(YYYY-MM-DD) */
  periodStart: dateSchema.nullable().optional(),
  periodEnd: dateSchema.nullable().optional(),
  /** 운전자 연령 한정특약(증권 표기 그대로. 예: "만 26세 이상") */
  ageLimit: z.string().nullable().optional(),
  /** 차종·연식(증권 표기 그대로) */
  vehicleModel: z.string().nullable().optional(),
  vehicleYear: z.number().int().min(1950).max(2100).nullable().optional(),
  /** 차량가액(차량가입금액). 내 차의 사고 직전 가액으로 쓴다 */
  vehicleValue: moneySchema.nullable().optional(),
})
  // 자동차상해 특별약관은 보통약관 「자기신체사고」를 대체하므로 둘 중 하나만 가입한다(자동차상해 특별약관 머리말·1., 개인용 인쇄 119쪽)
  .refine((policy) => !(policy.coverages.some((c) => c.coverage === "auto_injury") && policy.coverages.some((c) => c.coverage === "self_injury")), {
    message: "자동차상해와 자기신체사고는 둘 중 하나만 가입할 수 있습니다",
    path: ["coverages"],
  });
export type Policy = z.infer<typeof policySchema>;

// ── 손해 항목 ──
/** 확정 금액은 서류, 추정 금액은 약관 기준·사용자 추정·앱 기본값 중 하나에서 온다 */
export const ESTIMATE_SOURCES = ["policy_standard", "user_estimate", "app_default"] as const;
export const LOSS_SOURCE_LABELS = { document: "서류", policy_standard: "지급기준", user_estimate: "사용자 추정", app_default: "앱 기본값" } as const;

export const lossItemSchema = z
  .object({
    /** lib/claim/lossItems.ts의 항목 코드 */
    code: z.string().min(1),
    /** 서류로 확인한 금액(확정) */
    confirmed: moneySchema.nullable(),
    /** 확정 금액의 서류 근거(예: "진료비 세부내역서 2026-09-10") */
    evidence: z.string().nullable(),
    /** 대략 생각하는 금액(추정) */
    estimated: moneySchema.nullable(),
    source: z.object({ confirmed: z.literal("document").nullable(), estimated: z.enum(ESTIMATE_SOURCES).nullable() }),
    /** 필요 서류 id(lib/claim/lossItems.ts DOCUMENTS) */
    requiredDocs: z.array(z.string().min(1)),
  })
  .refine((item) => (item.confirmed === null) === (item.source.confirmed === null), { message: "확정 금액과 그 출처(서류)는 함께 있어야 합니다", path: ["source", "confirmed"] })
  .refine((item) => (item.estimated === null) === (item.source.estimated === null), { message: "추정 금액과 그 출처는 함께 있어야 합니다", path: ["source", "estimated"] });
export type LossItem = z.infer<typeof lossItemSchema>;

// ── 사람 카드 ──
export const VICTIM_ROLES = ["driver", "family_passenger", "other_passenger", "counterparty"] as const;
export const VICTIM_ROLE_LABELS: Record<(typeof VICTIM_ROLES)[number], string> = { driver: "피보험자(나)", family_passenger: "가족 동승자", other_passenger: "남 동승자", counterparty: "상대방" };
/** 기명피보험자와의 관계. 부모·배우자·자녀는 내 대인Ⅱ 면책(MASTER.md 6장 (1)) */
export const RELATIONS = ["self", "spouse", "parent", "child", "other_family", "none"] as const;

/**
 * 휴업손해의 수입감소액 기준(별표1 나. 부상 3. 휴업손해 다., 개인용 인쇄 77쪽)
 * employed: 유직자(현실소득액 기준) / homemaker: 가사종사자(일용근로자 임금) / unemployed: 무직자(수입 감소 없음)
 * no_income: 유아·연소자·학생·연금생활자·금리·임대료 생활자(수입 감소 없음)
 */
export const OCCUPATIONS = ["employed", "homemaker", "unemployed", "no_income"] as const;
export const OCCUPATION_LABELS: Record<(typeof OCCUPATIONS)[number], string> = {
  employed: "직장·사업 등 소득이 있음",
  homemaker: "가사종사자(전업주부 등)",
  unemployed: "무직",
  no_income: "유아·학생·연금생활자 등",
};

export const victimSchema = z.object({
  id: z.string().min(1),
  role: z.enum(VICTIM_ROLES),
  label: z.string(),
  relationToNamedInsured: z.enum(RELATIONS).nullable(),
  /** 자동차(이륜자동차 제외)의 운전자인지. 경상(12~14급) 구상에 쓴다(별표4 (*1)) */
  vehicleDriver: z.boolean().nullable(),
  age: z.number().int().min(0).max(120).nullable(),
  injuryGrade: gradeSchema.nullable(),
  disabilityGrade: gradeSchema.nullable(),
  died: z.boolean().nullable(),
  /** 호의동승 감액률. 자동 감액하지 않는다: 기본 0, 사용자가 고르면 적용하고 '검토 필요' 표시 */
  rideAlongReductionPercent: percentSchema,
  // 약관 기준 자동 산정에 쓰는 사실(별표1 나. 부상 3. 휴업손해·5. 그 밖의 손해배상금). 모르면 null
  hospitalDays: daysSchema.nullable(),
  outpatientDays: daysSchema.nullable(),
  /** 입원 중 병원 식사를 받지 않은 끼니 수(1끼 4,030원) */
  mealsNotProvided: z.number().int().min(0).max(109_500).nullable(),
  daysOffWork: daysSchema.nullable(),
  /** 월 현실소득액 */
  monthlyIncome: moneySchema.nullable(),
  /**
   * 소득과 수입 감소를 관계 서류(세법상 관계 서류 등)로 증명할 수 있는지. 휴업손해는 증명할 수 있을 때만 준다(별표1 나. 3. 가., 인쇄 76쪽).
   * true가 아니면(아니오·모름) 휴업손해 추정은 0원이고 증명했을 때의 금액은 참고로만 보여 준다(결정 기록 D-24)
   */
  incomeProven: z.boolean().nullable(),
  occupation: z.enum(OCCUPATIONS).nullable(),
  /**
   * 월소득 금액을 세법상 관계 서류로 증명할 수 있는지(유직자). false이면 일용근로자 임금으로 계산한다
   * (별표1 나. 3. 다.(1)(가)가 준용하는 가. 3. 나.(1) 2), 인쇄 74쪽, 결정 기록 D-32). incomeProven은 수입 감소(휴업) 사실의 증명이다.
   */
  incomeAmountProven: z.boolean().nullable(),
  losses: z.array(lossItemSchema),
  /** 사용자가 직접 넣는 이 사람 손해 합계 추정 */
  userTotal: moneySchema.nullable(),
});
export type Victim = z.infer<typeof victimSchema>;

// ── 물건 카드 ──
export const PROPERTY_ROLES = ["my_vehicle", "counterparty_vehicle", "counterparty_property"] as const;
export const PROPERTY_ROLE_LABELS: Record<(typeof PROPERTY_ROLES)[number], string> = { my_vehicle: "내 차", counterparty_vehicle: "상대 차량", counterparty_property: "상대 물건" };

/** 차종 등급(라운드 9). 사고 직전 가액을 묻지 않고 등급·연식으로 추정한다(lib/claim/vehicleValue.ts) */
export const VEHICLE_CLASSES = ["light", "small", "mid", "large", "suv", "imported"] as const;
export const VEHICLE_CLASS_LABELS: Record<(typeof VEHICLE_CLASSES)[number], string> = { light: "경차", small: "소형", mid: "중형", large: "대형", suv: "SUV", imported: "수입차" };

export const propertySchema = z.object({
  id: z.string().min(1),
  role: z.enum(PROPERTY_ROLES),
  label: z.string(),
  /** 사고 직전 차량가액(전손·수리비 한도·시세하락에 쓴다) */
  valueAtAccident: moneySchema.nullable(),
  /** 출고일(시세하락손해에 쓴다) */
  firstRegisteredOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  commercialUse: z.boolean().nullable(),
  losses: z.array(lossItemSchema),
  userTotal: moneySchema.nullable(),
  // 라운드 9: 사고 직전 가액의 출처. policy = 증권의 차량가액, estimate = 차종 등급·연식으로 앱이 추정
  vehicleClass: z.enum(VEHICLE_CLASSES).nullable().optional(),
  modelYear: z.number().int().min(1950).max(2100).nullable().optional(),
  valueSource: z.enum(["policy", "estimate"]).nullable().optional(),
});
export type Property = z.infer<typeof propertySchema>;

// ── 과실 ──
/** 과실을 알면 내 과실비율, 모르면 0·30·50·70% 시나리오(MASTER.md 6장) */
export const faultSchema = z.union([z.object({ mode: z.literal("known"), myPercent: percentSchema }), z.object({ mode: z.literal("unknown") })]);

// ── 서류·증권 인식값(라운드 7, MASTER.md 9장) ──
// 인식값은 바로 입력칸에 들어가지 않는다. "인식된 값 – 확인해 주세요"로 보여 주고, 사용자가 고치거나 확인을 눌러야 들어간다.
// 개인정보는 서버에서 가린 뒤에만 여기에 온다. 원본 파일은 어디에도 저장하지 않는다.
// 라운드 8b: 금액은 서류마다 한 줄씩 쌓아 합계를 내고(issuer·docDate로 같은 서류를 가리고, excluded로 뺀다),
// 날수·소득은 더하지 않고 한 줄에 서류별 값(readings)을 모아 큰 값을 쓴다. 새 칸은 모두 선택이라 예전 저장값도 그대로 읽힌다.
// 라운드 8c: 서류별 값에 기간(periods, 날수)·급여 월(month, 월 소득)을 함께 두고, 모두 기간이 있으면 날짜로 합치고(겹치는 날 한 번),
// 월 소득은 사고일 직전 최근 3개월치 평균을 쓴다(lib/ui/recognize.ts mergeFact). formula는 화면에 보일 계산식.
const periodSchema = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export type Period = z.infer<typeof periodSchema>;
const factReadingSchema = z.object({
  source: z.string(),
  value: moneySchema,
  periods: z.array(periodSchema).nullable().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
  // 라운드 8d: 월 소득에서 뺀 세금(세전 − 소득세 − 지방소득세 = value). 세금 줄을 읽지 못했으면 null(세전 금액)
  tax: z.object({ gross: moneySchema, incomeTax: moneySchema, localIncomeTax: moneySchema }).nullable().optional(),
});
export type FactReading = z.infer<typeof factReadingSchema>;
export const FACT_FIELDS = ["hospitalDays", "outpatientDays", "daysOffWork", "monthlyIncome"] as const;
const recognitionBase = { id: z.string(), source: z.string(), note: z.string() };
export const recognitionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...recognitionBase,
    kind: z.literal("loss"),
    cardId: z.string(),
    code: z.string(),
    value: moneySchema,
    issuer: z.string().nullable().optional(),
    docDate: z.string().nullable().optional(),
    excluded: z.boolean().optional(),
  }),
  z.object({
    ...recognitionBase,
    kind: z.literal("fact"),
    cardId: z.string(),
    field: z.enum(FACT_FIELDS),
    value: moneySchema,
    readings: z.array(factReadingSchema).optional(),
    formula: z.string().optional(),
  }),
  z.object({ ...recognitionBase, kind: z.literal("insurer"), value: z.string() }),
  z.object({ ...recognitionBase, kind: z.literal("productLine"), value: productLineSchema }),
  z.object({ ...recognitionBase, kind: z.literal("driverScope"), value: z.enum(DRIVER_SCOPES) }),
  z.object({ ...recognitionBase, kind: z.literal("coverage"), value: policyCoverageSchema }),
  z.object({ ...recognitionBase, kind: z.literal("deductible"), value: deductibleSchema }),
  // 라운드 9: 보험기간, 연령 한정특약, 차종·연식·차량가액
  z.object({ ...recognitionBase, kind: z.literal("period"), value: z.object({ start: dateSchema, end: dateSchema }) }),
  z.object({ ...recognitionBase, kind: z.literal("ageLimit"), value: z.string() }),
  z.object({ ...recognitionBase, kind: z.literal("vehicle"), value: z.object({ model: z.string().nullable(), year: z.number().int().min(1950).max(2100).nullable(), value: moneySchema.nullable() }) }),
]);
export type Recognition = z.infer<typeof recognitionSchema>;

// ── 한 사고의 입력 전체(localStorage에 이 모양으로 저장한다) ──
export const claimSchema = z.object({
  accident: accidentSchema,
  myPolicy: policySchema,
  counterpartyPolicy: policySchema.nullable(),
  victims: z.array(victimSchema),
  properties: z.array(propertySchema),
  fault: faultSchema,
  /** "모르면 건너뛰기"로 건너뛴 칸. 검토서의 '입력 필요' 목록에 모은다 */
  skipped: z.array(z.string()),
  /** 확인을 기다리는 인식값 */
  recognized: z.array(recognitionSchema),
  /** 음성에서 옮긴 사고 경위(확인 전). 확인하면 accident.narrative에 들어간다 */
  pendingNarrative: z.string().nullable(),
  /** 라운드 9: 증권에서 읽어 확인한 칸(lib/ui/flow.ts POLICY_KEYS). 이 칸의 질문은 건너뛴다 */
  policyRead: z.array(z.string()).optional(),
});
export type Claim = z.infer<typeof claimSchema>;

export function emptyLossItem(code: string, requiredDocs: string[]): LossItem {
  return { code, confirmed: null, evidence: null, estimated: null, source: { confirmed: null, estimated: null }, requiredDocs };
}

export function emptyClaim(): Claim {
  const violations = { drunk: null, unlicensed: null, drugs: null, fledScene: null, outsideDriverScope: null, intentional: null, driverRelation: null };
  return {
    accident: { occurredAt: null, place: "", narrative: "", type: null, violations },
    myPolicy: { side: "mine", productLine: null, insurer: "", status: "full", coverages: [], driverScope: null, deductible: null, hasBodily2: null },
    counterpartyPolicy: null,
    victims: [],
    properties: [],
    fault: { mode: "unknown" },
    skipped: [],
    recognized: [],
    pendingNarrative: null,
    policyRead: [],
  };
}
