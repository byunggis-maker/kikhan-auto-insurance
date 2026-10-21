import { loadState, removeState, saveState } from "@/lib/storage";

// 7단계 필요 서류 체크리스트에서 사용자가 체크한 서류. 이 브라우저의 localStorage에만 저장한다(라운드 6b 지시 3).
// 읽기·쓰기는 lib/storage.ts가 try/catch로 감싼다. 저장이 실패해도 체크는 화면에서 그대로 동작한다(새로고침하면 사라질 뿐).

const KEY = "checklist";

/** 서류 하나를 가리키는 키: 받을 곳 · 담보 · 서류 이름 */
export const checklistKey = (payer: string, coverage: string, label: string) => `${payer}|${coverage}|${label}`;

const isKeys = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

export function loadChecked(): string[] {
  return loadState<string[]>(KEY, [], isKeys);
}

/** 저장했으면 true, 못 했으면(사생활 보호 창·공간 부족 등) false */
export function saveChecked(keys: string[]): boolean {
  return saveState(KEY, keys);
}

export function clearChecked(): boolean {
  return removeState(KEY);
}
