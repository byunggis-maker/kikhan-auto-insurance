import { loadState, saveState } from "@/lib/storage";
import { claimSchema, emptyClaim, type Claim } from "./types";

// localStorage에 저장한 사고 입력의 버전 관리. 저장 모양이 바뀌면 CURRENT_VERSION을 올리고 MIGRATIONS에 한 단계 변환을 더한다.
// 어떤 이유로든 읽지 못하면(없음·깨짐·모르는 버전·변환 실패·모양 불일치) 앱을 멈추지 않고 빈 입력으로 새로 시작한다.

export const STORAGE_KEY = "claim";
export const CURRENT_VERSION = 1;

/** 저장하는 모양: 버전과 데이터를 함께 둔다 */
export type Saved = { version: number; data: unknown };

/** n → n + 1 한 단계 변환. 키는 변환 전 버전 */
export type Migration = (data: unknown) => unknown;
export const MIGRATIONS: Record<number, Migration> = {};

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
