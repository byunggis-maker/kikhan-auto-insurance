"use client";

import { useEffect, useState } from "react";
import { CONSENT_VERSIONS, type ConsentKind, type ConsentState } from "./consent-versions";

// 동의 기록은 서버가 아니라 이 브라우저에만 둔다.
export { CONSENT_VERSIONS, type ConsentKind, type ConsentState };

export const CONSENT_KEY = "kc2.consent";
const KEY = CONSENT_KEY;
const EVENT = "kc2-consent";

export type ConsentStorage = Pick<Storage, "getItem" | "setItem">;

type Stored = Partial<Record<ConsentKind, { version: string; at: string }>>;

function browserStorage(): ConsentStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStored(storage: ConsentStorage | null): Stored {
  try {
    const value: unknown = JSON.parse(storage?.getItem(KEY) ?? "{}");
    return value && typeof value === "object" ? (value as Stored) : {};
  } catch {
    return {};
  }
}

/**
 * 사용자가 지금 문안 버전에 직접 동의해 저장한 것만 동의로 본다. 기록이 없거나 깨졌거나 옛 버전이면 동의하지 않은 것이다.
 * 동의 화면의 체크박스는 이 값으로만 처음 상태를 정한다. 미리 체크해 두지 않는다(법적으로 사용자가 직접 체크해야 한다).
 */
export function readConsent(storage: ConsentStorage | null = browserStorage()): ConsentState {
  const stored = readStored(storage);
  return {
    service: stored.service?.version === CONSENT_VERSIONS.service,
    health: stored.health?.version === CONSENT_VERSIONS.health,
  };
}

/** 동의·철회를 저장한다. 저장하지 못하면(사생활 보호 모드 등) false. */
export function saveConsent(next: ConsentState, now = new Date(), storage: ConsentStorage | null = browserStorage()): boolean {
  const stored: Stored = {};
  for (const kind of Object.keys(CONSENT_VERSIONS) as ConsentKind[]) {
    if (next[kind] === true) stored[kind] = { version: CONSENT_VERSIONS[kind], at: now.toISOString() };
  }
  if (!storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify(stored));
  } catch {
    return false;
  }
  notifyConsentChanged();
  return true;
}

/** 동의 기록이 바뀌었음을 이 탭의 화면에 알린다(모두 지우기 뒤에도 쓴다). */
export function notifyConsentChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** 이 브라우저의 동의 상태. undefined: 아직 읽는 중(첫 그리기) */
export function useConsent() {
  const [state, setState] = useState<ConsentState | undefined>(undefined);
  useEffect(() => {
    const load = () => setState(readConsent());
    load();
    window.addEventListener(EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);
  return state;
}

/** 동의 뒤에 돌아갈 주소. 앱 안의 단계 화면만 허용한다(바깥 주소로 보내지 않는다). */
export function safeNext(next: string | null | undefined): string | null {
  return next && /^\/cases\/[0-9a-f-]{36}\/(policy|accident|people|result)$/.test(next) ? next : null;
}
