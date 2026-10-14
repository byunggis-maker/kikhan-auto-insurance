import { z } from "zod";

// 사람 담보 계산 엔진의 입력. 금액은 원 단위 정수. 모르면 null, 없다고 확인했으면 0.

const won = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const days = z.number().int().min(0).max(36500);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const grade = z.number().int().min(1).max(14);

/** 가입금액. "무한"은 숫자가 아니므로 따로 둔다. */
export const limitSchema = z.union([won, z.literal("unlimited")]);

export const occupationTypeSchema = z.enum(["employee", "self_employed", "homemaker", "unemployed", "student", "pensioner", "minor", "other"]);

export const personClaimSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  birthDate: date.nullable(),
  /** 이 사람 쪽의 과실비율(%). 0~100 */
  faultPercent: z.number().int().min(0).max(100).nullable(),
  occupationType: occupationTypeSchema.nullable(),
  /** 월평균 현실소득액(세금 등을 뺀 금액) */
  monthlyIncome: won.nullable(),
  /** 소득과 수입 감소를 서류로 증명할 수 있는지 */
  incomeProven: z.boolean().nullable(),
  /** 자동차(이륜자동차 제외)의 운전자인지. 경상환자(12~14급) 치료비 과실 규정에 쓴다 */
  vehicleDriver: z.boolean().nullable(),
  injury: z
    .object({
      /** 사용자가 고른 상해급수 */
      grade: grade.nullable(),
      /** 실제 치료비(치료관계비) */
      treatmentCost: won.nullable(),
      futureTreatmentCost: won.nullable(),
      hospitalDays: days.nullable(),
      outpatientDays: days.nullable(),
      daysOffWork: days.nullable(),
      /** 휴업 기간의 1일 수입감소액. 입력하면 월소득 대신 이 값을 쓴다 */
      dailyIncomeLoss: won.nullable(),
      /** 입원 중 병원 식사를 받지 않은 끼니 수 */
      mealsNotProvided: z.number().int().min(0).max(109500).nullable(),
      /** 간병이 필요했음을 진단서 등으로 증명할 수 있는지 */
      nursingProven: z.boolean().nullable(),
    })
    .nullable(),
  death: z.object({ date }).nullable(),
  disability: z
    .object({
      /** 노동능력상실률(%). 소수는 "24.5"처럼 문자로 받는다 */
      lossRatePercent: z
        .string()
        .regex(/^\d{1,3}(\.\d{1,4})?$/)
        .nullable(),
      /** 후유장애 급수(자동차손해배상보장법 시행령 별표 2) */
      grade: grade.nullable(),
      /** 후유장애 판정일(노동능력상실일). 없으면 사고일을 쓴다 */
      determinedOn: date.nullable(),
    })
    .nullable(),
  /** 배상의무자가 아닌 제3자에게서 이미 받은 금액(산재보험 제외) */
  receivedFromThirdParty: won.nullable(),
  /** 배상의무자(가해자)에게서 직접 이미 받은 손해배상금 */
  receivedFromLiableParty: won.nullable(),
});

/** 이 사람에게 배상할 쪽(가해 차량)의 보험 상태 */
export const liableInsuranceSchema = z.object({
  status: z.enum(["full", "mandatory_only", "none", "hit_and_run", "no_counterparty", "unknown"]),
  /** 대인배상Ⅱ 가입금액. 모르면 null */
  bodily2Limit: limitSchema.nullable(),
});

/** 이 사람이 피보험자로서 쓸 수 있는 내 보험의 담보. 가입하지 않은 담보는 null */
export const ownCoverageSchema = z.object({
  autoInjury: z.object({ injuryLimit: limitSchema.nullable(), deathDisabilityLimit: limitSchema.nullable() }).nullable(),
  selfInjury: z.object({ injuryLimit: won.nullable(), deathLimit: won.nullable(), disabilityLimit: won.nullable() }).nullable(),
  uninsured: z.object({ limit: limitSchema.nullable() }).nullable(),
});

export const personCoverageInputSchema = z.object({
  accidentDate: date,
  person: personClaimSchema,
  /** mine: 나와 내 차에 탄 사람. others: 상대방 쪽 사람 */
  side: z.enum(["mine", "others"]),
  liable: liableInsuranceSchema,
  /** 상대방 쪽 사람이면 null */
  own: ownCoverageSchema.nullable(),
});

export type Limit = z.infer<typeof limitSchema>;
export type PersonClaim = z.infer<typeof personClaimSchema>;
export type LiableInsurance = z.infer<typeof liableInsuranceSchema>;
export type OwnCoverage = z.infer<typeof ownCoverageSchema>;
export type PersonCoverageInput = z.infer<typeof personCoverageInputSchema>;
