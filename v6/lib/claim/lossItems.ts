import type { Coverage } from "./types";

// 담보별 손해 항목, 항목별 필요 서류, 약관 별표 번호를 모은 유일한 파일(MASTER.md 4·7·8장).
// 근거 쪽 번호는 현대해상 Hicar 개인용자동차보험 약관(data/raw/policies/개인용 약관.pdf)에 인쇄된 쪽이다.
// 업무용·영업용·이륜차는 쪽 번호가 다르므로 화면에는 별표 번호와 항목 번호를 먼저 보여 준다.

export type Basis = {
  /** 예: "별표1", "별표2", "제24조" */
  ref: string;
  /** 별표 안의 항목 위치. 예: "나. 부상 1. 적극손해 나. 치료관계비" */
  clause: string;
  /** 개인용 약관에 인쇄된 쪽 */
  page: number;
};

// ── 필요 서류 ──
// 약관 제27조(제출 서류, 개인용 인쇄 58쪽)의 호와, 그 호 안에서 앱이 예로 드는 서류를 나눠 적는다.
// clause27: 제27조의 호. example: true면 "손해액을 증명하는 서류(진단서 등)"처럼 약관이 묶어 적은 것을 앱이 풀어 쓴 예다.
export type DocumentDef = { id: string; label: string; clause27: number; example: boolean };

export const DOCUMENTS = {
  claim_form: { id: "claim_form", label: "보험금 청구서", clause27: 1, example: false },
  loss_proof: { id: "loss_proof", label: "손해액을 증명하는 서류(진단서 등)", clause27: 2, example: false },
  diagnosis: { id: "diagnosis", label: "진단서(상해 급수 확인)", clause27: 2, example: true },
  medical_bills: { id: "medical_bills", label: "진료비 영수증·진료비 세부내역서", clause27: 2, example: true },
  future_treatment_opinion: { id: "future_treatment_opinion", label: "향후치료비 추정서(주치의 소견)", clause27: 2, example: true },
  nursing_opinion: { id: "nursing_opinion", label: "간병이 필요하다는 의사 소견", clause27: 2, example: true },
  income_proof: { id: "income_proof", label: "소득을 증명하는 세법상 관계증빙서(원천징수영수증 등)", clause27: 2, example: true },
  leave_proof: { id: "leave_proof", label: "휴업(결근)과 수입 감소를 증명하는 서류", clause27: 2, example: true },
  disability_diagnosis: { id: "disability_diagnosis", label: "후유장애진단서(노동능력상실률)", clause27: 2, example: true },
  death_certificate: { id: "death_certificate", label: "사망진단서(시체검안서)", clause27: 2, example: true },
  family_relation: { id: "family_relation", label: "가족관계증명서(청구권자 확인)", clause27: 2, example: true },
  repair_estimate: { id: "repair_estimate", label: "수리비 견적서·수리비 영수증", clause27: 2, example: true },
  vehicle_value: { id: "vehicle_value", label: "사고 직전 차량가액을 알 수 있는 자료", clause27: 2, example: true },
  rental_receipt: { id: "rental_receipt", label: "대차(렌트) 계약서·영수증", clause27: 2, example: true },
  idle_proof: { id: "idle_proof", label: "사업용 자동차 휴차 기간·수입 증빙", clause27: 2, example: true },
  business_loss_proof: { id: "business_loss_proof", label: "영업손실을 증명하는 세법상 관계증빙서", clause27: 2, example: true },
  registration: { id: "registration", label: "자동차등록증(출고일 확인)", clause27: 2, example: true },
  towing_receipt: { id: "towing_receipt", label: "견인비 영수증", clause27: 2, example: true },
  rescue_receipt: { id: "rescue_receipt", label: "구조수색비 영수증", clause27: 2, example: true },
  settlement_proof: { id: "settlement_proof", label: "손해배상의 이행사실을 증명하는 서류", clause27: 3, example: false },
  police_report: { id: "police_report", label: "교통사고사실확인원(관할 경찰관서)", clause27: 4, example: false },
  liable_identity: { id: "liable_identity", label: "배상의무자의 주소·성명(명칭)·차량번호", clause27: 5, example: false },
  liable_bodily2: { id: "liable_bodily2", label: "배상의무자의 대인배상Ⅱ 또는 공제계약 유무와 내용", clause27: 6, example: false },
  already_received: { id: "already_received", label: "이미 받은 손해배상금(대인배상Ⅱ·공제·배상의무자·제3자)", clause27: 7, example: false },
  theft_deregistration: { id: "theft_deregistration", label: "도난 전손 시 말소 사실증명서", clause27: 8, example: false },
  total_loss_transfer: { id: "total_loss_transfer", label: "전손 후 이전매각 시 이전서류", clause27: 8, example: false },
  total_loss_scrap: { id: "total_loss_scrap", label: "전손 후 폐차 시 폐차인수증명서", clause27: 8, example: false },
  insurer_request: { id: "insurer_request", label: "보험회사가 꼭 필요하여 요청하는 서류(수리 전 점검·정비견적서, 사진 등)", clause27: 9, example: false },
} as const satisfies Record<string, DocumentDef>;

