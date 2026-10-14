"use client";

import { readConsent } from "@/lib/privacy/consent";
import { CONSENT_VERSIONS, type ConsentKind } from "@/lib/privacy/consent-versions";
import type { PaidRoute } from "./config";

// 화면 쪽 이용권 상태. 이용권은 이 탭의 sessionStorage(kc2.ticket)에만 두고, 탭을 닫으면 사라진다.
// 이용권에는 사람에 대한 정보가 없다(번호와 만료 시각뿐). "모두 지우기"도 이 키를 지운다.

export const TICKET_KEY = "kc2.ticket";
// lib/guard/paid.ts의 TICKET_HEADER·CONSENT_HEADER와 같은 이름이다.
const TICKET_HEADER = "x-kc2-ticket";
const CONSENT_HEADER = "x-kc2-consent";

export type GuardStatus = {
  enabled: boolean;
  siteKey: string | null;
  limit: number;
  remaining: number;
  ttlMinutes: number;
  calls: Record<PaidRoute, number> | null;
};

type Held = { token: string; expiresAt: string; usedUp: PaidRoute[] };

export type PaidView = {
  /** 서버 설정을 아직 읽는 중이면 false */
  loaded: boolean;
  status: GuardStatus | null;
  ticket: Held | null;
  /** 이용권이 끝났거나 다 쓴 이유 등, 화면에 한 번 보여 줄 안내 */
  notice: string | null;
};

const CONFIG_FAILED = "서버에 연결하지 못했습니다. 직접 입력해 계산할 수 있어요.";

let view: PaidView = { loaded: false, status: null, ticket: null, notice: null };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function set(next: Partial<PaidView>) {
  view = { ...view, ...next };
  for (const listener of listeners) listener();
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readHeld(): Held | null {
  try {
    const value = JSON.parse(session()?.getItem(TICKET_KEY) ?? "null") as Held | null;
    if (!value || typeof value.token !== "string" || typeof value.expiresAt !== "string" || !Array.isArray(value.usedUp)) return null;
    return Date.parse(value.expiresAt) > Date.now() ? value : null;
  } catch {
    return null;
  }
}

function writeHeld(held: Held | null) {
  try {
    if (held) session()?.setItem(TICKET_KEY, JSON.stringify(held));
    else session()?.removeItem(TICKET_KEY);
  } catch {
    // 저장하지 못해도 이 화면의 메모리에는 남는다.
  }
  set({ ticket: held });
}

/** 서버 설정(쓸 수 있는지, 오늘 남은 장수)을 다시 읽는다. */
export function refreshStatus(): Promise<void> {
  loading = (async () => {
    try {
      const response = await fetch("/api/guard/config", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as GuardStatus | null;
      set({ loaded: true, status: response.ok && body ? body : { enabled: false, siteKey: null, limit: 0, remaining: 0, ttlMinutes: 0, calls: null }, notice: response.ok ? view.notice : CONFIG_FAILED });
    } catch {
      set({ loaded: true, status: { enabled: false, siteKey: null, limit: 0, remaining: 0, ttlMinutes: 0, calls: null }, notice: CONFIG_FAILED });
    }
  })();
  return loading;
}

export function subscribePaid(listener: () => void) {
  listeners.add(listener);
  if (!loading) {
    view = { ...view, ticket: readHeld() };
    void refreshStatus();
  }
  return () => listeners.delete(listener);
}

export const paidSnapshot = () => view;
const SERVER_VIEW: PaidView = { loaded: false, status: null, ticket: null, notice: null };
export const paidServerSnapshot = () => SERVER_VIEW;

/** 이용권이 있고, 아직 시간이 남았고, 이 경로의 횟수를 다 쓰지 않았는지 */
export function canUse(current: PaidView, route: PaidRoute, now = Date.now()) {
  const { status, ticket } = current;
  if (!status?.enabled) return false;
  if (ticket && Date.parse(ticket.expiresAt) > now) return !ticket.usedUp.includes(route);
  // 봇 확인(Turnstile)이 없는 간이 모드: 이용권이 없어도 쓸 수 있게 보이고, paidFetch가 보낼 때 이용권을 받는다.
  return !status.siteKey && status.remaining > 0;
}

/** 지금 이 브라우저에 저장된 동의를 서버에 알리는 머리글 값 */
export function consentHeader(): string {
  const consent = readConsent();
  return (Object.keys(CONSENT_VERSIONS) as ConsentKind[])
    .filter((kind) => consent[kind])
    .map((kind) => `${kind}:${CONSENT_VERSIONS[kind]}`)
    .join(",");
}

/** Turnstile을 통과한 토큰으로 이용권을 받는다. 실패하면 화면에 보여 줄 문장을 던진다. */
export async function requestTicket(turnstileToken: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/guard/ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json", [CONSENT_HEADER]: consentHeader() },
      body: JSON.stringify({ turnstileToken }),
    });
  } catch {
    throw new Error("서버에 연결하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.");
  }
  const body = (await response.json().catch(() => null)) as { ticket?: string; expiresIn?: number; remaining?: number; error?: string; code?: string } | null;
  if (!response.ok || !body?.ticket || typeof body.expiresIn !== "number") {
    if (body?.code === "DAILY_LIMIT" && view.status) set({ status: { ...view.status, remaining: 0 } });
    throw new Error(body?.error ?? "이용권을 받지 못했습니다. 잠시 뒤에 다시 시도해 주세요.");
  }
  if (view.status && typeof body.remaining === "number") set({ status: { ...view.status, remaining: body.remaining } });
  set({ notice: null });
  // 만료 시각은 이 기기의 시계로 센다. 서버가 먼저 만료로 보면 paidFetch가 이용권을 지운다.
  writeHeld({ token: body.ticket, expiresAt: new Date(Date.now() + body.expiresIn * 1000).toISOString(), usedUp: [] });
}

const TICKET_GONE = new Set(["TICKET_REQUIRED", "TICKET_INVALID", "TICKET_EXPIRED"]);

/**
 * 유료 API를 부른다. 이용권과 동의 버전을 머리글에 붙이고, 서버가 이용권을 거절하면 화면 상태를 바로 고친다.
 * 응답은 그대로 돌려준다(오류 문장은 부른 쪽이 body.error로 보여 준다). 연결 실패는 fetch처럼 던진다.
 */
export async function paidFetch(route: PaidRoute, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  let held = view.ticket && Date.parse(view.ticket.expiresAt) > Date.now() ? view.ticket : readHeld();
  // 간이 모드(봇 확인 없음)면 이용권을 화면에서 따로 받지 않고 여기서 받는다.
  if (!held && view.status?.enabled && !view.status.siteKey) {
    try {
      await requestTicket("");
    } catch (error) {
      return Response.json({ error: (error as Error).message, code: "TICKET_REQUIRED" }, { status: 401 });
    }
    held = view.ticket;
  }
  if (held) headers.set(TICKET_HEADER, held.token);
  headers.set(CONSENT_HEADER, consentHeader());
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = (await response.clone().json().catch(() => null)) as { error?: string; code?: string } | null;
    if (body?.code && TICKET_GONE.has(body.code)) {
      set({ notice: body.error ?? null });
      writeHeld(null);
    } else if (body?.code === "TICKET_USED_UP" && held) {
      set({ notice: body.error ?? null });
      writeHeld({ ...held, usedUp: [...new Set([...held.usedUp, route])] });
    } else if (body?.code === "PAID_UNAVAILABLE") {
      void refreshStatus();
    }
  }
  return response;
}

/** 모두 지우기에서 부른다. */
export function forgetTicket() {
  writeHeld(null);
  set({ notice: null });
}
