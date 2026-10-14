import { isoDate } from "@/lib/privacy/rrn";
import { redactDeep } from "@/lib/privacy/redact";
import { policyReadingSchema, type PolicyReading, type RawReading } from "@/lib/schemas/policy-reading";

// LLM이 채운 값을 정리한다. 마지막에 모든 문자열을 lib/privacy/redact.ts로 한 번 더 거른다
// (LLM이 지시를 어기고 담보 원문 같은 칸에 번호·이름을 적었을 수 있다). 금액은 손대지 않는다.

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

/** @param raw LLM의 응답(스키마 검증을 통과한 것). 스키마에 없는 칸은 검증에서 이미 버려졌다. */
export function toReading(raw: RawReading): { reading: PolicyReading; redacted: number } {
  const reading: PolicyReading = {
    insurer: clean(raw.insurer),
    productName: clean(raw.productName),
    productLine: raw.productLine,
    periodStart: parseDateText(raw.periodStart),
    periodEnd: parseDateText(raw.periodEnd),
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
  const { value, count } = redactDeep(reading);
  return { reading: policyReadingSchema.parse(value), redacted: count };
}
