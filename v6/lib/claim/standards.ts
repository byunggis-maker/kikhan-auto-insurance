import type { RuleItem } from "@/lib/engine/legacy/schemas/rules";
import { STANDARDS_EDITION } from "./editions";

// 계산에 쓰는 금액 기준과 그 근거를 모으는 유일한 파일(MASTER.md 3장).
// 쪽 번호는 data/raw/policies/ 약관 PDF에 인쇄된 쪽이다(개인용 기준, 다른 종류는 따로 적는다).
// ASSUMPTIONS는 약관과 다르게 가정한 값이다. 보고서에 반드시 적는다.

export type Basis = { source: string; page: number | null };

/**
 * 이 파일의 숫자를 읽은 약관 판. data/raw/policies/ 네 PDF 모두 표지에 "개정 2026.10.25"가 인쇄돼 있다(본문·메타데이터에는 개정일 없음).
 * - 개인용(하이카 개인용자동차보험) sha256 67dc9455…: compass가 대조한 "2025-11-26 개정" 개인용 PDF(sha256 47258f58…)와 다른 파일이다.
 * - 업무용 cbb1da8d…, 영업용 f313c520…, 이륜차 4b40b1fc…: compass와 같은 파일(compass는 개정일을 "표지 1025"로만 적었다).
 * 시행일은 PDF에 따로 적혀 있지 않아 개정일과 같다고 본다. 사고일이 이 날짜보다 앞이면 사고 당시 판과 대조가 필요하다(엔진이 안내를 붙인다).
 */
export const POLICY_EDITION = STANDARDS_EDITION;
/** 사고일을 모르거나 판보다 앞이면 이 날짜의 규칙으로 계산한다 */
export const STANDARDS_AS_OF = POLICY_EDITION;

// ── 대인배상Ⅰ(책임보험) 한도: 자동차손해배상보장법 시행령 제3조, [별표 1]·[별표 2] ──
const INJURY_LIMITS: Record<number, number> = {
  1: 30_000_000, 2: 15_000_000, 3: 12_000_000, 4: 10_000_000, 5: 9_000_000, 6: 7_000_000, 7: 5_000_000,
  8: 3_000_000, 9: 2_400_000, 10: 2_000_000, 11: 1_600_000, 12: 1_200_000, 13: 800_000, 14: 500_000,
};
const DISABILITY_LIMITS: Record<number, number> = {
  1: 150_000_000, 2: 135_000_000, 3: 120_000_000, 4: 105_000_000, 5: 90_000_000, 6: 75_000_000, 7: 60_000_000,
  8: 45_000_000, 9: 38_000_000, 10: 27_000_000, 11: 23_000_000, 12: 19_000_000, 13: 15_000_000, 14: 10_000_000,
};

export const COMPULSORY = {
  injuryLimits: { value: INJURY_LIMITS, basis: { source: "자동차손해배상보장법 시행령 [별표 1] 상해 구분별 한도금액(약관 <붙임>)", page: 84 } },
  disabilityLimits: { value: DISABILITY_LIMITS, basis: { source: "자동차손해배상보장법 시행령 [별표 2] 후유장애 구분별 한도금액(약관 <붙임>)", page: 93 } },
  deathLimit: { value: 150_000_000, basis: { source: "자동차손해배상보장법 시행령 제3조①1호(약관 안내: 대인배상Ⅰ 최대 1억 5천만원)", page: 9 } },
  deathMinimum: { value: 20_000_000, basis: { source: "자동차손해배상보장법 시행령 제3조①1호 단서 + 약관 별표4 1. 과실상계 가.(2)", page: 82 } },
  /** 대물배상 의무가입금액 */
  propertyLimit: { value: 20_000_000, basis: { source: "자동차손해배상보장법 제5조②·시행령 제3조③(약관 안내: 대물배상 2천만원 의무보험)", page: 22 } },
} as const;

// ── 사고부담금: 보통약관 제11조(음주운전, 무면허운전, 마약·약물운전 또는 사고발생시의 조치의무 위반) ──
// 네 약관(2026-10-25 개정판, POLICY_EDITION)이 같은 금액이다: 개인용 인쇄 50쪽, 업무용·영업용·이륜차 인쇄 10–11쪽.
// 2026-10-25 이전 사고(예: 2026-09-01)에 적용되던 판의 PDF는 프로젝트에 없어 대조하지 못했다.
export const ACCIDENT_BURDEN = {
  /** 대인배상Ⅰ: 「대인배상Ⅰ」 한도 내 지급보험금(전액) */
  bodily1: "paid_within_limit" as const,
  /** 대인배상Ⅱ: 1사고당 1억원 */
  bodily2PerAccident: 100_000_000,
  /** 대물배상: 의무가입금액(2천만원) 이하 손해는 지급보험금, 초과 손해는 1사고당 5천만원 */
  propertyMandatoryPart: "paid_up_to_mandatory" as const,
  propertyOverMandatoryPerAccident: 50_000_000,
  basis: {
    source: "보통약관 제11조① 1~3호(개인용 인쇄 50쪽 / 업무용·영업용·이륜차 인쇄 10–11쪽)",
    page: 50,
  } satisfies Basis,
};

