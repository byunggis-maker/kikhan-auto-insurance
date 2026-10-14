import { z } from "zod";
import type { CaseDraft } from "./types";

// 브라우저 저장소에서 읽은 초안을 검증하는 스키마다. 모르는 칸이 있으면(신원 칸 포함) 통째로 거절한다(strict).
// 칸이 빠져 있으면 빈 값으로 채운다. 이전 단계에서 저장한 초안에 나중에 생긴 칸이 없을 수 있어서다.
// tests/privacy-fields.test.ts가 이 스키마의 칸 이름에서 신원정보 이름을 찾는다.

const text = z.string().max(20_000).default("");
const amount = z.number().nullable().default(null);
const flag = z.boolean().nullable().default(null);
const names = z.array(z.string().max(200)).max(200).default([]);

export const coverageDraftSchema = z.strictObject({
  id: z.string().min(1).max(100),
  name: text,
  joined: z.boolean().default(false),
  limit: text,
  deductible: text,
  unread: z.array(z.enum(["name", "limit", "deductible"])).optional(),
});

export const policyDraftSchema = z.strictObject({
  insurer: text,
  productName: text,
  productLine: z.enum(["personal", "business", "commercial", "motorcycle", ""]).default(""),
  periodStart: text,
  periodEnd: text,
  vehicleModel: text,
  driverScope: text,
  driverAgeLimit: text,
  riders: names,
  unread: names,
  fileName: z.string().max(500).nullable().default(null),
  coverages: z.array(coverageDraftSchema).max(100),
});

export const accidentDraftSchema = z.strictObject({
  date: text,
  time: text,
  place: text,
  kind: z.enum(["car_car", "car_person", "single", "motorcycle", ""]).default(""),
  text,
  counterpartyInsurance: z.enum(["full", "mandatory_only", "none", "hit_and_run", "unknown", ""]).default(""),
  counterpartyBodily2Limit: text,
  counterpartyPropertyLimit: text,
  inferred: names,
});

export const personDraftSchema = z.strictObject({
  id: z.string().min(1).max(100),
  role: z.enum(["driver", "passenger", "counterparty", "pedestrian"]),
  injury: text,
  diagnosis: text,
  injuryGrade: z.number().int().min(1).max(14).nullable().default(null),
  inferred: names,
  surgery: flag,
  hospitalDays: amount,
  outpatientDays: amount,
  treatmentCost: amount,
  daysOffWork: amount,
  /** 사고일의 만 나이. 3단계까지의 초안에 있던 생년월일(birthDate)은 읽을 때 만 나이로 바꾼다(lib/draft/store.ts). */
  age: z.number().int().min(0).max(120).nullable().default(null),
  disabilityPercent: z.number().int().min(0).max(100).nullable().default(null),
  disabilityGrade: z.number().int().min(1).max(14).nullable().default(null),
  deathDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(""),
  occupation: text,
  monthlyIncome: amount,
  faultPercent: amount,
});

export const vehicleDraftSchema = z.strictObject({
  damage: text,
  repairCost: amount,
  rentalDays: amount,
  rented: flag,
  rentalDailyRate: amount,
  valueAtAccident: amount,
  firstRegisteredOn: text,
  vehicleClass: z.enum(["small", "mid", "large", "xlarge", "multi", ""]).default(""),
});

export const caseDraftSchema = z.strictObject({
  id: z.string().min(1).max(100),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  policy: policyDraftSchema,
  accident: accidentDraftSchema,
  people: z.array(personDraftSchema).max(50),
  vehicle: vehicleDraftSchema,
});

// 스키마와 types.ts의 모양이 어긋나면 타입 검사에서 걸린다.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameShape: Same<z.output<typeof caseDraftSchema>, CaseDraft> = true;
void sameShape;
