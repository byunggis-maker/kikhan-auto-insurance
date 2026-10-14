"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { PaidRoute } from "./config";
import { canUse, paidServerSnapshot, paidSnapshot, subscribePaid, type PaidView } from "./paid-client";

/**
 * 화면이 유료 기능(증권 읽기, 음성 변환, 사실 추출, 쉬운 말 설명, 읽어주기) 버튼을 보여 줄지 정한다.
 * ready: 이용권이 있고 시간이 남았고 이 기능의 횟수가 남았다. 아니면 components/TicketGate.tsx가 이용권 받기를 안내한다.
 */
export function usePaid(route: PaidRoute): { ready: boolean; view: PaidView } {
  const view = useSyncExternalStore(subscribePaid, paidSnapshot, paidServerSnapshot);
  // 이용권 만료 시각이 지나면 다시 그린다.
  const [, tick] = useState(0);
  const expiresAt = view.ticket?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return { ready: canUse(view, route), view };
}
