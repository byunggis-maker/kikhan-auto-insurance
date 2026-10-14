import { birthFromResident, findResidentNumber, isoDate, maskDeep, type ResidentParts } from "@/lib/privacy/rrn";
import { policyReadingSchema, type PolicyReading, type RawReading } from "@/lib/schemas/policy-reading";

// LLM이 채운 값을 정리한다. 여기서 주민등록번호를 생년월일·성별로 바꾸고 뒷자리를 가린다.
// 금액은 손대지 않는다.

const LIMIT = 200;

function clean(value: string | null): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim().slice(0, LIMIT) ?? "";
  return trimmed || null;
}

/** 여러 꼴로 적힌 날짜(2026.01.01, 2026-1-1, 2026년 1월 1일)를 YYYY-MM-DD로. 날짜가 아니면 null. */
export function parseDateText(value: string | null): string | null {
  const match = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(value ?? "");
  return match ? isoDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function genderFromText(value: string | null): "M" | "F" | null {
  const word = value?.trim() ?? "";
  if (/^(남|남자|남성|M|male)$/i.test(word)) return "M";
  if (/^(여|여자|여성|F|female)$/i.test(word)) return "F";
  return null;
}

/**
 * @param raw LLM의 응답(스키마 검증을 통과한 것)
 * @param fromDocument PDF 글자에서 서버가 직접 찾은 주민등록번호. 있으면 LLM의 값보다 먼저 쓴다.
 */
export function toReading(raw: RawReading, fromDocument: ResidentParts | null = null): PolicyReading {
  // LLM이 지시를 어기고 어느 칸에든 주민등록번호를 적었을 수 있다. 가리기 전에 생년월일·성별을 뽑는다.
  const leaked = findResidentNumber(JSON.stringify(raw));
  const resident =
    birthFromResident(fromDocument?.front6 ?? null, fromDocument?.backFirst ?? null) ??
    birthFromResident(raw.residentFront6?.trim() ?? null, raw.residentBackFirst?.trim() ?? null) ??
    birthFromResident(leaked?.front6 ?? null, leaked?.backFirst ?? null);

  const reading: PolicyReading = {
    insurer: clean(raw.insurer),
    productName: clean(raw.productName),
    productLine: raw.productLine,
    policyNumber: clean(raw.policyNumber),
    periodStart: parseDateText(raw.periodStart),
    periodEnd: parseDateText(raw.periodEnd),
    policyholderName: clean(raw.policyholderName),
    insuredName: clean(raw.insuredName),
    birthDate: resident?.birthDate ?? parseDateText(raw.birthDateText),
    gender: resident?.gender ?? genderFromText(raw.genderText),
    vehicleNumber: clean(raw.vehicleNumber),
    vehicleModel: clean(raw.vehicleModel),
    driverScope: clean(raw.driverScope),
    driverAgeLimit: clean(raw.driverAgeLimit),
    coverages: raw.coverages
      .map((coverage) => ({
        name: clean(coverage.name),
        limit: clean(coverage.limit),
        // ""는 "자기부담금 없음", null은 "읽지 못함"이다.
        deductible: coverage.deductible === null ? null : (clean(coverage.deductible) ?? ""),
      }))
      .filter((coverage) => coverage.name || coverage.limit)
      .slice(0, 60),
    riders: raw.riders
      .map((rider) => clean(rider))
      .filter((rider): rider is string => !!rider)
      .slice(0, 80),
  };
  // 마지막에 모든 문자열에서 주민등록번호 꼴을 한 번 더 가린다.
  return policyReadingSchema.parse(maskDeep(reading));
}