export type DocumentId = keyof typeof DOCUMENTS;

/**
 * 제27조 표의 담보별 공통 서류(개인용 인쇄 58쪽). 표의 열은 대인배상·대물배상·자기차량손해·자기신체사고·무보험자동차에 의한 상해다.
 * 대인배상Ⅰ·Ⅱ는 "대인배상" 열을 쓴다. 자동차상해 특별약관은 표에 열이 없고 "정하지 않은 사항은 보통약관에 따른다"(특약 5. 준용규정)이므로
 * 자기신체사고 열을 따른다. 전손 서류(8호)는 전손일 때만 손해 항목(replacement_value·own_total_loss)에 붙인다.
 */
export const COVERAGE_DOCUMENTS: Record<Coverage, DocumentId[]> = {
  liability_bodily_1: ["claim_form", "loss_proof", "settlement_proof", "insurer_request"],
  liability_bodily_2: ["claim_form", "loss_proof", "settlement_proof", "insurer_request"],
  liability_property: ["claim_form", "loss_proof", "settlement_proof", "insurer_request"],
  own_damage: ["claim_form", "loss_proof", "police_report", "insurer_request"],
  self_injury: ["claim_form", "loss_proof", "insurer_request"],
  auto_injury: ["claim_form", "loss_proof", "insurer_request"],
  uninsured: ["claim_form", "loss_proof", "police_report", "liable_identity", "liable_bodily2", "already_received", "insurer_request"],
};

// ── 손해 항목 ──
export type LossTarget = "person" | "property";
export type LossCategory = "injury" | "disability" | "death" | "property";

export type LossItemDef = {
  code: string;
  label: string;
  /** 카드에 보여 줄 한 줄 설명 */
  description: string;
  target: LossTarget;
  category: LossCategory;
  /** 이 항목을 보상할 수 있는 담보. 6단계 청구란은 가입담보와 겹치는 항목만 보인다 */
  coverages: Coverage[];
  basis: Basis;
  requiredDocs: DocumentId[];
  /** 치료관계비(입원환자 식대 포함)인지. 경상 구상에 쓴다(별표4 1.가.(3)) */
  medical: boolean;
  /** 과실상계 뒤에도 보장되는 항목(치료관계비·간병비)인지(별표4 1.가.(2)·(3)) */
  guaranteed: boolean;
};

/** 대인배상·무보험자동차상해는 별표1로 산정한다. 자동차상해 특약도 실제손해액을 별표1 기준으로 산정한다 */
const BODILY: Coverage[] = ["liability_bodily_1", "liability_bodily_2", "uninsured", "auto_injury"];
/** 자기신체사고 부상은 별표3 급별 한도 안에서 실제 치료비를 준다. 사망·후유장애는 가입금액 기준이라 손해 항목이 따로 없다 */
const BODILY_AND_SELF: Coverage[] = [...BODILY, "self_injury"];

const person = (def: Omit<LossItemDef, "target" | "medical" | "guaranteed"> & Partial<Pick<LossItemDef, "medical" | "guaranteed">>): LossItemDef => ({
  target: "person",
  medical: false,
  guaranteed: false,
  ...def,
});
const property = (def: Omit<LossItemDef, "target" | "category" | "medical" | "guaranteed">): LossItemDef => ({ target: "property", category: "property", medical: false, guaranteed: false, ...def });

