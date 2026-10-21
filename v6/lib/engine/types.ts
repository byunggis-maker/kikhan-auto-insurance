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
};

export type Run = { lines: RunLine[]; notes: RunNote[]; burdens: RunBurden[]; cards: RunCard[]; notices: string[]; blocked: string | null };

/** 확정액, 추정 포함액, 추정분(= 추정 포함액 − 확정액) */
export type Amounts = { confirmed: number; withEstimates: number; estimatePart: number };

export type ResultLine = Omit<RunLine, "amount" | "alternative"> & Amounts & { cardLabel: string; side: Side; alternative?: { label: string } & Amounts };
export type ResultNote = Omit<RunNote, "amount"> & Amounts;
export type ResultBurden = Omit<RunBurden, "amount"> & Amounts;
export type ResultCard = Omit<RunCard, "actualLoss"> & { actualLoss: Amounts; paid: Amounts; uncovered: Amounts };

export type Result = {
  faultPercent: number;
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
};
