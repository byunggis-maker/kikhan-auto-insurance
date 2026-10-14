// 화면 골격 단계의 입력 초안 모양이다. 정식 스키마(증권·사고·사람 JSON)는 다음 단계에서 lib/schemas에 만든다.
// 숫자 칸은 "입력하지 않음"(null)과 "0으로 확인함"(0)을 구분한다.

export type ProductLine = "personal" | "business" | "commercial" | "motorcycle";

export type CoverageDraft = {
  id: string;
  name: string;
  joined: boolean;
  /** 증권에 적힌 표현 그대로. 원 단위 변환은 엔진이 한다. */
  limit: string;
  deductible: string;
  /** 자동 읽기가 읽지 못한 칸. 사용자가 채우면 표시가 사라진다. */
  unread?: ("name" | "limit" | "deductible")[];
};

export type PolicyDraft = {
  insurer: string;
  productName: string;
  productLine: ProductLine | "";
  periodStart: string;
  periodEnd: string;
  // 계약자·피보험자 이름, 주민등록번호, 생년월일, 성별, 증권번호, 차량번호 칸은 두지 않는다(v2).
  vehicleModel: string;
  driverScope: string;
  driverAgeLimit: string;
  riders: string[];
  /** 자동 읽기가 읽지 못한 칸의 이름. 비어 있는 동안 "확인 필요"로 표시한다. */
  unread: string[];
  /** 고른 파일의 이름만 기억한다. 파일 자체는 저장하지 않는다. */
  fileName: string | null;
  coverages: CoverageDraft[];
};

export type PersonRole = "driver" | "passenger" | "counterparty" | "pedestrian";

export type AccidentKind = "car_car" | "car_person" | "single" | "motorcycle" | "parked";

/** 말하는 사람과의 관계. 이름 대신 쓴다. */
export type PersonRelation = "self" | "family" | "passenger" | "counterparty" | "pedestrian";
/** 입원·통원 여부 */
export type PersonCare = "hospital" | "outpatient" | "both" | "none";
export type YesNo = "yes" | "no";

export type AccidentDraft = {
  date: string;
  time: string;
  place: string;
  kind: AccidentKind | "";
  text: string;
  /** 상대 차량의 보험. 모르면 "unknown" */
  counterpartyInsurance: CounterpartyInsurance | "";
  /** 상대 차량의 대인배상Ⅱ·대물배상 가입금액(들은 표현 그대로). 원 단위 변환은 엔진이 한다 */
  counterpartyBodily2Limit: string;
  counterpartyPropertyLimit: string;
  /** 사실 추출이 짐작해서 채운 칸의 이름. 사용자가 확인하거나 고치면 빠진다. */
  inferred: string[];
  /** 내 차를 운전한 사람(관계로만: 본인, 아내 등) */
  myDriver: string;
  counterpartyExists: YesNo | "";
  /** 과실에 관한 진술(말한 그대로) */
  faultStatement: string;
  policeReport: YesNo | "";
  insuranceReport: YesNo | "";
  /** 말·글에서 인식해 채운 칸의 이름("음성에서 인식됨"). 사용자가 고치면 빠진다. vehicleDamage는 차량 피해 칸이다. */
  heard: string[];
  /** 사실 추출을 한 번이라도 했는지. 했으면 비어 있는 칸에 "확인 필요"를 붙인다. */
  extracted: boolean;
};

export type CounterpartyInsurance = "full" | "mandatory_only" | "none" | "hit_and_run" | "unknown";

export type VehicleClass = "small" | "mid" | "large" | "xlarge" | "multi";

export type VehicleDraft = {
  damage: string;
  repairCost: number | null;
  rentalDays: number | null;
  /** 실제로 렌트를 했는지 */
  rented: boolean | null;
  /** 같은 급 차량의 1일 렌트 요금 */
  rentalDailyRate: number | null;
  /** 사고 직전 차량가액 */
  valueAtAccident: number | null;
  /** 출고일(최초 등록일) */
  firstRegisteredOn: string;
  /** 렌트비용 특약의 차종 구분 */
  vehicleClass: VehicleClass | "";
};

export type PersonDraft = {
  id: string;
  role: PersonRole;
  relation: PersonRelation | "";
  // 이름 칸은 두지 않는다. 화면 제목은 역할 이름("운전자(나)", "동승자 1")이다.
  /** 다친 내용(말한 그대로) */
  injury: string;
  diagnosis: string;
  /** 사용자가 고른 상해급수(1~14). 후보를 보고 사용자가 정한다. */
  injuryGrade: number | null;
  /** 사실 추출이 짐작해서 채운 칸의 이름. 사용자가 확인하거나 고치면 빠진다. */
  inferred: string[];
  surgery: boolean | null;
  care: PersonCare | "";
  /** 말·글에서 인식해 채운 칸의 이름("음성에서 인식됨"). 비어 있지 않으면 사실 추출로 만든 카드다. */
  heard: string[];
  hospitalDays: number | null;
  outpatientDays: number | null;
  /** 실제 치료비 */
  treatmentCost: number | null;
  /** 일을 쉰 날수 */
  daysOffWork: number | null;
  /** 사고일의 만 나이. 생년월일은 받지 않는다. */
  age: number | null;
  /** 후유장애 판정을 받았을 때만: 노동능력상실률(%)과 후유장애 급수(1~14). 없으면 null */
  disabilityPercent: number | null;
  disabilityGrade: number | null;
  /** 사망했을 때만: 사망일. 아니면 빈 문자열 */
  deathDate: string;
  occupation: string;
  monthlyIncome: number | null;
  faultPercent: number | null;
};

export type CaseDraft = {
  id: string;
  createdAt: string;
  updatedAt: string;
  policy: PolicyDraft;
  accident: AccidentDraft;
  people: PersonDraft[];
  vehicle: VehicleDraft;
};

export const ROLE_LABELS: Record<PersonRole, string> = {
  driver: "운전자",
  passenger: "동승자",
  counterparty: "상대방",
  pedestrian: "보행자",
};

export const PRODUCT_LINE_LABELS: Record<ProductLine, string> = {
  personal: "개인용 자동차보험",
  business: "업무용 자동차보험",
  commercial: "영업용 자동차보험",
  motorcycle: "이륜자동차보험",
};

export const ACCIDENT_KIND_LABELS: Record<AccidentKind, string> = {
  car_car: "차 대 차",
  car_person: "차 대 사람",
  single: "단독사고",
  motorcycle: "이륜차",
  parked: "주차 중",
};

export const RELATION_LABELS: Record<PersonRelation, string> = {
  self: "본인",
  family: "가족",
  passenger: "동승자",
  counterparty: "상대방",
  pedestrian: "보행자",
};

export const CARE_LABELS: Record<PersonCare, string> = {
  hospital: "입원",
  outpatient: "통원",
  both: "입원·통원",
  none: "치료 안 받음",
};

export const COUNTERPARTY_INSURANCE_LABELS: Record<CounterpartyInsurance, string> = {
  full: "종합보험(대인Ⅱ까지)",
  mandatory_only: "책임보험만",
  none: "보험 없음",
  hit_and_run: "뺑소니",
  unknown: "모름",
};

export const VEHICLE_CLASS_LABELS: Record<VehicleClass, string> = {
  small: "소형 (1,600cc 이하)",
  mid: "중형 (2,000cc 이하)",
  large: "대형 (2,800cc 이하)",
  xlarge: "대형 (2,800cc 초과)",
  multi: "다인승 (7~10인)",
};
