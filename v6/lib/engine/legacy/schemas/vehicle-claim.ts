// 이식 원본: compass/lib/schemas/vehicle-claim.ts 1–112행 전체 (compass 커밋 e58ffd1). 입력 자료형(zod). 바꾼 것: 없음.
// MASTER.md 6장 이식 로직(부록 A). 아직 v6 엔진에 연결하지 않았다.
import { z } from "zod";

// 차량 담보(대물배상, 자기차량손해)와 특약 계산의 입력. 금액은 원 단위 정수. 모르면 null, 없다고 확인했으면 0.

const won = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const days = z.number().int().min(0).max(3650);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const percent = z.number().int().min(0).max(100);

/** 사고로 망가진 차량 한 대 */
export const vehicleDamageSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  /** 차량 주인(보험금을 받는 사람)의 행 id. 사람 입력의 id와 같으면 같은 행에 놓인다 */
  ownerId: z.string().min(1),
  /** 이 차량 쪽의 과실비율(%) */
  faultPercent: percent.nullable(),
  repairCost: won.nullable(),
  /** 수리할 수 없거나 수리비가 차량가액을 넘어 폐차하는 경우(전손) */
  totalLoss: z.boolean().nullable(),
  /** 사고 직전 차량가액 */
  valueAtAccident: won.nullable(),
  /** 내용연수가 지났거나 차량충당연한을 적용받는 차량인지(수리비 한도가 넓어진다) */
  extendedRepairCap: z.boolean().nullable(),
  /** 출고일(최초 등록일). 시세하락손해에 쓴다 */
  firstRegisteredOn: date.nullable(),
  /** 사업용자동차인지. 사업용이면 대차료 대신 휴차료다 */
  commercialUse: z.boolean().nullable(),
  /** 차를 쓰지 못한 기간의 대차(렌트). 입력하지 않았으면 null */
  rental: z
    .object({
      /** 실제로 렌트를 했는지 */
      rented: z.boolean().nullable(),
      days: days.nullable(),
      /** 동급 최저요금 대여자동차의 1일 통상 요금 */
      dailyRate: won.nullable(),
      /** 실제 정비작업시간이 길어 인정기간이 늘어나는 경우인지 */
      longRepair: z.boolean().nullable(),
    })
    .nullable(),
  /** 사업용자동차의 휴차. 입력하지 않았으면 null */
  idle: z.object({ days: days.nullable(), dailyAmount: won.nullable() }).nullable(),
  towingCost: won.nullable(),
});

/** 이 차량 손해를 배상할 쪽(상대 차량)의 대물배상 */
export const propertyLiableSchema = z.object({
  status: z.enum(["insured", "none", "no_counterparty", "unknown"]),
  /** 대물배상 가입금액. 모르면 null */
  propertyLimit: won.nullable(),
});

export const deductibleSchema = z.union([
  z.object({ type: z.literal("fixed"), amount: won }),
  z.object({ type: z.literal("rate"), ratePercent: z.number().int().min(1).max(100), min: won, max: won }),
]);

export const vehicleClassSchema = z.enum(["small", "mid", "large", "xlarge", "multi"]);

/** 내 차량에 쓸 수 있는 내 보험의 담보. 가입하지 않았으면 null */
export const ownVehicleCoverageSchema = z.object({
  ownDamage: z.object({ limit: won.nullable(), deductible: deductibleSchema.nullable() }).nullable(),
  rentalRider: z.object({ vehicleClass: vehicleClassSchema.nullable() }).nullable(),
});

export const vehicleClaimSchema = z.object({
  /** mine: 내 차량. others: 상대방 쪽 차량·재물 */
  side: z.enum(["mine", "others"]),
  damage: vehicleDamageSchema,
  liable: propertyLiableSchema,
  /** 상대방 쪽 차량이면 null */
  own: ownVehicleCoverageSchema.nullable(),
});

const grade = z.number().int().min(1).max(14);

/** 법률비용 지원 특약과 그 사고에서 생긴 법률비용 */
export const legalClaimSchema = z.object({
  /** 보험금을 받는 피보험자(운전자)의 행 id */
  insuredId: z.string().min(1),
  insuredLabel: z.string(),
  /** 증권의 가입 유형. 모르면 null */
  plan: z.enum(["basic", "premium", "top", "top2"]).nullable(),
  /** 변호사선임비용·벌금비용을 가입했는지(제외 추가특약이 없으면 true) */
  lawyerIncluded: z.boolean(),
  fineIncluded: z.boolean(),
  settlements: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string(),
      /** death: 사망 사고, gross_negligence_injury: 중과실 사고로 다치게 함, serious_injury: 중상해로 송치·공소제기 */
      kind: z.enum(["death", "gross_negligence_injury", "serious_injury"]),
      victimGrade: grade.nullable(),
      /** 피해자에게 준 형사합의금(공탁금) */
      amount: won.nullable(),
    }),
  ),
  /** 구속되거나 공소가 제기되어(약식기소 제외) 변호사를 선임했는지 */
  lawyerEligible: z.boolean().nullable(),
  lawyerFee: won.nullable(),
  /** 확정판결로 정해진 벌금 */
  fine: won.nullable(),
  /** 어린이 보호구역 사고로 가중처벌을 받았는지 */
  schoolZone: z.boolean().nullable(),
});

export type VehicleDamage = z.infer<typeof vehicleDamageSchema>;
export type PropertyLiable = z.infer<typeof propertyLiableSchema>;
export type Deductible = z.infer<typeof deductibleSchema>;
export type OwnVehicleCoverage = z.infer<typeof ownVehicleCoverageSchema>;
export type VehicleClaim = z.infer<typeof vehicleClaimSchema>;
export type LegalClaim = z.infer<typeof legalClaimSchema>;
