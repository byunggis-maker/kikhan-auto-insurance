import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_VERSION, STORAGE_KEY, loadClaim, migrate, saveClaim } from "@/lib/claim/persist";
import { emptyClaim, type Claim } from "@/lib/claim/types";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "localStorage");
});

const sample = (): Claim => ({ ...emptyClaim(), skipped: ["fault"], fault: { mode: "known", myPercent: 30 } });

describe("저장 데이터 버전 변환", () => {
  it("지금 버전으로 저장한 것을 그대로 읽는다", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(saveClaim(sample())).toBe(true);
    expect(JSON.parse(globalThis.localStorage.getItem(`kikhan-v6:${STORAGE_KEY}`) as string).version).toBe(CURRENT_VERSION);
    const result = loadClaim();
    expect(result.status).toBe("loaded");
    expect(result.claim).toEqual(sample());
  });

  it("한 단계씩 변환한다: v1 저장값을 v3까지 올린다", () => {
    const migrations = {
      1: (data: unknown) => ({ ...(data as object), skipped: [] }),
      2: (data: unknown) => ({ ...(data as object), skipped: ["v3에서 더함"] }),
    };
    const { skipped: _drop, ...v1 } = emptyClaim();
    void _drop;
    const result = migrate({ version: 1, data: v1 }, { current: 3, migrations });
    expect(result.status).toBe("migrated");
    expect(result.claim.skipped).toEqual(["v3에서 더함"]);
  });

  it.each([
    ["저장값이 없음", null, "empty"],
    ["버전이 없는 옛 모양", { accident: {} }, "not_versioned"],
    ["배열", [1, 2], "not_versioned"],
    ["버전이 숫자가 아님", { version: "1", data: {} }, "not_versioned"],
    ["앱보다 새 버전", { version: CURRENT_VERSION + 1, data: {} }, "newer_version"],
    ["모양이 맞지 않음", { version: CURRENT_VERSION, data: { accident: "깨짐" } }, "invalid_shape"],
  ])("%s → 멈추지 않고 새로 시작(%s)", (_name, raw, reason) => {
    const result = migrate(raw);
    expect(result).toEqual({ status: "fresh", claim: emptyClaim(), reason });
  });

  it("변환 함수가 없거나 예외를 던지면 새로 시작한다", () => {
    expect(migrate({ version: 1, data: {} }, { current: 2, migrations: {} })).toMatchObject({ status: "fresh", reason: "missing_migration" });
    const boom = () => {
      throw new Error("변환 실패");
    };
    expect(migrate({ version: 1, data: {} }, { current: 2, migrations: { 1: boom } })).toMatchObject({ status: "fresh", reason: "migration_failed" });
  });

  it("localStorage가 깨진 JSON이거나 접근이 막혀도 새로 시작한다", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem(`kikhan-v6:${STORAGE_KEY}`, "{깨진");
    expect(loadClaim()).toMatchObject({ status: "fresh", reason: "empty" });
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    expect(loadClaim()).toMatchObject({ status: "fresh", reason: "empty" });
    expect(saveClaim(sample())).toBe(false);
  });
});
