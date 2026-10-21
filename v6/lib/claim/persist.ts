import { loadState, saveState } from "@/lib/storage";
import { claimSchema, emptyClaim, type Claim } from "./types";

// localStorage에 저장한 사고 입력의 버전 관리. 저장 모양이 바뀌면 CURRENT_VERSION을 올리고 MIGRATIONS에 한 단계 변환을 더한다.
// 어떤 이유로든 읽지 못하면(없음·깨짐·모르는 버전·변환 실패·모양 불일치) 앱을 멈추지 않고 빈 입력으로 새로 시작한다.

export const STORAGE_KEY = "claim";
export const CURRENT_VERSION = 6;

/** 저장하는 모양: 버전과 데이터를 함께 둔다 */
export type Saved = { version: number; data: unknown };

/** n → n + 1 한 단계 변환. 키는 변환 전 버전 */
export type Migration = (data: unknown) => unknown;
export const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2(라운드 2): 사고 사실에 운전자 관계(driverRelation)를 더했다. 예전 저장값은 "모름"(null)으로 채운다.
  1: (data) => {
    const claim = data as { accident?: { violations?: Record<string, unknown> } };
    return { ...claim, accident: { ...claim.accident, violations: { ...claim.accident?.violations, driverRelation: null } } };
  },
  // v2 → v3(라운드 3): 사람 카드에 입원·통원·휴업일수, 식사 끼니 수, 월소득을 더했다. 예전 저장값은 "모름"(null)으로 채운다.
  2: (data) => {
    const claim = data as { victims?: Record<string, unknown>[] };
    const fill = { hospitalDays: null, outpatientDays: null, mealsNotProvided: null, daysOffWork: null, monthlyIncome: null };
    return { ...claim, victims: (claim.victims ?? []).map((victim) => ({ ...fill, ...victim })) };
  },
  // v3 → v4(라운드 4): 사람 카드에 소득 증명 가능 여부(incomeProven)를 더했다. 예전 저장값은 "모름"(null)
  3: (data) => {
    const claim = data as { victims?: Record<string, unknown>[] };
    return { ...claim, victims: (claim.victims ?? []).map((victim) => ({ incomeProven: null, ...victim })) };
  },
  // v4 → v5(라운드 5 전): 사람 카드에 휴업손해 직업 구분(occupation)을 더했다. 예전 저장값은 "모름"(null)
  4: (data) => {
    const claim = data as { victims?: Record<string, unknown>[] };
    return { ...claim, victims: (claim.victims ?? []).map((victim) => ({ occupation: null, ...victim })) };
  },
  // v5 → v6(라운드 6): 사람 카드에 월소득 금액 증명 가능 여부(incomeAmountProven)를 더했다. 예전 저장값은 "모름"(null)
  5: (data) => {
    const claim = data as { victims?: Record<string, unknown>[] };
    return { ...claim, victims: (claim.victims ?? []).map((victim) => ({ incomeAmountProven: null, ...victim })) };
  },
};

export type LoadResult =
  | { status: "loaded"; claim: Claim; from: number }
  | { status: "migrated"; claim: Claim; from: number }
  | { status: "fresh"; claim: Claim; reason: FreshReason };

export type FreshReason = "empty" | "not_versioned" | "newer_version" | "missing_migration" | "migration_failed" | "invalid_shape";

type Options = { current?: number; migrations?: Record<number, Migration> };

/** 저장값 하나를 지금 버전의 Claim으로 바꾼다. 실패하면 이유와 함께 빈 입력 */
export function migrate(raw: unknown, options: Options = {}): LoadResult {
  const current = options.current ?? CURRENT_VERSION;
  const migrations = options.migrations ?? MIGRATIONS;
  const fresh = (reason: FreshReason): LoadResult => ({ status: "fresh", claim: emptyClaim(), reason });

  if (raw === null || raw === undefined) return fresh("empty");
  if (typeof raw !== "object" || Array.isArray(raw)) return fresh("not_versioned");
  const { version, data } = raw as Partial<Saved>;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return fresh("not_versioned");
  if (version > current) return fresh("newer_version");

  let value = data;
  for (let from = version; from < current; from++) {
    const step = migrations[from];
    if (!step) return fresh("missing_migration");
    try {
      value = step(value);
    } catch {
      return fresh("migration_failed");
    }
  }
  const parsed = claimSchema.safeParse(value);
  if (!parsed.success) return fresh("invalid_shape");
  return version === current ? { status: "loaded", claim: parsed.data, from: version } : { status: "migrated", claim: parsed.data, from: version };
}

/** 이 브라우저에 저장한 입력을 읽는다. 읽지 못하면 빈 입력 */
export function loadClaim(): LoadResult {
  return migrate(loadState<unknown>(STORAGE_KEY, null));
}

/** 지금 버전으로 저장한다. 저장하지 못하면(공간 부족·차단) false */
export function saveClaim(claim: Claim): boolean {
  const saved: Saved = { version: CURRENT_VERSION, data: claim };
  return saveState(STORAGE_KEY, saved);
}