// ── 별표1 정액 기준 ──
/** 부상 위자료(만원 단위 표를 원으로). 별표1 나. 부상 2. 위자료, 인쇄 76쪽 */
export const INJURY_SOLATIUM = {
  value: { 1: 2_000_000, 2: 1_760_000, 3: 1_520_000, 4: 1_280_000, 5: 750_000, 6: 500_000, 7: 400_000, 8: 300_000, 9: 250_000, 10: 200_000, 11: 200_000, 12: 150_000, 13: 150_000, 14: 150_000 } as Record<number, number>,
  basis: { source: "별표1 나. 부상 2. 위자료", page: 76 } satisfies Basis,
};
/** 장례비 정액. 별표1 가. 사망 1. 장례비, 인쇄 72쪽 */
export const FUNERAL = { value: 5_000_000, basis: { source: "별표1 가. 사망 1. 장례비", page: 72 } satisfies Basis };
/** 휴업손해: 1일 수입감소액 × 휴업일수 × 85/100. 별표1 나. 부상 3. 휴업손해 가. 산정방법, 인쇄 76쪽 */
export const LOST_INCOME = { ratePercent: 85, basis: { source: "별표1 나. 부상 3. 휴업손해", page: 76 } satisfies Basis };
/**
 * 휴업손해 직업 구분(별표1 나. 3. 다., 인쇄 77쪽): 가사종사자는 일용근로자 임금, 무직자·유아·학생·연금생활자 등은 수입 감소 없음.
 * 일용근로자 임금은 약관에 금액이 없다(통계작성지정기관이 공표한 노임 — 별표1 가. 3. 용어풀이 ②, 인쇄 73쪽). 값과 출처를 사람이 넣기 전까지 null.
 */
export const DAILY_WAGE = { value: null as number | null, basis: { source: "별표1 가. 사망 3. 상실수익액 용어풀이 ②(일용근로자 임금의 정의)", page: 73 } satisfies Basis };
export const NO_LOSS_OCCUPATIONS = { basis: { source: "별표1 나. 부상 3. 휴업손해 다.(3)", page: 77 } satisfies Basis };
export const HOMEMAKER = { basis: { source: "별표1 나. 부상 3. 휴업손해 다.(2)", page: 77 } satisfies Basis };

/** 그 밖의 손해배상금: 입원 중 병원 식사를 받지 않은 끼니 1끼 4,030원, 통원 1일 8,000원. 별표1 나. 부상 5., 인쇄 78쪽 */
export const OTHER_INJURY = { perMeal: 4_030, perOutpatientDay: 8_000, basis: { source: "별표1 나. 부상 5. 그 밖의 손해배상금", page: 78 } satisfies Basis };

// ── 자기신체사고: 보통약관 제15조·제16조, 별표3(인쇄 51–52·82쪽) ──
// 부상: 가입금액(1,500만·3,000만·5,000만원)별 상해급수 한도. 후유장애: 가입금액(1,500만·3,000만·5,000만·1억원)별 장애급수 보험금액.
const man = (values: number[]) => Object.fromEntries(values.map((v, i) => [i + 1, v * 10_000])) as Record<number, number>;
export const SELF_INJURY = {
  injuryLimits: {
    15_000_000: man([1500, 800, 750, 700, 500, 400, 250, 180, 140, 120, 120, 120, 80, 50]),
    30_000_000: man([3000, 1600, 1500, 1400, 1000, 800, 500, 360, 280, 240, 200, 180, 130, 80]),
    50_000_000: man([5000, 2700, 2500, 2300, 1650, 1300, 800, 600, 450, 400, 300, 290, 210, 130]),
  } as Record<number, Record<number, number>>,
  disabilityAmounts: {
    15_000_000: man([1500, 1350, 1200, 1050, 900, 750, 600, 450, 360, 270, 210, 150, 90, 60]),
    30_000_000: man([3000, 2700, 2400, 2100, 1800, 1500, 1200, 900, 720, 540, 420, 300, 180, 120]),
    50_000_000: man([5000, 4500, 4000, 3500, 3000, 2500, 2000, 1500, 1200, 900, 700, 500, 300, 200]),
    100_000_000: man([10000, 9000, 8000, 7000, 6000, 5000, 4000, 3000, 2400, 1800, 1400, 1000, 600, 400]),
  } as Record<number, Record<number, number>>,
  basis: { source: "보통약관 제15조·제16조, 별표3 1) 상해구분 및 급별 보험가입금액표·2) 후유장애구분 및 급별 보험가입금액표", page: 82 } satisfies Basis,
};

// ── 자기차량손해 자기부담금: 제24조①(인쇄 55–56쪽) ──
export const OWN_DAMAGE_TERMS = {
  /** 전부손해이거나 보상할 금액이 가입금액 전액 이상이면 자기부담금을 빼지 않는다(제24조①3호) */
  waivedOnTotalLoss: true,
  /** 자기부담금은 실제 손해액에서 구상금을 뺀 금액을 전제로 산정한다(제24조①5호) */
  onNetOfRecovery: true,
  basis: { source: "보통약관 제24조①3·5호", page: 55 } satisfies Basis,
};

