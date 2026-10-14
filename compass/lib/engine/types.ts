import type { RuleStatus } from "@/lib/schemas/rules";

// 사람 담보 계산 엔진이 주고받는 자료형. 금액은 모두 원 단위 정수다.

/** 최소·예상·최대 */
export type Range = { min: number; expected: number; max: number };
export type Scenario = keyof Range;
export const SCENARIOS: Scenario[] = ["min", "expected", "max"];

/** 부족한 입력 하나. message는 화면에 그대로 보여 줄 문장이다 */
export type MissingInfo = { field: string; message: string };

export type LossCategory = "injury" | "death" | "disability";
export const CATEGORIES: LossCategory[] = ["injury", "disability", "death"];
export type ByCategory = Record<LossCategory, number>;

/** 줄과 칸에 붙이는 표시와, 화면에 그대로 보여 줄 문구 */
export const NOTICES = {
  daily_wage_required: "일용근로자 임금 입력 필요",
  interpretation_varies: "해석에 따라 금액 차이 있음",
  rule_not_registered: "증권에 있으나 계산 규칙 미등록",
} as const;
export type Notice = keyof typeof NOTICES;

/** calculated: 계산됨, missing: 입력이 없음, needs_check: 규칙 값이 없음, not_applicable: 이 사람에게 해당 없음 */
export type LineStatus = "calculated" | "missing" | "needs_check" | "not_applicable";

/** 손해 장부의 한 줄. 사람마다 손해 항목을 한 번만 만든다 */
export type LossLine = {
  item: string;
  category: LossCategory;
  label: string;
  status: LineStatus;
  amount: Range | null;
  /** 검산할 수 있게 적은 식 또는 설명 */
  formula: string;
  ruleIds: string[];
  missing: MissingInfo[];
  /** 이 줄에 붙는 표시(NOTICES의 키) */
  flags: Notice[];
  /** true면 이 줄이 없을 때 담보를 계산하지 않는다(정보 부족) */
  required: boolean;
  /** 치료관계비(입원환자 식대 포함)인지 */
  medical: boolean;
  /** 과실상계 뒤에도 보장되는 항목(치료관계비·간병비)인지 */
  guaranteed: boolean;
};

export type Ledger = { lines: LossLine[] };

export type CoverageKey =
  | "liability_bodily_1"
  | "liability_bodily_2"
  | "uninsured"
  | "auto_injury"
  | "self_injury"
  | "liability_property"
  | "own_damage"
  | "rider_rental"
  | "rider_legal"
  /** 증권에 있으나 계산 규칙을 등록하지 않은 특약 */
  | "rider_other";

export type CellStatus = "calculated" | "insufficient_info" | "not_applicable" | "needs_check";

/** 칸의 항목별 내역 한 줄 */
export type CellLine = {
  kind: "loss" | "step";
  item: string;
  label: string;
  amount: Range | null;
  formula: string;
  ruleIds: string[];
  /** 이 줄에 붙는 표시(NOTICES의 키) */
  flags: Notice[];
};

/** 사람 × 담보 한 칸 */
export type CoverageCell = {
  coverage: CoverageKey;
  status: CellStatus;
  /** 최소·예상·최대. 계산하지 못했으면 null(0원이 아니다) */
  amount: Range | null;
  /** 항목별 내역 */
  lines: CellLine[];
  /** 근거 조항 */
  basis: string[];
  /** 부족 정보 */
  missing: MissingInfo[];
  ruleIds: string[];
  /** 쓴 규칙 가운데 "약관 확인 필요"인 것 */
  needsCheckRuleIds: string[];
  flags: string[];
  /** 해당 없음·정보 부족의 이유 */
  reason: string | null;
  /** 합계에 넣는 칸인지 */
  inTotal: boolean;
};

export type RuleRef = { id: string; status: RuleStatus; basis: string };

/** 담보 모듈의 계산 결과. 칸으로 만들기 전 단계다 */
export type Computation =
  | { ok: true; byCategory: Record<LossCategory, Range>; total: Range; steps: CellLine[]; ruleIds: string[]; flags: string[] }
  | { ok: false; status: "insufficient_info" | "needs_check"; missing: MissingInfo[]; ruleIds: string[]; reason: string };

export type RecipientGroup = "mine" | "others";

/** 행렬의 한 칸: 누구의(rowId) 어느 담보(columnId)인지가 붙은 칸 */
export type MatrixCell = CoverageCell & { rowId: string; columnId: string; group: RecipientGroup };

/** 사람 × 담보 행렬. 합계는 들어 있지 않다. 합계는 summarize()가 cells에서만 계산한다 */
export type Matrix = {
  accidentDate: string;
  productLine: string;
  /** 받는 사람(또는 차량 주인). mine: 나와 내 쪽, others: 상대방 쪽 */
  rows: { id: string; label: string; group: RecipientGroup }[];
  columns: { id: string; label: string; coverage: CoverageKey }[];
  cells: MatrixCell[];
};
