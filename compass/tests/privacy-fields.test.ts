import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as draftSchemas from "@/lib/draft/schema";
import * as accidentClaim from "@/lib/schemas/accident-claim";
import * as accidentFacts from "@/lib/schemas/accident-facts";
import * as injuryGradeMap from "@/lib/schemas/injury-grade-map";
import * as personClaim from "@/lib/schemas/person-claim";
import * as policyReading from "@/lib/schemas/policy-reading";
import * as rules from "@/lib/schemas/rules";
import * as vehicleClaim from "@/lib/schemas/vehicle-claim";

// 신원정보 칸을 스키마에 만들지 않는다(CLAUDE.md "개인정보와 보안"). 이름에 아래 낱말이 들어간 칸이 있으면 실패한다.
const FORBIDDEN = [
  "insuredName",
  "contractorName",
  "displayName",
  "policyholderName",
  "policyNumber",
  "vehicleNumber",
  "plateNumber",
  "rrn",
  "birthDate",
  "sex",
  "gender",
  "phone",
  "address",
  "email",
  "accountNumber",
  "cardNumber",
];

// 계획된 단계에서 없앨 칸만 예외로 둔다. 그 단계에서 칸을 없애면 이 목록에서도 지워야 테스트가 통과한다.
const PENDING: Record<string, string> = {
  "rawReadingSchema.policyNumber": "5단계: 증권 판독에서 신원 칸을 없앤다",
  "rawReadingSchema.policyholderName": "5단계",
  "rawReadingSchema.insuredName": "5단계",
  "rawReadingSchema.birthDateText": "5단계",
  "rawReadingSchema.genderText": "5단계",
  "rawReadingSchema.vehicleNumber": "5단계",
  "policyReadingSchema.policyNumber": "5단계",
  "policyReadingSchema.policyholderName": "5단계",
  "policyReadingSchema.insuredName": "5단계",
  "policyReadingSchema.birthDate": "5단계",
  "policyReadingSchema.gender": "5단계",
  "policyReadingSchema.vehicleNumber": "5단계",
  "readResponseSchema.reading.policyNumber": "5단계",
  "readResponseSchema.reading.policyholderName": "5단계",
  "readResponseSchema.reading.insuredName": "5단계",
  "readResponseSchema.reading.birthDate": "5단계",
  "readResponseSchema.reading.gender": "5단계",
  "readResponseSchema.reading.vehicleNumber": "5단계",
};

type Def = { type: string; shape?: Record<string, z.ZodType>; element?: z.ZodType; innerType?: z.ZodType; options?: z.ZodType[]; in?: z.ZodType; out?: z.ZodType; valueType?: z.ZodType; left?: z.ZodType; right?: z.ZodType; items?: z.ZodType[]; rest?: z.ZodType; getter?: () => z.ZodType };

/** 스키마 안의 모든 칸 경로("people[].birthDate")를 모은다. */
export function fieldPaths(schema: z.ZodType, path = "", seen = new Set<z.ZodType>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const def = (schema as unknown as { _zod: { def: Def } })._zod.def;
  const walk = (child: z.ZodType | undefined, at = path) => (child ? fieldPaths(child, at, seen) : []);
  switch (def.type) {
    case "object":
      return Object.entries(def.shape ?? {}).flatMap(([key, child]) => {
        const at = path ? `${path}.${key}` : key;
        return [at, ...walk(child, at)];
      });
    case "array":
      return walk(def.element, `${path}[]`);
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
      return walk(def.innerType);
    case "union":
      return (def.options ?? []).flatMap((option) => walk(option));
    case "intersection":
      return [...walk(def.left), ...walk(def.right)];
    case "pipe":
      return [...walk(def.in), ...walk(def.out)];
    case "record":
      return walk(def.valueType, `${path}{}`);
    case "tuple":
      return [...(def.items ?? []).flatMap((item) => walk(item, `${path}[]`)), ...walk(def.rest, `${path}[]`)];
    case "lazy":
      return walk(def.getter?.());
    default:
      return [];
  }
}

const leaf = (path: string) => path.split(".").at(-1)!.replace(/[[\]{}]/g, "");
const isForbidden = (path: string) => FORBIDDEN.some((name) => leaf(path).toLowerCase().includes(name.toLowerCase()));

const MODULES = { draftSchemas, accidentClaim, accidentFacts, injuryGradeMap, personClaim, policyReading, rules, vehicleClaim };

function allSchemas(): [string, z.ZodType][] {
  return Object.values(MODULES).flatMap((module) =>
    Object.entries(module).filter((entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType),
  );
}

describe("스키마에 신원정보 칸이 없다", () => {
  const found = allSchemas().flatMap(([name, schema]) => fieldPaths(schema).filter(isForbidden).map((path) => `${name}.${path}`));

  it("검사할 스키마를 빠짐없이 찾는다", () => {
    const names = allSchemas().map(([name]) => name);
    expect(names).toEqual(expect.arrayContaining(["caseDraftSchema", "personDraftSchema", "policyReadingSchema", "personClaimSchema", "accidentFactsSchema"]));
    expect(names.length).toBeGreaterThanOrEqual(20);
  });

  it("금지 이름이 들어간 칸이 없다(계획된 단계에서 없앨 칸만 예외)", () => {
    expect(found.filter((path) => !(path in PENDING))).toEqual([]);
  });

  it("예외 목록의 칸은 아직 실제로 있다(없앴으면 예외에서도 지운다)", () => {
    expect(Object.keys(PENDING).filter((path) => !found.includes(path))).toEqual([]);
  });

  it("브라우저에 저장하는 사람·증권 초안에는 이름 칸이 없다", () => {
    expect(Object.keys(draftSchemas.personDraftSchema.shape)).not.toContain("name");
    expect(fieldPaths(draftSchemas.policyDraftSchema).filter((path) => /name/i.test(leaf(path)))).toEqual(["productName", "fileName", "coverages[].name"]);
  });

  it("검사기가 금지 이름을 실제로 찾아낸다", () => {
    const sample = z.object({
      people: z.array(z.object({ label: z.string(), phoneNumber: z.string().optional() })),
      owner: z.object({ Address: z.string() }).nullable(),
      plates: z.record(z.string(), z.object({ plateNumber: z.string() })),
      cardNumber: z.string().default(""),
    });
    expect(fieldPaths(sample).filter(isForbidden)).toEqual(["people[].phoneNumber", "owner.Address", "plates{}.plateNumber", "cardNumber"]);
  });
});
