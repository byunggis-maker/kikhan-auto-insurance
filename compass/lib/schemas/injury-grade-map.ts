import { z } from "zod";

// data/rules/injury-grade-map.json의 모양. 상해급수 후보를 찾는 데 쓴다.

const status = z.enum(["confirmed", "needs_check"]);

export const injuryGradeItemSchema = z.object({
  id: z.string(),
  grade: z.number().int().min(1).max(14),
  no: z.number().int().min(1),
  /** 별표의 상해 내용 문구 */
  text: z.string().min(1),
  /** 근거 조항 */
  basis: z.string().min(1),
  /** 약관에 인쇄된 쪽 번호 */
  page: z.number().int(),
  /** with: 수술을 한 경우, without: 수술을 하지 않은 경우, any: 수술과 상관없음 */
  surgery: z.enum(["with", "without", "any"]),
  /** "그 밖에 ○급에 해당한다고 인정되는 상해" 같은 포괄 항목 */
  catchAll: z.boolean(),
  status,
});

export const injuryGradeMapSchema = z.object({
  id: z.literal("injury-grade-map"),
  version: z.string(),
  title: z.string(),
  source: z.object({ law: z.string(), document: z.string(), pages: z.string(), guidelines: z.string() }),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveFromStatus: status,
  items: z.array(injuryGradeItemSchema).min(1),
  matching: z.object({
    status,
    note: z.string(),
    synonyms: z.record(z.string(), z.array(z.string())),
    bodyParts: z.array(z.string()),
    injuryTypes: z.array(z.string()),
  }),
});

export type InjuryGradeItem = z.infer<typeof injuryGradeItemSchema>;
export type InjuryGradeMap = z.infer<typeof injuryGradeMapSchema>;
