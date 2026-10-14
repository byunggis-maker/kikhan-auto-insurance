import { z } from "zod";

// 사고 설명(말·글)에서 뽑은 사실의 모양. 금액 계산에 쓰는 값은 사용자가 확인한 뒤에만 쓴다.
// 사람은 역할로만 가린다. 이름이나 사람을 가리키는 말(label)은 받지 않는다(v2 6단계).

export const ACCIDENT_KINDS = ["car_car", "car_person", "single", "motorcycle", "parked"] as const;
export const PERSON_ROLES = ["driver", "passenger", "counterparty", "pedestrian"] as const;
/** 말하는 사람과의 관계. 이름 대신 쓴다. */
export const PERSON_RELATIONS = ["self", "family", "passenger", "counterparty", "pedestrian"] as const;
/** 입원·통원 여부 */
export const PERSON_CARES = ["hospital", "outpatient", "both", "none"] as const;
export const ACCIDENT_FIELDS = [
  "date",
  "time",
  "place",
  "kind",
  "vehicleDamage",
  "myDriver",
  "counterpartyExists",
  "faultStatement",
  "policeReport",
  "insuranceReport",
] as const;
export const PERSON_FIELDS = ["role", "relation", "injury", "diagnosis", "surgery", "care", "hospitalDays", "outpatientDays", "faultPercent", "occupation", "age"] as const;

const text = z.string().nullable();

/** LLM이 채우는 모양. 말하지 않은 칸은 null. */
export const rawFactsSchema = z.object({
  accident: z.object({
    date: text.describe("사고 날짜. YYYY-MM-DD. 말하지 않았으면 null"),
    time: text.describe("사고 시각. 24시간제 HH:MM. 말하지 않았으면 null"),
    place: text.describe("사고 장소. 말한 그대로"),
    kind: z.enum(ACCIDENT_KINDS).nullable().describe("차대차 car_car, 차대사람 car_person, 단독사고 single, 이륜차가 관련된 사고 motorcycle, 주차해 둔 내 차를 받힌 사고 parked"),
    vehicleDamage: text.describe("내 차의 파손 부위·피해 내용. 말한 그대로. 금액은 말한 표현 그대로 둔다"),
    myDriver: text.describe('내 차를 운전한 사람. 이름이 아니라 관계로만 적는다(예: "본인", "아내", "아들"). 주차 중이었으면 "주차 중(운전자 없음)"'),
    counterpartyExists: z.boolean().nullable().describe("상대방(상대 차·보행자 등)이 있었는지. 말하지 않았으면 null"),
    faultStatement: text.describe('과실에 관한 말. 말한 그대로 짧게(예: "신호 대기 중 뒤차가 추돌", "상대가 중앙선 침범")'),
    policeReport: z.boolean().nullable().describe("경찰에 신고했는지. 말하지 않았으면 null"),
    insuranceReport: z.boolean().nullable().describe("보험사에 사고 접수했는지. 말하지 않았으면 null"),
    inferred: z.array(z.enum(ACCIDENT_FIELDS)).describe("위 칸 중 말한 그대로가 아니라 문맥으로 짐작해 채운 칸의 이름"),
  }),
  people: z.array(
    z.object({
      role: z.enum(PERSON_ROLES).describe("말하는 사람 쪽 차의 운전자 driver, 그 차의 동승자 passenger, 상대 차에 탄 사람 counterparty, 보행자 pedestrian"),
      relation: z.enum(PERSON_RELATIONS).nullable().describe("말하는 사람과의 관계. 본인 self, 가족 family, 가족이 아닌 동승자 passenger, 상대방 counterparty, 보행자 pedestrian"),
      injury: text.describe("다친 부위와 내용. 말한 그대로 짧게"),
      diagnosis: text.describe("진단명. 병원에서 들었다고 말한 병명만"),
      surgery: z.boolean().nullable().describe("수술 여부. 말하지 않았으면 null"),
      care: z.enum(PERSON_CARES).nullable().describe("입원 hospital, 통원 outpatient, 입원과 통원 둘 다 both, 치료받지 않음 none. 말하지 않았으면 null"),
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
    myDriver: short,
    counterpartyExists: z.boolean().nullable(),
    faultStatement: short,
    policeReport: z.boolean().nullable(),
    insuranceReport: z.boolean().nullable(),
    inferred: z.array(z.enum(ACCIDENT_FIELDS)),
  }),
  people: z
    .array(
      z.object({
        role: z.enum(PERSON_ROLES),
        relation: z.enum(PERSON_RELATIONS).nullable(),
        injury: short,
        diagnosis: short,
        surgery: z.boolean().nullable(),
        care: z.enum(PERSON_CARES).nullable(),
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
