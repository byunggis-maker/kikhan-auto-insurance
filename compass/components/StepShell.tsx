"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useCaseDraft } from "@/lib/draft/use-draft";
import type { CaseDraft } from "@/lib/draft/types";
import { primaryButton } from "./ui";

type Step = { path: string; title: string };
export const STEPS: readonly Step[] = [
  { path: "policy", title: "내 보험" },
  { path: "accident", title: "사고 말하기" },
  { path: "people", title: "다친 사람·피해" },
  { path: "result", title: "결과" },
];

type Update = (change: (current: CaseDraft) => CaseDraft) => void;

/** 단계 화면의 공통 틀: 위쪽 단계 표시, 아래쪽 고정 "다음" 버튼, 입력 초안 불러오기. */
export function StepShell(props: {
  step: 1 | 2 | 3 | 4;
  lead: string;
  nextLabel?: string;
  children: (draft: CaseDraft, update: Update) => ReactNode;
}) {
  const { id } = useParams<{ id: string }>();
  const { draft, update } = useCaseDraft(id);
  const current = STEPS[props.step - 1];
  const prev = props.step > 1 ? `/cases/${id}/${STEPS[props.step - 2].path}` : "/cases";
  const next = props.step < 4 ? `/cases/${id}/${STEPS[props.step].path}` : "/cases";

  // 결과 화면의 "부족 정보" 버튼으로 왔으면 그 입력 칸으로 옮겨 간다. 입력 초안을 불러온 뒤에야 칸이 생긴다.
  const loaded = !!draft;
  useEffect(() => {
    if (!loaded || !window.location.hash) return;
    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    target.querySelector<HTMLElement>("input, select, button")?.focus({ preventScroll: true });
  }, [loaded]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-white px-5 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <Link href={prev} className="-ml-2 flex min-h-11 items-center px-2 font-semibold text-navy">
            ← 이전
          </Link>
          <span className="font-bold text-navy" aria-label={`4단계 중 ${props.step}단계`}>
            {props.step}/4
          </span>
        </div>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s.path} className={`h-1.5 flex-1 rounded-full ${i < props.step ? "bg-navy" : "bg-line"}`} />
          ))}
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-5 pb-32 pt-6">
        <div>
          <h1 className="text-2xl font-bold">{current.title}</h1>
          <p className="mt-1 text-muted">{props.lead}</p>
        </div>
        {draft === undefined && <p className="text-muted">불러오는 중…</p>}
        {draft === null && (
          <div className="flex flex-col gap-4">
            <p>이 기기에서 이 사고 기록을 찾지 못했습니다.</p>
            <Link href="/cases" className={primaryButton}>
              내 사고 기록으로
            </Link>
          </div>
        )}
        {draft && props.children(draft, update)}
      </main>

      {draft && (
        <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white">
          <div className="mx-auto w-full max-w-xl px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <Link href={next} className={primaryButton}>
              {props.nextLabel ?? "다음"}
            </Link>
            <p className="mt-1.5 text-center text-sm text-muted">입력한 내용은 이 기기에 자동으로 저장됩니다</p>
          </div>
        </footer>
      )}
    </div>
  );
}
