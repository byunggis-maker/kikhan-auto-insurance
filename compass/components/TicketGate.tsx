"use client";

import { useEffect, useRef, useState } from "react";
import { PaidNotice, outlineButton } from "@/components/ui";
import { PAID_ROUTES, type PaidRoute } from "@/lib/guard/config";
import { requestTicket, type GuardStatus } from "@/lib/guard/paid-client";
import { usePaid } from "@/lib/guard/use-paid";

// 유료 기능 자리에 놓는 이용권 안내. 이용권이 있으면 남은 시간만 보이고, 없으면 Turnstile 확인 뒤 이용권을 받는다.
// 이용권이 없어도 직접 입력과 계산은 그대로 된다.

type Turnstile = {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptLoading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

const ORDER: PaidRoute[] = ["policy-read", "stt", "extract", "explain", "tts"];

/** "증권 읽기 3번, 음성을 글로 바꾸기 5번, …" */
export function callsText(status: GuardStatus) {
  if (!status.calls) return "";
  return ORDER.map((route) => `${PAID_ROUTES[route].label} ${status.calls![route]}번`).join(", ");
}

function remainingTime(expiresAt: string, now: number) {
  const minutes = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`;
}

/** 이용권이 있을 때 유료 기능 옆에 붙이는 한 줄 */
export function TicketBadge({ route }: { route: PaidRoute }) {
  const { ready, view } = usePaid(route);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const first = setTimeout(update, 0);
    const timer = setInterval(update, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  if (!ready || !view.ticket || now === 0) return null;
  return (
    <p className="text-sm text-muted">
      분석 이용권 사용 중 · {remainingTime(view.ticket.expiresAt, now)} 남음 · 오늘 남은 이용권 {view.status?.remaining ?? 0}장
    </p>
  );
}

type Phase = { step: "idle" } | { step: "checking" } | { step: "issuing" } | { step: "error"; message: string };

/** what: 이 자리에서 쓰려는 기능 이름(예: "증권 자동 읽기") */
export function TicketGate({ route, what }: { route: PaidRoute; what: string }) {
  const { ready, view } = usePaid(route);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const siteKey = view.status?.siteKey ?? null;

  useEffect(() => {
    if (phase.step !== "checking" || !siteKey) return;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !box.current || widget.current) return;
        widget.current = turnstile.render(box.current, {
          sitekey: siteKey,
          language: "ko",
          size: "flexible",
          callback: (token: string) => {
            setPhase({ step: "issuing" });
            requestTicket(token)
              .then(() => setPhase({ step: "idle" }))
              .catch((error: unknown) => {
                if (widget.current) turnstile.reset(widget.current);
                setPhase({ step: "error", message: error instanceof Error ? error.message : "이용권을 받지 못했습니다." });
              });
          },
          "error-callback": () => setPhase({ step: "error", message: "사람인지 확인하지 못했습니다. 다시 눌러 주세요." }),
          "expired-callback": () => setPhase({ step: "checking" }),
        });
      })
      .catch(() => {
        if (!cancelled) setPhase({ step: "error", message: "확인 화면을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요." });
      });
    return () => {
      cancelled = true;
    };
  }, [phase.step, siteKey]);

  // 이용권을 받았거나 화면을 떠나면 확인 위젯을 걷어 낸다.
  useEffect(() => {
    if (!ready && phase.step !== "idle") return;
    if (widget.current) {
      window.turnstile?.remove(widget.current);
      widget.current = null;
    }
  }, [ready, phase.step]);
  useEffect(
    () => () => {
      if (widget.current) window.turnstile?.remove(widget.current);
    },
    [],
  );

  if (ready) return null;
  if (!view.loaded) return <p className="text-muted">자동 기능을 확인하는 중…</p>;
  const status = view.status;
  if (!status?.enabled) {
    return (
      <>
        <PaidNotice what={what} />
        {view.notice && <p className="text-sm text-muted">{view.notice}</p>}
      </>
    );
  }

  const usedUp = !!view.ticket?.usedUp.includes(route);
  const busy = phase.step === "checking" || phase.step === "issuing";
  // 봇 확인(Turnstile)이 없는 간이 모드: 확인 위젯 없이 바로 이용권을 받는다.
  const issueDirectly = () => {
    setPhase({ step: "issuing" });
    requestTicket("")
      .then(() => setPhase({ step: "idle" }))
      .catch((error: unknown) => setPhase({ step: "error", message: error instanceof Error ? error.message : "이용권을 받지 못했습니다." }));
  };
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-navy-soft p-4 text-navy" role="group" aria-label="분석 이용권">
      <p className="font-semibold">
        {usedUp ? `이 이용권으로 쓸 수 있는 ${PAID_ROUTES[route].label} 횟수를 모두 썼습니다.` : `‘${what}’ 기능은 분석 이용권이 있어야 쓸 수 있어요.`}
      </p>
      {view.notice && !usedUp && <p>{view.notice}</p>}
      <p className="text-base">
        이용권 1장으로 {status.ttlMinutes / 60}시간 동안 {callsText(status)}을 쓸 수 있어요.
      </p>
      <p className="text-base font-semibold">
        오늘 남은 이용권: {status.remaining}장 / {status.limit}장
      </p>
      {status.remaining === 0 ? (
        <p role="alert" className="rounded-xl bg-warn-soft px-4 py-3 font-semibold text-warn-ink">
          오늘 받을 수 있는 이용권을 모두 받았습니다. 내일(한국 시각 자정이 지나면) 다시 받을 수 있어요. 직접 입력과 계산은 계속 쓸 수 있어요.
        </p>
      ) : (
        <>
          {phase.step === "idle" || phase.step === "error" ? (
            <button type="button" className={outlineButton} onClick={() => (siteKey ? setPhase({ step: "checking" }) : issueDirectly())}>
              {usedUp ? "새 이용권 받기" : "이용권 받기"}
            </button>
          ) : (
            <p aria-live="polite">{phase.step === "issuing" ? "이용권을 받는 중…" : "아래에서 사람인지 확인해 주세요."}</p>
          )}
          <div ref={box} hidden={!busy} />
        </>
      )}
      {phase.step === "error" && (
        <p role="alert" className="rounded-xl bg-warn-soft px-4 py-3 font-semibold text-warn-ink">
          {phase.message}
        </p>
      )}
    </div>
  );
}
