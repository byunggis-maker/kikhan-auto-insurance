import { afterEach, describe, expect, it, vi } from "vitest";
import { checklistKey, clearChecked, loadChecked, saveChecked } from "@/lib/state/checklist";

// 라운드 6b 지시 3: 필요 서류 체크 상태 저장. 저장이 실패해도 예외 없이 동작한다.

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, clear: () => data.clear(), getItem: (k) => data.get(k) ?? null, key: (i) => [...data.keys()][i] ?? null, removeItem: (k) => void data.delete(k), setItem: (k, v) => void data.set(k, v) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("필요 서류 체크 저장", () => {
  const key = checklistKey("상대 보험", "대인배상Ⅰ", "보험금 청구서");

  it("저장하고 다시 읽고, 초기화하면 비운다", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(saveChecked([key])).toBe(true);
    expect(loadChecked()).toEqual([key]);
    expect(clearChecked()).toBe(true);
    expect(loadChecked()).toEqual([]);
  });

  it("저장소가 예외를 던져도(공간 부족·차단) 멈추지 않고 false/빈 목록", () => {
    vi.stubGlobal("localStorage", { ...memoryStorage(), setItem: () => { throw new Error("QuotaExceededError"); }, getItem: () => { throw new Error("SecurityError"); }, removeItem: () => { throw new Error("SecurityError"); } });
    expect(saveChecked([key])).toBe(false);
    expect(loadChecked()).toEqual([]);
    expect(clearChecked()).toBe(false);
  });

  it("모양이 다른 저장값(깨진 값)은 무시한다", () => {
    const storage = memoryStorage();
    storage.setItem("kikhan-v6:checklist", JSON.stringify({ a: 1 }));
    vi.stubGlobal("localStorage", storage);
    expect(loadChecked()).toEqual([]);
  });
});
