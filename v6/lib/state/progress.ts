import { loadState, saveState } from "@/lib/storage";

// 7단계 입력 화면의 진행 위치. 입력값(Claim)은 lib/claim/persist.ts가, 진행 위치는 여기서 따로 저장한다(MASTER.md 2·7장).
// 저장·읽기는 lib/storage.ts가 try/catch로 감싼다. 읽지 못하면 첫 화면부터.

const KEY = "progress";

export type Progress = { screenId: string };

const isProgress = (value: unknown): value is Progress => typeof value === "object" && value !== null && typeof (value as { screenId?: unknown }).screenId === "string";

export function loadProgress(): Progress | null {
  return loadState<Progress | null>(KEY, null, (value): value is Progress | null => value === null || isProgress(value));
}

export function saveProgress(progress: Progress): boolean {
  return saveState(KEY, progress);
}
