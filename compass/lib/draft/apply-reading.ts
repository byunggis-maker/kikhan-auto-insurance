import type { PolicyReading } from "@/lib/schemas/policy-reading";
import { newCoverage, standardCoverages } from "./store";
import type { CoverageDraft, PolicyDraft } from "./types";

// 자동 읽기 결과를 입력 초안에 옮긴다. 읽지 못한 칸은 비워 두고 unread에 이름을 적는다.
// 판독 결과에 신원 칸(이름·증권번호·차량번호·생년월일·성별)이 있어도 옮기지 않는다(v2).

const TEXT_FIELDS = [
  "insurer",
  "productName",
  "periodStart",
  "periodEnd",
  "vehicleModel",
  "driverScope",
  "driverAgeLimit",
] as const;

/** 같은 담보인지 견줄 때 쓰는 꼴: 빈칸을 없애고 로마 숫자 표기를 맞춘다. */
const plain = (name: string) => name.replace(/\s/g, "").replace(/Ⅰ/g, "I").replace(/Ⅱ/g, "II").toUpperCase();

export function applyReading(policy: PolicyDraft, reading: PolicyReading, newId: () => string): PolicyDraft {
  const unread: string[] = [];
  const next: PolicyDraft = { ...policy, riders: reading.riders };
  for (const field of TEXT_FIELDS) {
    const value = reading[field];
    next[field] = value ?? "";
    if (value === null) unread.push(field);
  }
  next.productLine = reading.productLine ?? "";
  if (reading.productLine === null) unread.push("productLine");

  const read: CoverageDraft[] = reading.coverages.map((coverage) => {
    const missing = (["name", "limit", "deductible"] as const).filter((key) => coverage[key] === null);
    return {
      id: newId(),
      name: coverage.name ?? "",
      joined: true,
      limit: coverage.limit ?? "",
      deductible: coverage.deductible ?? "",
      ...(missing.length ? { unread: missing } : {}),
    };
  });
  // 증권에서 읽히지 않은 기본 담보는 "미가입"으로 남겨 사용자가 직접 켤 수 있게 한다.
  const seen = new Set(read.map((coverage) => plain(coverage.name)));
  const rest = standardCoverages()
    .filter((coverage) => !seen.has(plain(coverage.name)))
    .map((coverage) => ({ ...newCoverage(newId(), coverage.name) }));
  if (read.length === 0) unread.push("coverages");

  return { ...next, coverages: [...read, ...rest], unread };
}