export const LOSS_ITEMS: LossItemDef[] = [
  // 별표1 나. 부상 (인쇄 75~78쪽)
  person({
    code: "rescue_cost",
    label: "구조수색비",
    description: "사고 현장에서 구조·수색에 든 실비",
    category: "injury",
    coverages: BODILY,
    basis: { ref: "별표1", clause: "나. 부상 1. 적극손해 가. 구조수색비", page: 75 },
    requiredDocs: ["rescue_receipt"],
  }),
  person({
    code: "treatment",
    label: "치료관계비",
    description: "진료비·입원료·수술비 등 치료에 든 비용(입원환자 식대 포함)",
    category: "injury",
    coverages: BODILY_AND_SELF,
    basis: { ref: "별표1", clause: "나. 부상 1. 적극손해 나. 치료관계비", page: 75 },
    requiredDocs: ["diagnosis", "medical_bills"],
    medical: true,
    guaranteed: true,
  }),
  person({
    code: "future_treatment",
    label: "향후치료비",
    description: "장래 치료에 필요하다고 객관적으로 인정되는 비용(상해 1~11급만)",
    category: "injury",
    coverages: BODILY,
    basis: { ref: "별표1", clause: "나. 부상 1. 적극손해 다. 향후치료비", page: 76 },
    requiredDocs: ["diagnosis", "future_treatment_opinion"],
  }),
  person({
    code: "solatium_injury",
    label: "부상 위자료",
    description: "상해 급수별로 정해진 위자료",
    category: "injury",
    coverages: BODILY,
    basis: { ref: "별표1", clause: "나. 부상 2. 위자료", page: 76 },
    requiredDocs: ["diagnosis"],
  }),
  person({
    code: "lost_income",
    label: "휴업손해",
    description: "다쳐서 일하지 못한 기간의 수입 감소액의 85%",
    category: "injury",
    coverages: BODILY,
    basis: { ref: "별표1", clause: "나. 부상 3. 휴업손해", page: 76 },
    requiredDocs: ["income_proof", "leave_proof"],
  }),
  person({
    code: "nursing",
    label: "간병비",
    description: "의사가 간병이 필요하다고 한 기간의 간병비",
    category: "injury",
    coverages: BODILY,
    basis: { ref: "별표1", clause: "나. 부상 4. 간병비", page: 77 },
    requiredDocs: ["nursing_opinion"],
    guaranteed: true,
  }),
  person({
    code: "other_injury",
    label: "그 밖의 손해배상금",
    description: "입원 중 병원 식사를 받지 않은 끼니(1끼 4,030원), 통원 1일 8,000원",
    category: "injury",
    coverages: BODILY,
    basis: { ref: "별표1", clause: "나. 부상 5. 그 밖의 손해배상금", page: 78 },
    requiredDocs: ["medical_bills"],
  }),
  // 별표1 다. 후유장애 (인쇄 78~79쪽)
  person({
    code: "solatium_disability",
    label: "후유장애 위자료",
    description: "노동능력상실률과 나이에 따른 위자료",
    category: "disability",
    coverages: BODILY,
    basis: { ref: "별표1", clause: "다. 후유장애 1. 위자료", page: 78 },
    requiredDocs: ["disability_diagnosis"],
  }),
  person({
    code: "lost_earnings_disability",
    label: "후유장애 상실수익액",
    description: "장애로 줄어드는 장래 소득(현실소득 × 노동능력상실률 × 호프만계수)",
    category: "disability",
    coverages: BODILY,
    basis: { ref: "별표1", clause: "다. 후유장애 2. 상실수익액", page: 78 },
    requiredDocs: ["disability_diagnosis", "income_proof"],
  }),
  person({
    code: "home_nursing",
    label: "가정간호비",
    description: "치료가 끝난 뒤에도 남의 도움이 필요한 중증 장애의 간호비",
    category: "disability",
    coverages: BODILY,
    basis: { ref: "별표1", clause: "다. 후유장애 3. 가정간호비", page: 79 },
    requiredDocs: ["disability_diagnosis", "nursing_opinion"],
  }),
  // 별표1 가. 사망 (인쇄 72~75쪽)
  person({
    code: "funeral",
    label: "장례비",
    description: "정액 5,000,000원",
    category: "death",
    coverages: BODILY,
    basis: { ref: "별표1", clause: "가. 사망 1. 장례비", page: 72 },
    requiredDocs: ["death_certificate", "family_relation"],
  }),
  person({
    code: "solatium_death",
    label: "사망 위자료",
    description: "사망자 본인과 유족의 위자료(나이에 따라 정액)",
    category: "death",
    coverages: BODILY,
    basis: { ref: "별표1", clause: "가. 사망 2. 위자료", page: 72 },
    requiredDocs: ["death_certificate", "family_relation"],
  }),
  person({
    code: "lost_earnings_death",
    label: "사망 상실수익액",
    description: "살았다면 벌었을 소득에서 생활비 1/3을 뺀 금액(호프만계수)",
    category: "death",
    coverages: BODILY,
    basis: { ref: "별표1", clause: "가. 사망 3. 상실수익액", page: 72 },
    requiredDocs: ["death_certificate", "family_relation", "income_proof"],
  }),
  // 별표2 대물배상 (인쇄 80~81쪽)
  property({
    code: "repair",
    label: "수리비",
    description: "원상회복이 가능해 수리하는 비용",
    coverages: ["liability_property"],
    basis: { ref: "별표2", clause: "1. 수리비용", page: 80 },
    requiredDocs: ["repair_estimate", "vehicle_value"],
  }),
  property({
    code: "replacement_value",
    label: "교환가액(전손)",
    description: "수리비가 사고 직전 가액을 넘거나 원상회복이 불가능할 때 사고 직전 가액",
    coverages: ["liability_property"],
    basis: { ref: "별표2", clause: "2. 교환가액", page: 80 },
    requiredDocs: ["vehicle_value", "total_loss_transfer", "total_loss_scrap"],
  }),
  property({
    code: "rental",
    label: "대차료(렌트)",
    description: "비사업용 차를 고치는 동안 동급 차를 빌린 비용",
    coverages: ["liability_property"],
    basis: { ref: "별표2", clause: "3. 대차료", page: 80 },
    requiredDocs: ["rental_receipt"],
  }),
  property({
    code: "idle",
    label: "휴차료",
    description: "사업용 차를 쓰지 못한 기간의 영업손해",
    coverages: ["liability_property"],
    basis: { ref: "별표2", clause: "4. 휴차료", page: 81 },
    requiredDocs: ["idle_proof"],
  }),
  property({
    code: "business_loss",
    label: "영업손실",
    description: "사업장·시설물이 부서져 휴업한 동안 잃은 이익(30일 한도)",
    coverages: ["liability_property"],
    basis: { ref: "별표2", clause: "5. 영업손실", page: 81 },
    requiredDocs: ["business_loss_proof"],
  }),
  property({
    code: "depreciation",
    label: "자동차시세하락손해",
    description: "출고 5년 이하 차의 수리비가 차량가액의 20%를 넘을 때 수리비의 10~20%",
    coverages: ["liability_property"],
    basis: { ref: "별표2", clause: "6. 자동차시세하락손해", page: 81 },
    requiredDocs: ["repair_estimate", "vehicle_value", "registration"],
  }),
  property({
    code: "towing",
    label: "견인비",
    description: "스스로 움직일 수 없는 차를 정비공장까지 옮긴 비용",
    coverages: ["liability_property"],
    basis: { ref: "별표2", clause: "7. 견인비용", page: 81 },
    requiredDocs: ["towing_receipt"],
  }),
  // 자기차량손해 (보통약관 제21조·제24조, 인쇄 53·55쪽)
  property({
    code: "own_repair",
    label: "내 차 수리비",
    description: "내 차에 생긴 손해(수리비). 자기부담금을 빼고 받는다",
    coverages: ["own_damage"],
    basis: { ref: "제24조", clause: "① 지급보험금 = 손해액 + 비용 − 자기부담금", page: 55 },
    requiredDocs: ["repair_estimate"],
  }),
  property({
    code: "own_total_loss",
    label: "내 차 전손",
    description: "고칠 수 없거나 수리비가 차량가액을 넘을 때 사고 직전 차량가액",
    coverages: ["own_damage"],
    basis: { ref: "제24조", clause: "① 지급보험금 = 손해액 + 비용 − 자기부담금", page: 55 },
    requiredDocs: ["vehicle_value", "theft_deregistration", "total_loss_transfer", "total_loss_scrap"],
  }),
];

