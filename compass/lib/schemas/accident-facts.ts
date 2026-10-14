import { z } from "zod";

// 사고 설명(말·글)에서 뽑은 사실의 모양. 금액 계산에 쓰는 값은 사용자가 확인한 뒤에만 쓴다.
// 사람은 역할로만 가린다. 이름이나 사람을 가리키는 말(label)은 받지 않는다(v2 6단계).

export const ACCIDENT_KINDS = ["car_car", "car_person", "single", "motorcycle"] as const;
export const PERSON_ROLES = ["driver", "passenger", "counterparty", "pedestrian"] as const;
export const ACCIDENT_FIELDS = ["date", "time", "place", "kind", "vehicleDamage"] as const;
export const PERSON_FIELDS = ["role", "injury", "diagnosis", "surgery", "hospitalDays", "outpatientDays", "faultPercent", "occupation", "age"] as const;

const text = z.string().nullable();

/** LLM이 채우는 모양. 말하지 않은 칸은 null. */
export const rawFactsSchema = z.object({
  accident: z.object({
    date: text.describe("사고 날짜. YYYY-MM-DD. 말하지 않았으면 null"),
    time: text.describe("사고 시각. 24시간제 HH:MM. 말하지 않았으면 null"),
    place: text.describe("사고 장소. 말한 그대로"),
    kind: z.enum(ACCIDENT_KINDS).nullable().describe("차대차 car_car, 차대사람 car_person, 단독사고 single, 이륜차가 관련된 사고 motorcycle"),
    vehicleDamage: text.describe("차량 피해 내용. 말한 그대로. 금액은 말한 표현 그대로 둔다"),
    inferred: z.array(z.enum(ACCIDENT_FIELDS)).describe("위 칸 중 말한 그대로가 아니라 문맥으로 짐작해 채운 칸의 이름"),
  }),
  people: z.array(
    z.object({
      role: z.enum(PERSON_ROLES).describe("말하는 사람 쪽 차의 운전자 driver, 그 차의 동승자 passenger, 상대 차에 탄 사람 counterparty, 보행자 pedestrian"),
      injury: text.describe("다친 내용. 말한 그대로 짧게"),
      diagnosis: text.describe("진단명. 병원에서 들었다고 말한 병명만"),
      surgery: z.boolean().nullable().describe("수술 여부. 말하지 않았으면 null"),
      hospitalStay: text.describe('입원 기간. 숫자와 단위로 적는다(예: "3일", "2주"). 입원하지 않았다고 말했으면 "0일"'),
      outpatientVisits: text.describe('통원 기간이나 횟수. 숫자와 단위로 적는다(예: "5일", "3주", "4회")'),
      faultPercent: z.number().int().nullable().describe("이 사람 쪽 과실비율(%). 숫자로 말한 경우에만"),
      occupation: text.describe("직업"),
      age: z.number().int().nullable().describe("나이. 숫자로 말한 경우에만. 말하지 않았으면 null"),
      inferred: z.array(z.enum(PERSON_FIELDS)).describe("위 칸 중 말한 그대로가 아니라 문맥으로 짐작해 채운 칸의 이름"),
    }),
  ),
});
export type RawFacts = z.infer<typeof rawFactsSchema>;

const short = z.string().max(300).nullable();
const days = z.number().int().min(0).max(3650).nullable();

/** 서버가 정리해 화면으로 돌려주는 모양. */
export const accidentFactsSchema = z.object({
  accident: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable(),
    place: short,
    kind: z.enum(ACCIDENT_KINDS).nullable(),
    vehicleDamage: short,
    inferred: z.array(z.enum(ACCIDENT_FIELDS)),
  }),
  people: z
    .array(
      z.object({
        role: z.enum(PERSON_ROLES),
        injury: short,
        diagnosis: short,
        surgery: z.boolean().nullable(),
        hospitalDays: days,
        outpatientDays: days,
        faultPercent: z.number().int().min(0).max(100).nullable(),
        occupation: short,
        age: z.number().int().min(0).max(120).nullable(),
        inferred: z.array(z.enum(PERSON_FIELDS)),
      }),
    )
    .max(20),
});
export type AccidentFacts = z.infer<typeof accidentFactsSchema>;
