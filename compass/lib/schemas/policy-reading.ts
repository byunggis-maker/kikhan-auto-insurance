import { z } from "zod";

// 증권·가입증명서 판독 결과의 모양.
// 금액은 숫자로 바꾸지 않는다. 증권에 적힌 표현 그대로 둔다(원 단위 변환은 lib/engine/money.ts의 일).
// 신원 칸(이름·주민번호·생년월일·성별·증권번호·차량번호·주소·연락처)은 두지 않는다(v2 5단계). 보험 정보만 읽는다.

export const PRODUCT_LINES = ["personal", "business", "commercial", "motorcycle"] as const;

const text = z.string().nullable();

/** 비전 LLM이 채우는 모양. 못 읽은 칸은 null. */
export const rawReadingSchema = z.object({
  insurer: text.describe("보험회사 이름"),
  productName: text.describe("상품 이름. 문서에 적힌 그대로"),
  productLine: z.enum(PRODUCT_LINES).nullable().describe("개인용 personal, 업무용 business, 영업용 commercial, 이륜자동차 motorcycle. 문서로 알 수 없으면 null"),
  periodStart: text.describe("보험 시작일. YYYY-MM-DD"),
  periodEnd: text.describe("보험 종료일. YYYY-MM-DD"),
  vehicleModel: text.describe("차종·차명"),
  driverScope: text.describe("운전자 범위. 예: 부부한정, 가족한정, 누구나"),
  driverAgeLimit: text.describe("운전자 연령 한정. 적힌 그대로"),
  coverages: z
    .array(
      z.object({
        name: text.describe("담보 이름. 적힌 그대로"),
        limit: text.describe("가입금액·보상한도. 적힌 표현 그대로, 숫자로 바꾸지 않는다"),
        deductible: text.describe('자기부담금. 적힌 그대로. 이 담보에 자기부담금이 없으면 빈 문자열 "", 있는데 읽지 못했으면 null'),
      }),
    )
    .describe("가입한 담보만. 미가입으로 적힌 담보는 넣지 않는다"),
  riders: z.array(z.string()).describe("가입한 특약 이름 목록"),
});
export type RawReading = z.infer<typeof rawReadingSchema>;

const short = z.string().max(200).nullable();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

/** 서버가 정리해 화면으로 돌려주는 모양. 보험 정보만 있다(모르는 칸이 있으면 거절). */
export const policyReadingSchema = z.strictObject({
  insurer: short,
  productName: short,
  productLine: z.enum(PRODUCT_LINES).nullable(),
  periodStart: date,
  periodEnd: date,
  vehicleModel: short,
  driverScope: short,
  driverAgeLimit: short,
  coverages: z.array(z.strictObject({ name: short, limit: short, deductible: short })).max(60),
  riders: z.array(z.string().max(200)).max(80),
});
export type PolicyReading = z.infer<typeof policyReadingSchema>;

export const readResponseSchema = z.strictObject({
  reading: policyReadingSchema,
  /** 어떤 방법으로 읽었는지: PDF 글자, PDF 스캔본 그림, 사진 */
  source: z.enum(["pdf-text", "pdf-scan", "image"]),
  /** 서버가 가린 개인정보 건수(PDF 글자와 판독 결과). 가린 값은 싣지 않는다 */
  redacted: z.number().int().min(0),
});
export type ReadResponse = z.infer<typeof readResponseSchema>;
