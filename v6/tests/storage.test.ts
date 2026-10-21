import { afterEach, describe, expect, it, vi } from "vitest";
import { loadState, removeState, saveState } from "@/lib/storage";

// localStorage는 실패할 수 있다(사생활 보호 창·공간 부족·차단·서버 렌더링). 어떤 경우에도 예외가 밖으로 나오지 않아야 한다.

function memoryStorage(overrides: Partial<Storage> = {}): Storage {
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
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("localStorage 헬퍼", () => {
  it("저장한 값을 그대로 읽는다", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(saveState("progress", { step: 3, skipped: ["fault"] })).toBe(true);
    expect(loadState("progress", null)).toEqual({ step: 3, skipped: ["fault"] });
    expect(globalThis.localStorage.getItem("kikhan-v6:progress")).not.toBeNull();
    expect(removeState("progress")).toBe(true);
    expect(loadState("progress", "없음")).toBe("없음");
  });

  it("localStorage가 없으면(서버 렌더링) 기본값과 false", () => {
    expect(loadState("progress", 1)).toBe(1);
    expect(saveState("progress", 2)).toBe(false);
    expect(removeState("progress")).toBe(false);
  });

  it("접근 자체가 예외를 던져도(차단된 사이트 데이터) 멈추지 않는다", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    expect(loadState("progress", 1)).toBe(1);
    expect(saveState("progress", 2)).toBe(false);
    expect(removeState("progress")).toBe(false);
  });

  it("읽기·쓰기·지우기가 예외를 던져도(공간 부족 등) 기본값과 false", () => {
    const fail = () => {
      throw new Error("QuotaExceededError");
    };
    vi.stubGlobal("localStorage", memoryStorage({ getItem: fail, setItem: fail, removeItem: fail }));
    expect(loadState("progress", 1)).toBe(1);
    expect(saveState("progress", 2)).toBe(false);
    expect(removeState("progress")).toBe(false);
  });

  it("깨진 JSON이나 모양이 맞지 않는 예전 값은 기본값으로", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem("kikhan-v6:broken", "{not json");
    expect(loadState("broken", 0)).toBe(0);
    storage.setItem("kikhan-v6:old", JSON.stringify({ step: "셋" }));
    const isProgress = (value: unknown): value is { step: number } => typeof value === "object" && value !== null && typeof (value as { step?: unknown }).step === "number";
    expect(loadState("old", { step: 1 }, isProgress)).toEqual({ step: 1 });
  });

  it("순환 참조처럼 JSON으로 바꿀 수 없는 값은 저장하지 못했다고 알린다", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(saveState("loop", loop)).toBe(false);
  });
});
