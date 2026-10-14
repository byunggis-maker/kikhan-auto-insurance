import { z } from "zod";
import { personCoverageInputSchema } from "./person-claim";
import { legalClaimSchema, vehicleClaimSchema } from "./vehicle-claim";

// 사고 한 건 전체의 계산 입력과 결과 행렬.

export const productLineSchema = z.enum(["personal", "business", "commercial", "motorcycle"]);

export const accidentClaimSchema = z.object({
  accidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 내 증권의 보험 종류 */
  productLine: productLineSchema,
  persons: z.array(personCoverageInputSchema.omit({ accidentDate: true })),
  vehicles: z.array(vehicleClaimSchema),
  /** 법률비용 지원 특약. 가입하지 않았으면 null */
  legal: legalClaimSchema.nullable(),
  /** 증권에 있는 그 밖의 특약(이름만) */
  otherRiders: z.array(z.object({ name: z.string().min(1), insuredId: z.string().min(1), insuredLabel: z.string() })),
});

const range = z.object({ min: z.number().int().min(0), expected: z.number().int().min(0), max: z.number().int().min(0) });
const group = z.enum(["mine", "others"]);

/** 저장한 행렬을 다시 읽을 때 쓰는 검증. 합계는 저장하지 않고 읽을 때 summarize로 다시 계산한다 */
export const matrixSchema = z.object({
  accidentDate: z.string(),
  productLine: productLineSchema,
  rows: z.array(z.object({ id: z.string(), label: z.string(), group })),
  columns: z.array(z.object({ id: z.string(), label: z.string(), coverage: z.string() })),
  cells: z.array(
    z
      .object({
        rowId: z.string(),
        columnId: z.string(),
        group,
        status: z.enum(["calculated", "insufficient_info", "not_applicable", "needs_check"]),
        amount: range.nullable(),
        inTotal: z.boolean(),
      })
      .loose(),
  ),
});

export type AccidentClaim = z.infer<typeof accidentClaimSchema>;
