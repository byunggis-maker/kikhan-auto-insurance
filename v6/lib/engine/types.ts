import type { Coverage, Payer } from "@/lib/claim/types";

// v6 계산 엔진의 결과 자료형. 금액은 원 단위 정수.
// 한 번 실행(Run)은 값 하나씩을 낸다. 확정/추정 이중 계산(dual-run.ts)이 두 번의 실행을 합쳐 Result를 만든다.

export type ValueMode = "confirmed" | "with_estimates";

/** mine: 나와 내 차에 탄 사람·내 차(받을 돈). counterparty: 상대방 사람·물건(내 보험이 상대방에게 줄 돈) */
export type Side = "mine" | "counterparty";

export type LineStatus = "paid" | "excluded" | "needs_input" | "not_implemented";

/** 사람·물건 카드 하나의 담보 한 줄 */
export type RunLine = {
  key: string;
  cardId: string;
  coverage: Coverage;
  label: string;
  payer: Payer;
  status: LineStatus;
  amount: number;
  formula: string;
  basis: string;
  flags: string[];
  /** 해석에 따라 금액이 달라질 때의 다른 값(예: 운전자 관계를 모를 때 면책인 경우) */
  alternative?: { label: string; amount: number };
};

/** 합계에 넣지 않는 안내 줄(경상 본인 부담분 등) */
export type RunNote = { key: string; cardId: string; label: string; amount: number; text: string; basis: string };

/** 내가 낼 돈(사고부담금, 한도 초과분, 면책으로 남는 배상책임) */
export type RunBurden = { key: string; label: string; amount: number; formula: string; basis: string };

/** 손해 항목 하나의 값과 그 출처·계산식(약관 기준 산정이면 근거 쪽 포함) */
export type LossDetail = { code: string; label: string; amount: number; source: string; formula: string };

export type RunCard = {
  cardId: string;
  label: string;
  kind: "person" | "property";
  side: Side;
  /** 이 사람·물건의 실제손해(별표 기준 손해액 합계, 과실상계 전) */
  actualLoss: number;
  /** 값이 없어 합계에 넣지 않은 항목 코드("입력 필요") */
  missing: string[];
  notes: string[];
  details: LossDetail[];
};

/** 계산에 쓴 약관 판. matched: 사고일에 시행 중인 판인지(아니면 최신 판으로 대신 계산) */
export type EditionUsed = { id: string; matched: boolean };

export type Run = { lines: RunLine[]; notes: RunNote[]; burdens: RunBurden[]; cards: RunCard[]; notices: string[]; blocked: string | null; edition: EditionUsed };

/** 확정액, 추정 포함액, 추정분(= 추정 포함액 − 확정액) */
export type Amounts = { confirmed: number; withEstimates: number; estimatePart: number };

export type ResultLine = Omit<RunLine, "amount" | "alternative"> & Amounts & { cardLabel: string; side: Side; alternative?: { label: string } & Amounts };
/** 합계에서 빠지는 안내 줄은 추정분을 비운다(라운드 2 결정 5) */
export type ResultNote = Omit<RunNote, "amount"> & { confirmed: number; withEstimates: number; estimatePart: null };
export type ResultBurden = Omit<RunBurden, "amount"> & Amounts;
export type ResultDetail = Omit<LossDetail, "amount"> & Amounts;
export type ResultCard = Omit<RunCard, "actualLoss" | "details"> & { actualLoss: Amounts; paid: Amounts; uncovered: Amounts; details: ResultDetail[] };

export type Result = {
  faultPercent: number;
  edition: EditionUsed;
  blocked: string | null;
  lines: ResultLine[];
  notes: ResultNote[];
  burdens: ResultBurden[];
  cards: ResultCard[];
  totals: {
    /** 확정 기준·추정 포함 받을 돈(내 쪽 카드) */
    receive: Amounts;
    /** 받을 곳별 합계(내 쪽 카드) */
    byPayer: Record<Payer, Amounts>;
    /** 내 보험이 상대방에게 줄 돈 */
    toCounterparty: Amounts;
    /** 내가 낼 돈 */
    burden: Amounts;
  };
  notices: string[];
  /**
   * 상대 차량의 대인배상Ⅱ 가입 여부를 모를 때 두 시나리오(라운드 2 결정 4). 위 lines·totals는 "있음" 시나리오다.
   * 가입 여부를 알면 null.
   */
  bodily2Scenarios: { withBodily2: Result; withoutBodily2: Result } | null;
};