// ── 근거 문구(화면 계산식 옆에 그대로) ──
export const BASIS_TEXT = {
  bodily1Fault: "별표4 1. 과실상계 가.(1)·(2), 시행령 [별표 1]",
  excessFault: "별표4 1. 과실상계 가.(1)·(3)",
  uninsured: "보통약관 제20조(무보험자동차에 의한 상해 지급보험금의 계산), 개인용 인쇄 53쪽",
  autoInjury: "자동차상해 특별약관(지급보험금 = 실제손해액 − 공제액, 가입금액 한도), 개인용 인쇄 119–120쪽",
  selfInjury: "보통약관 제16조(자기신체사고 지급보험금 = 실제손해액 − 공제액, 공제액이 없으면 ①4호), 별표3, 개인용 인쇄 51–52·82쪽",
  property: "별표2 대물배상, 별표4 1. 과실상계 가.(1)",
  ownDamage: "보통약관 제24조(자기차량손해 지급보험금의 계산), 개인용 인쇄 55–56쪽",
  government: "자동차손해배상보장법 제30조(자동차손해배상 보장사업)",
  familyBodily2: "보통약관 제8조②1호(피보험자 또는 그 부모·배우자·자녀는 대인배상Ⅱ 면책), 개인용 인쇄 48쪽",
  ownDamageDui: "보통약관 제23조 14호(무면허·음주·마약: 보험계약자·기명피보험자, 30일 초과 임차인, 동거 친족), 개인용 인쇄 55쪽",
  driverScope: "운전자 한정운전 특별약관 2.(1)·5. 기타, 개인용 인쇄 98–99쪽",
  rideAlong: "별표4 3. 동승자에 대한 감액, 별표5 동승자 유형별 감액비율표",
} as const;

/**
 * 약관과 다르게 가정한 값. 계산 결과에 이 표시를 붙이고 보고서에 적는다.
 */
export const ASSUMPTIONS = {
  /**
   * 휴업손해의 1일 수입감소액 = 월 현실소득액 ÷ 30. 약관은 "1일 수입감소액 × 휴업일수 × 85/100"(별표1 나. 3., 인쇄 76쪽)만 정하고
   * 월소득을 하루 금액으로 바꾸는 날수는 정하지 않는다. 원 미만은 버린다.
   */
  daysPerMonth: { value: 30, label: "앱 가정: 휴업손해 1일 수입감소액 = 월소득 ÷ 30일(약관에 날수 없음)" },
  /**
   * 과실 없는 남 동승자의 손해는 두 차량이 공동으로 배상한다. 앱은 받을 곳을 과실비율로 나눠 보여 준다(상대 보험 = 상대 과실분).
   * 약관에 받을 곳을 나누는 기준은 없다(공동불법행위자 사이의 분담). "어느 한쪽 보험사에 전액 청구할 수 있음"을 함께 안내한다.
   */
  passengerSplitByFault: { value: true, label: "앱 가정: 동승자 손해의 받을 곳을 과실비율로 나눔(어느 한쪽에 전액 청구 가능)" },
} as const;

// ── legacy 엔진이 읽는 규칙 항목(시행령 한도) ──
// 시행령 금액은 약관 판과 따로 정해지지만, 이 파일은 2026-10-25 개정판 <붙임>에서 읽었으므로 그 날짜부터 쓴다.
function rule(id: string, value: number, appendix: string, clause: string, page: number): RuleItem {
  return {
    id,
    value,
    unit: "KRW",
    productLines: ["personal", "business", "commercial", "motorcycle"],
    effectiveFrom: STANDARDS_AS_OF,
    effectiveTo: null,
    basis: { sourceId: "decree", source: `${appendix} ${clause} (약관 <붙임> 인쇄 ${page}쪽)`, document: "자동차손해배상보장법 시행령", appendix, clause, page },
    status: "confirmed",
    note: "",
  };
}

/** legacy liabilityBodily1·excessOverCompulsory가 읽는 대인배상Ⅰ 한도 규칙. 법령 값이라 네 보험 종류에 모두 쓴다 */
export function compulsoryRuleItems(): RuleItem[] {
  const items: RuleItem[] = [];
  for (const [grade, value] of Object.entries(INJURY_LIMITS)) items.push(rule(`liability1.injury.limit.grade${grade}`, value, "[별표 1]", `${grade}급`, 84));
  for (const [grade, value] of Object.entries(DISABILITY_LIMITS)) items.push(rule(`liability1.disability.limit.grade${grade}`, value, "[별표 2]", `${grade}급`, 93));
  items.push(rule("liability1.death.limit", COMPULSORY.deathLimit.value, "제3조①1호", "사망", 9));
  items.push(rule("liability1.death.minimum", COMPULSORY.deathMinimum.value, "제3조①1호 단서", "사망 최저", 82));
  return items;
}
