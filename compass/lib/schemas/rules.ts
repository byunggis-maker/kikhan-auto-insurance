import { z } from "zod";

// data/rules/standard/*.json의 모양. 지급기준 숫자는 모두 이 모양의 항목으로 둔다.

export const ruleStatusSchema = z.enum(["confirmed", "needs_check"]);

const scalar = z.union([z.number(), z.string(), z.boolean()]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const productLines = z.array(z.enum(["personal", "business", "commercial", "motorcycle"])).min(1);

const ruleBasisSchema = z.object({
  sourceId: z.string(),
  /** 출처 표기. 값을 읽은 문서·개정일·별표 여부·쪽 번호를 한 줄로 적는다 */
  source: z.string().min(1),
  document: z.string(),
  appendix: z.string(),
  clause: z.string(),
  /** 약관에 인쇄된 쪽 번호 */
  page: z.number().int(),
});

export const ruleItemSchema = z.object({
  id: z.string().min(1),
  /** 숫자·문자·목록·표. 확인하지 못한 값은 null */
  value: z.union([scalar, z.array(z.union([scalar, z.record(z.string(), z.union([z.number(), z.string(), z.null()]))])), z.record(z.string(), z.number())]).nullable(),
  unit: z.string(),
  productLines,
  effectiveFrom: date,
  effectiveTo: date.nullable(),
  /** 근거 조항 */
  basis: ruleBasisSchema,
  status: ruleStatusSchema,
  note: z.string(),
});

export const ruleFileSchema = z.object({ id: z.string(), title: z.string(), items: z.array(ruleItemSchema).min(1) });

/**
 * data/rules/daily-wage.json의 모양. 일용근로자 임금은 약관에 숫자가 없어 사람이 공표 자료를 보고 넣는다.
 * 값을 넣은 줄은 출처·공표일·적용 시작일도 함께 있어야 한다. 값이 없는 줄은 계산에 쓰지 않는다.
 */
export const dailyWageFileSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** 엔진이 이 값을 찾는 규칙 id */
  ruleId: z.string().min(1),
  unit: z.string(),
  productLines,
  note: z.string(),
  /** 일용근로자 임금을 쓰도록 정한 조항과 그 시행일 */
  definition: z.object({ effectiveFrom: date, basis: ruleBasisSchema }),
  entries: z.array(
    z
      .object({
        /** 1일 임금(원). 아직 넣지 않았으면 null */
        value: z.number().int().positive().nullable(),
        /** 공표 기관과 자료 이름 */
        source: z.string().min(1).nullable(),
        publishedOn: date.nullable(),
        effectiveFrom: date.nullable(),
        effectiveTo: date.nullable(),
      })
      .refine((entry) => entry.value === null || (entry.source !== null && entry.publishedOn !== null && entry.effectiveFrom !== null), {
        message: "일용근로자 임금 값을 넣으면 출처·공표일·적용 시작일도 함께 넣어야 합니다",
      }),
  ),
});

/** data/rules/product-check.json: 업무용·영업용·이륜차 약관을 개인용 규칙 값과 대조한 결과(scripts/check-product-terms.mjs가 만든다) */
export const productCheckSchema = z.object({
  note: z.string(),
  products: z.record(
    z.string(),
    z.object({
      file: z.string(),
      sha256: z.string(),
      /** ids: 이 대조가 확인하는 규칙 id의 정규식. same: 그 약관에서 같은 값을 찾았는지. page: 약관에 인쇄된 쪽 번호 */
      probes: z.array(z.object({ name: z.string(), ids: z.string(), same: z.boolean(), page: z.number().int().nullable() })),
      legalPlans: z.array(z.object({ key: z.string(), name: z.string(), same: z.boolean() })),
      legalTablePage: z.number().int().nullable(),
    }),
  ),
});

/** data/rules/product-revisions.json: 개정일이 적혀 있지 않은 약관의 개정일. 사람이 확인해서 넣는다 */
export const productRevisionsSchema = z.object({
  note: z.string(),
  products: z.record(
    z.enum(["business", "commercial", "motorcycle"]),
    z
      .object({ revisedOn: date.nullable(), confirmedBy: z.string().min(1).nullable() })
      .refine((entry) => entry.revisedOn === null || entry.confirmedBy !== null, { message: "개정일을 넣으면 확인한 근거(confirmedBy)도 함께 넣어야 합니다" }),
  ),
});

export type ProductCheck = z.infer<typeof productCheckSchema>;
export type ProductRevisions = z.infer<typeof productRevisionsSchema>;
export type DailyWageFile = z.infer<typeof dailyWageFileSchema>;
export type RuleItem = z.infer<typeof ruleItemSchema>;
export type RuleStatus = z.infer<typeof ruleStatusSchema>;
export type ProductLine = RuleItem["productLines"][number];
