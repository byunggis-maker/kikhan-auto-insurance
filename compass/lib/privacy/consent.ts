"use client";

import { useEffect, useState } from "react";

// 동의 문안의 버전. 문안을 바꾸면 버전을 올리고, 옛 버전에 동의한 사용자는 다시 동의를 받는다.
// 문안은 아직 초안이다(법무 확인 전). 동의 기록은 서버가 아니라 이 브라우저에만 둔다.
export const CONSENT_VERSIONS = {
  service: "2026-10-14-v2-draft",
  health: "2026-10-14-v2-draft",
} as const;

export type ConsentKind = keyof typeof CONSENT_VERSIONS;
export type ConsentState = Record<ConsentKind, boolean>;

const KEY = "kc2.consent";
const EVENT = "kc2-consent";

type Stored = Partial<Record<ConsentKind, { version: string; at: string }>>;

function readStored(): Stored {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object" ? (value as Stored) : {};
  } catch {
    return {};
  }
}

/** 지금 문안 버전에 동의한 것만 동의로 본다. 옛 버전 동의는 다시 받아야 한다. */
export function readConsent(): ConsentState {
  const stored = readStored();
  return {
    service: stored.service?.version === CONSENT_VERSIONS.service,
    health: stored.health?.version === CONSENT_VERSIONS.health,
  };
}

/** 동의·철회를 저장한다. 저장하지 못하면(사생활 보호 모드 등) false. */
export function saveConsent(next: ConsentState, now = new Date()): boolean {
  const stored: Stored = {};
  for (const kind of Object.keys(CONSENT_VERSIONS) as ConsentKind[]) {
    if (next[kind]) stored[kind] = { version: CONSENT_VERSIONS[kind], at: now.toISOString() };
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(EVENT));
  return true;
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
