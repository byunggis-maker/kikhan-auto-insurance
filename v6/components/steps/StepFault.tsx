"use client";

import { Select } from "../fields";
import type { ScreenProps } from "./types";

// 5단계 과실비율. 라운드 9: 피보험자(나)와 상대를 한 줄에 두고, 한쪽을 고르면 다른 쪽이 100%에서 뺀 값으로 맞춰진다(5% 단위).
// '모름'이면 내 과실 0·30·50·70% 네 경우를 모두 계산한다(MASTER.md 6장).

const PERCENTS = Array.from({ length: 21 }, (_, i) => ({ value: i * 5, label: `${i * 5}%` }));

export function StepFault({ claim, update }: ScreenProps) {
  const mine = claim.fault.mode === "known" ? claim.fault.myPercent : null;
  const set = (myPercent: number | null) => update((c) => ({ ...c, fault: myPercent === null ? { mode: "unknown" } : { mode: "known", myPercent } }));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2" data-fault-pair>
        <Select label="피보험자(나)" options={PERCENTS} value={mine} onChange={set} />
        <span className="pb-3 text-xl font-bold">:</span>
        <Select label="상대" options={PERCENTS} value={mine === null ? null : 100 - mine} onChange={(other) => set(other === null ? null : 100 - other)} />
      </div>
      <p className="text-sm font-semibold text-ink-soft">합계는 늘 100%입니다. 모르면 &apos;모름&apos; — 내 과실 0·30·50·70% 네 경우를 모두 계산합니다.</p>
    </div>
  );
}
