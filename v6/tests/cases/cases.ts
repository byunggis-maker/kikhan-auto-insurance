import type { Claim } from "@/lib/claim/types";
import { claim, counterpartyPolicy, item, myPolicy, property, selfInjuryPolicy, victim } from "./fixtures";

// 라운드 2 사례(결정 기록 D-12). (1)~(8)은 칸이 고정한 사례, (9)~(15)는 담보 매칭 사례.
// expected: 줄 key(카드:담보:지급처) → [확정액, 추정 포함액]. 손 검산 값이다(계산식은 각 줄 주석).

export type Case = { no: number; title: string; claim: Claim; expected: Record<string, [number, number]>; burdens?: Record<string, [number, number]>; excluded?: string[] };

// 14급 기본 손해: 치료관계비 800,000 + 부상 위자료 150,000 + 그 밖의 손해(통원 10일) 80,000 = 1,030,000
const minor14 = () => [item("treatment", { c: 800_000 }), item("solatium_injury", { c: 150_000 }), item("other_injury", { c: 80_000 })];

export const CASES: Case[] = [
  {
    no: 1,
    title: "기존 예시: 운전자 9급, 내 과실 30%, 상대 종합보험",
    claim: claim({
      myFault: 30,
      victims: [victim({ id: "나", role: "driver", relationToNamedInsured: "self", vehicleDriver: true, injuryGrade: 9, losses: [item("treatment", { c: 2_000_000 }), item("solatium_injury", { c: 250_000 }), item("other_injury", { c: 80_000 }), item("lost_income", { c: 850_000 })] })],
    }),
    expected: {
      // 3,180,000 × 70% = 2,226,000 (치료관계비 2,000,000 이상) → 9급 한도 2,400,000 이내
      "나:liability_bodily_1:counterparty_insurer": [2_226_000, 2_226_000],
      "나:liability_bodily_2:counterparty_insurer": [0, 0],
      // 3,180,000 − 2,226,000
      "나:auto_injury:own_insurer": [954_000, 954_000],
    },
  },
  {
    no: 2,
    title: "가족 동승자(배우자) 12급, 내 과실 40%, 휴업손해는 추정",
    claim: claim({
      myFault: 40,
      victims: [
        victim({ id: "배우자", role: "family_passenger", relationToNamedInsured: "spouse", vehicleDriver: false, injuryGrade: 12, incomeProven: true, losses: [item("treatment", { c: 2_000_000 }), item("solatium_injury", { c: 150_000 }), item("other_injury", { c: 80_000 }), item("lost_income", { e: 1_500_000 })] }),
      ],
    }),
    expected: {
      // 확정 2,230,000 × 60% = 1,338,000 < 치료관계비 2,000,000 → 2,000,000 → 12급 한도 1,200,000 / 추정 3,730,000 × 60% = 2,238,000 → 1,200,000
      "배우자:liability_bodily_1:counterparty_insurer": [1_200_000, 1_200_000],
      // 확정 2,000,000 − 1,200,000 / 추정 2,238,000 − 1,200,000
      "배우자:liability_bodily_2:counterparty_insurer": [800_000, 1_038_000],
      // 확정 2,230,000 − 2,000,000 = 230,000 / 추정 3,730,000 − 2,238,000 = 1,492,000 → 대인Ⅰ 한도 1,200,000
      "배우자:liability_bodily_1:own_insurer": [230_000, 1_200_000],
      "배우자:liability_bodily_2:own_insurer": [0, 0],
      // 확정 0 / 추정 3,730,000 − 3,438,000
      "배우자:auto_injury:own_insurer": [0, 292_000],
    },
    excluded: ["배우자:liability_bodily_2:own_insurer"],
  },
  {
    no: 3,
    title: "상대방 부상: 상대 운전자 12급, 내 과실 70%",
    claim: claim({
      myFault: 70,
      victims: [victim({ id: "상대운전자", role: "counterparty", vehicleDriver: true, injuryGrade: 12, incomeProven: true, losses: [item("treatment", { c: 3_000_000 }), item("solatium_injury", { c: 150_000 }), item("other_injury", { c: 160_000 }), item("lost_income", { e: 500_000 })] })],
    }),
    expected: {
      // 상대 과실 30%: 확정 3,310,000 × 70% = 2,317,000 < 3,000,000 → 3,000,000 → 12급 한도 1,200,000
      "상대운전자:liability_bodily_1:own_insurer": [1_200_000, 1_200_000],
      // 확정: 하한 3,000,000 − 경상 본인 부담 (3,000,000 − 1,200,000) × 30% = 2,460,000 − 1,200,000 / 추정: 3,810,000 × 70% = 2,667,000 − 1,200,000
      "상대운전자:liability_bodily_2:own_insurer": [1_260_000, 1_467_000],
    },
  },
  {
    no: 4,
    title: "뺑소니, 무보험차상해 미가입 → 정부보장사업. 운전자 5급, 내 과실 0%",
    claim: claim({
      myFault: 0,
      accident: { type: "hit_and_run_or_uninsured" },
      myPolicy: myPolicy({ without: ["uninsured", "auto_injury"] }),
      counterpartyPolicy: counterpartyPolicy("hit_and_run"),
      victims: [victim({ id: "나", role: "driver", relationToNamedInsured: "self", vehicleDriver: true, injuryGrade: 5, incomeProven: true, losses: [item("treatment", { c: 9_000_000 }), item("solatium_injury", { c: 750_000 }), item("lost_income", { e: 2_638_360 })] })],
    }),
    expected: {
      // 확정 9,750,000 / 추정 12,388,360 → 5급 한도 9,000,000 (대인Ⅰ 상당액, 정부보장사업)
      "나:liability_bodily_1:government": [9_000_000, 9_000_000],
    },
  },
  {
    no: 5,
    title: "음주운전 사고부담금: 내 과실 100%, 상대 운전자 14급, 상대 차 수리비·렌트, 내 차 수리비",
    claim: claim({
      myFault: 100,
      violations: { drunk: true, driverRelation: "policyholder_or_named" },
      victims: [victim({ id: "상대운전자", role: "counterparty", vehicleDriver: true, injuryGrade: 14, losses: minor14() })],
      properties: [
        property({ id: "상대차", role: "counterparty_vehicle", losses: [item("repair", { c: 15_000_000 }), item("rental", { e: 1_000_000 })] }),
        property({ id: "내차", role: "my_vehicle", valueAtAccident: 20_000_000, losses: [item("repair", { c: 3_000_000 })] }),
      ],
    }),
    expected: {
      "상대운전자:liability_bodily_1:own_insurer": [500_000, 500_000],
      "상대운전자:liability_bodily_2:own_insurer": [530_000, 530_000],
      "상대차:liability_property:own_insurer": [15_000_000, 16_000_000],
      "내차:own_damage:own_insurer": [0, 0],
    },
    burdens: {
      "burden:bodily1": [500_000, 500_000],
      "burden:bodily2": [530_000, 530_000],
      // 의무한도 2천만원 이하 지급보험금 전액
      "burden:property": [15_000_000, 16_000_000],
    },
    excluded: ["내차:own_damage:own_insurer"],
  },
  {
    no: 6,
    title: "운전자 범위 위반: 내 과실 100%, 상대 운전자 14급, 상대 차 수리비 2,500만원 → 대인Ⅰ만 보상(약관대로)",
    claim: claim({
      myFault: 100,
      violations: { outsideDriverScope: true },
      victims: [victim({ id: "상대운전자", role: "counterparty", vehicleDriver: true, injuryGrade: 14, losses: minor14() })],
      properties: [
        property({ id: "상대차", role: "counterparty_vehicle", losses: [item("repair", { c: 25_000_000 })] }),
        property({ id: "내차", role: "my_vehicle", valueAtAccident: 20_000_000, losses: [item("repair", { c: 3_000_000 })] }),
      ],
    }),
    expected: {
      "상대운전자:liability_bodily_1:own_insurer": [500_000, 500_000],
      "상대운전자:liability_bodily_2:own_insurer": [0, 0],
      // 약관대로 대물 0원(결정 기록 D-15)
      "상대차:liability_property:own_insurer": [0, 0],
      "내차:own_damage:own_insurer": [0, 0],
    },
    burdens: {
      "상대운전자:bodily2_uncovered": [530_000, 530_000],
      // 대물 손해 전액이 내가 낼 돈
      "상대차:property_uncovered": [25_000_000, 25_000_000],
    },
    excluded: ["상대운전자:liability_bodily_2:own_insurer", "상대차:liability_property:own_insurer", "내차:own_damage:own_insurer"],
  },
  {
    no: 7,
    title: "항목 없이 합계 칸만 300만원 추정: 운전자 12급, 내 과실 70%",
    claim: claim({
      myFault: 70,
      victims: [victim({ id: "나", role: "driver", relationToNamedInsured: "self", vehicleDriver: true, injuryGrade: 12, losses: [], userTotal: 3_000_000 })],
    }),
    expected: {
      // 추정 3,000,000 × 30% = 900,000. 미분류라 치료관계비 하한 없음 → 12급 한도 1,200,000 이내 900,000
      "나:liability_bodily_1:counterparty_insurer": [0, 900_000],
      "나:liability_bodily_2:counterparty_insurer": [0, 0],
      // 3,000,000 − 900,000
      "나:auto_injury:own_insurer": [0, 2_100_000],
    },
  },
  {
    no: 8,
    title: "내 과실 100%, 대물 한도 2천만원, 수리비 확정 1,900만원 + 렌트 추정 300만원",
    claim: claim({
      myFault: 100,
      myPolicy: myPolicy({ set: { liability_property: { limit: 20_000_000 } } }),
      properties: [property({ id: "상대차", role: "counterparty_vehicle", losses: [item("repair", { c: 19_000_000 }), item("rental", { e: 3_000_000 })] })],
    }),
    expected: { "상대차:liability_property:own_insurer": [19_000_000, 20_000_000] },
    burdens: { "상대차:property_over_limit": [0, 2_000_000] },
  },
  // ── 담보 매칭 (9)~(15) ──
  {
    no: 9,
    title: "매칭 나: 운전자 14급, 내 과실 30% → 상대 대인Ⅰ·Ⅱ + 내 자동차상해",
    claim: claim({ myFault: 30, victims: [victim({ id: "나", role: "driver", relationToNamedInsured: "self", vehicleDriver: true, injuryGrade: 14, losses: minor14() })] }),
    expected: {
      // 721,000 < 800,000 → 800,000 → 14급 한도 500,000
      "나:liability_bodily_1:counterparty_insurer": [500_000, 500_000],
      // 하한 800,000 − 본인 부담 (800,000 − 500,000) × 30% = 710,000 < 과실상계 후 721,000 → 721,000 − 500,000
      "나:liability_bodily_2:counterparty_insurer": [221_000, 221_000],
      "나:auto_injury:own_insurer": [309_000, 309_000],
    },
  },
  {
    no: 10,
    title: "매칭 가족 동승자(자녀) 14급, 내 과실 30% → 상대 대인 + 내 대인Ⅰ, 내 대인Ⅱ 면책, 내 자동차상해",
    claim: claim({ myFault: 30, victims: [victim({ id: "자녀", role: "family_passenger", relationToNamedInsured: "child", vehicleDriver: false, injuryGrade: 14, losses: minor14() })] }),
    expected: {
      "자녀:liability_bodily_1:counterparty_insurer": [500_000, 500_000],
      // 운전자가 아니라 본인 부담 없음: 하한 800,000 − 500,000
      "자녀:liability_bodily_2:counterparty_insurer": [300_000, 300_000],
      // 1,030,000 − 800,000
      "자녀:liability_bodily_1:own_insurer": [230_000, 230_000],
      "자녀:liability_bodily_2:own_insurer": [0, 0],
      "자녀:auto_injury:own_insurer": [0, 0],
    },
    excluded: ["자녀:liability_bodily_2:own_insurer"],
  },
  {
    no: 11,
    title: "매칭 남 동승자 14급, 내 과실 30% → 상대 대인 + 내 대인Ⅰ·Ⅱ(공동 배상), 내 자동차상해 대상 아님",
    claim: claim({ myFault: 30, victims: [victim({ id: "동료", role: "other_passenger", relationToNamedInsured: "none", vehicleDriver: false, injuryGrade: 14, losses: minor14() })] }),
    expected: {
      "동료:liability_bodily_1:counterparty_insurer": [500_000, 500_000],
      "동료:liability_bodily_2:counterparty_insurer": [300_000, 300_000],
      "동료:liability_bodily_1:own_insurer": [230_000, 230_000],
      "동료:liability_bodily_2:own_insurer": [0, 0],
    },
  },
  {
    no: 12,
    title: "매칭 상대 무보험: 운전자 5급, 내 과실 20% → 대인Ⅰ 상당액(정부보장사업) + 내 무보험차상해 + 내 자동차상해",
    claim: claim({
      myFault: 20,
      accident: { type: "hit_and_run_or_uninsured" },
      counterpartyPolicy: counterpartyPolicy("uninsured"),
      victims: [victim({ id: "나", role: "driver", relationToNamedInsured: "self", vehicleDriver: true, injuryGrade: 5, losses: [item("treatment", { c: 9_000_000 }), item("solatium_injury", { c: 750_000 }), item("lost_income", { c: 3_000_000 })] })],
    }),
    expected: {
      // 12,750,000 × 80% = 10,200,000 → 5급 한도 9,000,000
      "나:liability_bodily_1:government": [9_000_000, 9_000_000],
      // 10,200,000 − 9,000,000
      "나:uninsured:own_insurer": [1_200_000, 1_200_000],
      // 12,750,000 − 10,200,000
      "나:auto_injury:own_insurer": [2_550_000, 2_550_000],
    },
  },
  {
    no: 13,
    title: "매칭 상대방(보행자) 9급, 내 과실 90% → 내 대인Ⅰ·Ⅱ, 보험료 할증 안내",
    claim: claim({
      myFault: 90,
      accident: { type: "car_person" },
      counterpartyPolicy: null,
      victims: [victim({ id: "보행자", role: "counterparty", vehicleDriver: false, injuryGrade: 9, losses: [item("treatment", { c: 2_000_000 }), item("solatium_injury", { c: 250_000 }), item("lost_income", { c: 850_000 })] })],
    }),
    expected: {
      // 3,100,000 × 90% = 2,790,000 → 9급 한도 2,400,000
      "보행자:liability_bodily_1:own_insurer": [2_400_000, 2_400_000],
      "보행자:liability_bodily_2:own_insurer": [390_000, 390_000],
    },
  },
  {
    no: 14,
    title: "매칭 내 차: 내 과실 30%, 수리비 500만원 + 렌트 100만원 → 상대 대물 + 내 자기차량손해",
    claim: claim({ myFault: 30, properties: [property({ id: "내차", role: "my_vehicle", valueAtAccident: 20_000_000, losses: [item("repair", { c: 5_000_000 }), item("rental", { c: 1_000_000 })] })] }),
    expected: {
      // 6,000,000 × 70%
      "내차:liability_property:counterparty_insurer": [4_200_000, 4_200_000],
      // 5,000,000 − 상대 처리분 3,500,000 = 1,500,000 − 자기부담금 300,000
      "내차:own_damage:own_insurer": [1_200_000, 1_200_000],
    },
  },
  {
    no: 15,
    title: "매칭 상대 차: 내 과실 30%, 상대 차 수리비 400만원 → 내 대물배상",
    claim: claim({ myFault: 30, properties: [property({ id: "상대차", role: "counterparty_vehicle", losses: [item("repair", { c: 4_000_000 })] })] }),
    expected: { "상대차:liability_property:own_insurer": [1_200_000, 1_200_000] },
  },
  // ── 자기신체사고 가입 버전(라운드 2 결정 2): 자동차상해 대신 자기신체사고(부상·사망·후유장애 가입금액 3천만원) ──
  {
    no: 16,
    title: "사례 (1)의 자기신체사고 버전: 운전자 9급, 내 과실 30%",
    claim: claim({
      myFault: 30,
      myPolicy: selfInjuryPolicy(),
      victims: [victim({ id: "나", role: "driver", relationToNamedInsured: "self", vehicleDriver: true, injuryGrade: 9, losses: [item("treatment", { c: 2_000_000 }), item("solatium_injury", { c: 250_000 }), item("other_injury", { c: 80_000 }), item("lost_income", { c: 850_000 })] })],
    }),
    expected: {
      "나:liability_bodily_1:counterparty_insurer": [2_226_000, 2_226_000],
      "나:liability_bodily_2:counterparty_insurer": [0, 0],
      // 3,180,000 − 공제 2,226,000 = 954,000 → 별표3 가입금액 3천만원 9급 한도 2,800,000 이내
      "나:self_injury:own_insurer": [954_000, 954_000],
    },
  },
  {
    no: 17,
    title: "사례 (9)의 자기신체사고 버전: 운전자 14급, 내 과실 30%",
    claim: claim({ myFault: 30, myPolicy: selfInjuryPolicy(), victims: [victim({ id: "나", role: "driver", relationToNamedInsured: "self", vehicleDriver: true, injuryGrade: 14, losses: minor14() })] }),
    expected: {
      "나:liability_bodily_1:counterparty_insurer": [500_000, 500_000],
      "나:liability_bodily_2:counterparty_insurer": [221_000, 221_000],
      // 1,030,000 − 721,000 = 309,000 → 14급 한도 800,000 이내
      "나:self_injury:own_insurer": [309_000, 309_000],
    },
  },
  {
    no: 18,
    title: "사례 (12)의 자기신체사고 버전: 상대 무보험, 운전자 5급, 내 과실 20%",
    claim: claim({
      myFault: 20,
      accident: { type: "hit_and_run_or_uninsured" },
      myPolicy: selfInjuryPolicy(),
      counterpartyPolicy: counterpartyPolicy("uninsured"),
      victims: [victim({ id: "나", role: "driver", relationToNamedInsured: "self", vehicleDriver: true, injuryGrade: 5, losses: [item("treatment", { c: 9_000_000 }), item("solatium_injury", { c: 750_000 }), item("lost_income", { c: 3_000_000 })] })],
    }),
    expected: {
      "나:liability_bodily_1:government": [9_000_000, 9_000_000],
      "나:uninsured:own_insurer": [1_200_000, 1_200_000],
      // 12,750,000 − 공제(정부보장사업 9,000,000 + 무보험차상해 1,200,000) = 2,550,000 → 5급 한도 10,000,000 이내
      "나:self_injury:own_insurer": [2_550_000, 2_550_000],
    },
  },
  {
    no: 19,
    title: "자기신체사고 단독사고(공제액 없음): 운전자 12급, 치료비 300만원",
    claim: claim({
      myFault: 100,
      accident: { type: "single" },
      myPolicy: selfInjuryPolicy(),
      counterpartyPolicy: null,
      victims: [victim({ id: "나", role: "driver", relationToNamedInsured: "self", vehicleDriver: true, injuryGrade: 12, losses: [item("treatment", { c: 3_000_000 }), item("solatium_injury", { c: 150_000 })] })],
    }),
    // 공제액 없음(제16조①4호): 실제 치료비 3,000,000 → 별표3 가입금액 3천만원 12급 한도 1,800,000
    expected: { "나:self_injury:own_insurer": [1_800_000, 1_800_000] },
  },
  {
    no: 20,
    title: "약관 기준 자동 산정: 운전자 9급, 내 과실 30%, 위자료·휴업손해·통원비 칸을 비우고 일수·소득만 입력",
    claim: claim({
      myFault: 30,
      victims: [
        victim({
          id: "나",
          role: "driver",
          relationToNamedInsured: "self",
          vehicleDriver: true,
          injuryGrade: 9,
          outpatientDays: 10,
          daysOffWork: 10,
          monthlyIncome: 3_000_000,
          incomeProven: true,
          losses: [item("treatment", { c: 2_000_000 }), item("solatium_injury", {}), item("lost_income", {}), item("other_injury", {})],
        }),
      ],
    }),
    expected: {
      // 확정: 치료관계비 2,000,000만 → 1,400,000 < 2,000,000 → 하한 2,000,000 / 추정: 약관 기준 위자료 250,000 + 휴업 850,000 + 통원 80,000 → 3,180,000 × 70%
      "나:liability_bodily_1:counterparty_insurer": [2_000_000, 2_226_000],
      "나:liability_bodily_2:counterparty_insurer": [0, 0],
      "나:auto_injury:own_insurer": [0, 954_000],
    },
  },
];