const BY_CODE = new Map(LOSS_ITEMS.map((item) => [item.code, item]));

export function lossItemDef(code: string): LossItemDef | undefined {
  return BY_CODE.get(code);
}

/** 6단계 청구란: 이 카드(사람·물건)에 보일 항목. 가입담보와 겹치는 항목만 */
export function itemsFor(target: LossTarget, coverages: Coverage[]): LossItemDef[] {
  return LOSS_ITEMS.filter((item) => item.target === target && item.coverages.some((coverage) => coverages.includes(coverage)));
}

/** 항목 하나의 필요 서류: 항목 서류 + 그 항목을 보상할 수 있는 가입담보의 공통 서류(중복 제거) */
export function documentsFor(code: string, coverages: Coverage[]): DocumentId[] {
  const def = lossItemDef(code);
  if (!def) return [];
  const common = def.coverages.filter((coverage) => coverages.includes(coverage)).flatMap((coverage) => COVERAGE_DOCUMENTS[coverage]);
  return [...new Set<DocumentId>([...def.requiredDocs, ...common])];
}

/** 손해 항목이 아닌 계산 기준의 근거. 화면의 계산식 옆에 그대로 보여 준다 */
export const STANDARD_BASIS = {
  deathMinimum: "자동차손해배상보장법 시행령 제3조①1호 단서 + 약관 별표4 1. 과실상계 가.(2)",
  medicalFloor: "약관 별표4 1. 과실상계 가.(2)·(3)",
  minorInjuryRecourse: "약관 별표4 1. 과실상계 가.(3) 단서",
  compulsoryBodilyByGovernment: "자동차손해배상보장법 제30조(자동차손해배상 보장사업)",
} as const;
