"use client";

import { ACCIDENT_TYPES, ACCIDENT_TYPE_LABELS, type Accident } from "@/lib/claim/types";
import { VoiceInput } from "../ai/VoiceInput";
import { Choice } from "../fields";
import type { ScreenProps } from "./types";

// MASTER.md 7장 1단계 사고 접수. 글로 쓰거나 말로 설명한다(음성은 라운드 7, MASTER.md 9장).
// 음성에서 옮긴 글은 바로 경위에 넣지 않는다. "확인해 주세요" 칸에서 고친 뒤 넣는다.

const TYPE_HINTS: Record<(typeof ACCIDENT_TYPES)[number], string> = {
  car_car: "차와 차가 부딪힘",
  car_person: "차가 사람(보행자)을 다치게 함",
  single: "혼자 난 사고(벽·가드레일 등)",
  hit_and_run_or_uninsured: "상대가 달아났거나 보험이 없음",
};

export function Step1Accident({ screen, claim, update }: ScreenProps) {
  const a = claim.accident;
  const set = (change: Partial<Accident>) => update((c) => ({ ...c, accident: { ...c.accident, ...change } }));
  switch (screen.kind) {
    case "narrative":
      return (
        <div className="space-y-3">
          <VoiceInput onText={(text) => update((c) => ({ ...c, pendingNarrative: c.pendingNarrative ? `${c.pendingNarrative} ${text}` : text }))} />
          {claim.pendingNarrative !== null && (
            <div className="rounded-xl border-2 border-estimate-line bg-estimate p-3 text-estimate-ink">
              <p className="text-sm font-bold">음성에서 옮긴 글 – 확인해 주세요</p>
              <textarea className="mt-2 min-h-28 w-full rounded-lg border-2 border-estimate-line bg-white p-3 font-semibold text-estimate-ink outline-none" value={claim.pendingNarrative} onChange={(e) => update((c) => ({ ...c, pendingNarrative: e.target.value }))} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" className="min-h-11 rounded-lg bg-estimate-ink font-bold text-white" onClick={() => update((c) => ({ ...c, pendingNarrative: null, accident: { ...c.accident, narrative: [c.accident.narrative, c.pendingNarrative].filter(Boolean).join("\n") } }))}>
                  경위에 넣기
                </button>
                <button type="button" className="min-h-11 rounded-lg border-2 border-estimate-line bg-white font-bold" onClick={() => update((c) => ({ ...c, pendingNarrative: null }))}>
                  지우기
                </button>
              </div>
            </div>
          )}
          <textarea
            className="min-h-48 w-full rounded-xl border-2 border-line bg-white p-4 text-lg font-semibold outline-none focus:border-ink"
            placeholder="예) 신호 대기 중 뒤차가 들이받았습니다. 아내가 옆자리에 타고 있었습니다."
            value={a.narrative}
            onChange={(e) => set({ narrative: e.target.value })}
          />
        </div>
      );
    case "type":
      return <Choice options={ACCIDENT_TYPES.map((t) => ({ value: t, label: ACCIDENT_TYPE_LABELS[t], hint: TYPE_HINTS[t] }))} value={a.type} onChange={(type) => set({ type })} />;
    case "date":
      return (
        <input
          type="date"
          className="min-h-12 w-full rounded-xl border-2 border-line bg-white px-4 text-lg font-bold"
          value={a.occurredAt?.slice(0, 10) ?? ""}
          max="2100-12-31"
          onChange={(e) => set({ occurredAt: e.target.value === "" ? null : e.target.value })}
        />
      );
    case "place":
      return <input className="min-h-12 w-full rounded-xl border-2 border-line bg-white px-4 text-lg font-bold" placeholder="예) 서울 강남구 ○○사거리" value={a.place} onChange={(e) => set({ place: e.target.value })} />;
    default:
      return null;
  }
}
