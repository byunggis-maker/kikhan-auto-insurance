"use client";

import { useCallback, useSyncExternalStore } from "react";
import { deleteDraft, draftKey, listDrafts, newDraft, parseDraft, saveDraft } from "./store";
import type { CaseDraft } from "./types";

// 입력을 고칠 때마다 이 기기의 브라우저 저장소에 바로 쓴다. 새로고침해도 남는다.
// 서버에는 아무것도 보내지 않는다.

const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // 다른 탭에서 고친 내용도 반영한다.
  const onStorage = () => {
    version++;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// 저장소를 쓸 수 없는 브라우저(사생활 보호 모드 등)에서도 화면은 떠야 한다.
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const draftCache = new Map<string, { raw: string | null; value: CaseDraft | null }>();

function draftSnapshot(id: string): CaseDraft | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(draftKey(id)) ?? null;
  } catch {
    raw = null;
  }
  const cached = draftCache.get(id);
  if (cached && cached.raw === raw) return cached.value;
  const value = parseDraft(raw);
  draftCache.set(id, { raw, value });
  return value;
}

let listCache: { version: number; value: CaseDraft[] } = { version: -1, value: [] };

function listSnapshot(): CaseDraft[] {
  if (listCache.version === version) return listCache.value;
  let value: CaseDraft[] = [];
  try {
    const store = storage();
    if (store) value = listDrafts(store);
  } catch {
    value = [];
  }
  listCache = { version, value };
  return value;
}

/** undefined: 아직 불러오는 중(서버 렌더링), null: 기록 없음 */
export function useCaseDraft(id: string) {
  const draft = useSyncExternalStore<CaseDraft | null | undefined>(
    subscribe,
    () => draftSnapshot(id),
    () => undefined,
  );
  const update = useCallback(
    (change: (current: CaseDraft) => CaseDraft) => {
      const current = draftSnapshot(id);
      const store = storage();
      if (!current || !store) return;
      try {
        saveDraft(store, { ...change(current), id, updatedAt: new Date().toISOString() });
      } catch {
        // 저장 공간이 가득 찬 경우 등. 화면 입력은 유지되지 않으므로 다음 단계에서 안내를 붙인다.
      }
      emit();
    },
    [id],
  );
  return { draft, update };
}

/** undefined: 아직 불러오는 중 */
export function useCaseList() {
  return useSyncExternalStore<CaseDraft[] | undefined>(subscribe, listSnapshot, () => undefined);
}

export function createCase(): string | null {
  const store = storage();
  if (!store) return null;
  const id = crypto.randomUUID();
  try {
    saveDraft(store, newDraft(id, new Date().toISOString()));
  } catch {
    return null;
  }
  emit();
  return id;
}

export function removeCase(id: string) {
  const store = storage();
  if (!store) return;
  deleteDraft(store, id);
  emit();
}

/** 동의 뒤·"바로 시작하기"의 도착점. 쓰던 사고 기록이 있으면 그 기록을, 없으면 새 기록을 연다. 저장소를 쓸 수 없으면 null */
export function openWorkingCase(): string | null {
  const store = storage();
  if (!store) return null;
  return listDrafts(store)[0]?.id ?? createCase();
}
