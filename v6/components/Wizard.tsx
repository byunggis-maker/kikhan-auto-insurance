"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadClaim, saveClaim } from "@/lib/claim/persist";
import { emptyClaim, type Claim } from "@/lib/claim/types";
import { clearChecked } from "@/lib/state/checklist";
import { loadProgress, saveProgress } from "@/lib/state/progress";
import { STEP_TITLES, screensFor, skip, unskip, type Screen } from "@/lib/ui/flow";
import { SkipButton } from "./SkipButton";
import { Step1Accident } from "./steps/Step1Accident";
import { Step2People } from "./steps/Step2People";
import { Step3MyPolicy } from "./steps/Step3MyPolicy";
import { Step4OtherPolicy } from "./steps/Step4OtherPolicy";
import { Step5FaultExclusion } from "./steps/Step5FaultExclusion";
import { Step6Losses } from "./steps/Step6Losses";
import { Step7Review } from "./steps/Step7Review";
import type { ScreenProps } from "./steps/types";

// 입력 7단계(MASTER.md 7장). 한 화면에 질문 하나, 아래에 이전·다음과 "모르면 건너뛰기".
// 입력값과 진행 위치는 이 브라우저의 localStorage에만 저장한다(새로고침해도 이어서 입력).

function Body(props: ScreenProps & { goTo: (screenId: string, anchor?: string) => void }) {
  switch (props.screen.step) {
    case 1:
      return <Step1Accident {...props} />;
    case 2:
      return <Step2People {...props} />;
    case 3:
      return <Step3MyPolicy {...props} />;
    case 4:
      return <Step4OtherPolicy {...props} />;
    case 5:
      return <Step5FaultExclusion {...props} />;
    case 6:
      return <Step6Losses {...props} />;
    default:
      return <Step7Review claim={props.claim} goTo={props.goTo} />;
  }
}

export function Wizard() {
  const [claim, setClaim] = useState<Claim | null>(null);
  const [screenId, setScreenId] = useState<string>("narrative");
  const top = useRef<HTMLDivElement>(null);
  /** 화면을 옮긴 뒤 스크롤할 칸(7단계 "채우기" → 6단계의 그 항목 카드) */
  const anchor = useRef<string | null>(null);

  // 처음 한 번 불러오기(서버 렌더링에는 localStorage가 없으므로 화면에 붙은 뒤에)
  useEffect(() => {
    const loaded = loadClaim();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage는 브라우저에서만 읽을 수 있다
    setClaim(loaded.claim);
    const progress = loadProgress();
    if (progress) setScreenId(progress.screenId);
  }, []);

  useEffect(() => {
    if (claim) saveClaim(claim);
  }, [claim]);
  useEffect(() => {
    saveProgress({ screenId });
    if (anchor.current) {
      document.getElementById(anchor.current)?.scrollIntoView({ block: "start" });
      anchor.current = null;
    }
  }, [screenId]);

  const screens = useMemo(() => (claim ? screensFor(claim) : []), [claim]);
  const index = Math.max(0, screens.findIndex((s) => s.id === screenId));
  const screen: Screen | undefined = screens[index];

  const go = useCallback(
    (next: number) => {
      const target = screens[Math.min(Math.max(next, 0), screens.length - 1)];
      if (target) setScreenId(target.id);
      top.current?.scrollIntoView({ block: "start" });
    },
    [screens],
  );

  const goTo = (id: string, target?: string) => {
    anchor.current = target ?? null;
    setScreenId(id);
    if (!target) top.current?.scrollIntoView({ block: "start" });
  };

  if (!claim || !screen) return <p className="p-6 font-bold">불러오는 중…</p>;

  const update = (change: (claim: Claim) => Claim) => setClaim((current) => (current ? unskip(change(current), screen.id) : current));
  const skipped = claim.skipped.includes(screen.id);
  const isLast = index === screens.length - 1;

  return (
    <div ref={top} className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-4">
      <header className="mb-4">
        <div className="flex items-center justify-between text-sm font-bold">
          <span>
            {screen.step}/7 {STEP_TITLES[screen.step - 1]}
          </span>
          <button
            type="button"
            className="min-h-11 px-2 text-ink-soft underline"
            onClick={() => {
              if (window.confirm("입력한 내용을 모두 지우고 처음부터 할까요?")) {
                setClaim(emptyClaim());
                clearChecked();
                setScreenId("narrative");
              }
            }}
          >
            처음부터
          </button>
        </div>
        <div className="mt-2 flex gap-1" aria-hidden>
          {STEP_TITLES.map((title, i) => (
            <span key={title} className={`h-1.5 flex-1 rounded-full ${i < screen.step ? "bg-ink" : "bg-line"}`} />
          ))}
        </div>
      </header>

      <main className="flex-1">
        <h1 className="text-2xl font-bold leading-snug">{screen.title}</h1>
        {screen.hint && <p className="mt-2 font-semibold text-ink-soft">{screen.hint}</p>}
        <div className="mt-5">
          <Body screen={screen} claim={claim} update={update} goTo={goTo} />
        </div>
        {screen.skippable && (
          <div className="mt-6">
            <SkipButton
              skipped={skipped}
              onSkip={() => {
                setClaim(skip(claim, screen));
                go(index + 1);
              }}
            />
          </div>
        )}
      </main>

      {/* 내용 끝에 붙어 있다가 화면 아래에 닿으면 멈춘다(sticky). 고정(fixed)하면 긴 화면의 내용을 가린다 */}
      <nav className="sticky bottom-0 -mx-4 mt-6 border-t-2 border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex gap-2">
          <button type="button" className="min-h-14 flex-1 rounded-xl border-2 border-line bg-white text-lg font-bold disabled:opacity-40" disabled={index === 0} onClick={() => go(index - 1)}>
            이전
          </button>
          {!isLast && (
            <button type="button" className="min-h-14 flex-[2] rounded-xl bg-ink text-lg font-bold text-white" onClick={() => go(index + 1)}>
              {screens[index + 1]?.step === 7 ? "결과 보기" : "다음"}
            </button>
          )}
        </div>
      </nav>
    </div>
  );
}
