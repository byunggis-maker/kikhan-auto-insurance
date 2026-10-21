"use client";

import type { Accident } from "@/lib/claim/types";
import { Check, Choice } from "../fields";
import type { ScreenProps } from "./types";

// MASTER.md 7장 5단계 면책·과실. 과실을 모르면 0·30·50·70% 시나리오로 계산한다.

type Violations = Accident["violations"];
const ITEMS: { key: keyof Omit<Violations, "driverRelation">; label: string; hint?: string }[] = [
  { key: "drunk", label: "음주운전" },
  { key: "unlicensed", label: "무면허운전" },
  { key: "drugs", label: "마약·약물운전" },
  { key: "fledScene", label: "사고 후 현장을 떠남(조치의무 위반)" },
  { key: "outsideDriverScope", label: "운전한 사람이 증권의 운전자 범위 밖", hint: "예) 가족 한정인데 친구가 운전" },
  { key: "intentional", label: "일부러 낸 사고" },
];

export function Step5FaultExclusion({ screen, claim, update }: ScreenProps) {
  const v = claim.accident.violations;
  const setV = (change: Partial<Violations>) => update((c) => ({ ...c, accident: { ...c.accident, violations: { ...c.accident.violations, ...change } } }));
  switch (screen.kind) {
    case "violations": {
      const none = ITEMS.every((item) => v[item.key] === false);
      return (
        <div className="space-y-2">
          {ITEMS.map((item) => (
            <Check key={item.key} label={item.label} hint={item.hint} checked={v[item.key] === true} onChange={(on) => setV({ ...Object.fromEntries(ITEMS.map((i) => [i.key, v[i.key] ?? false])), [item.key]: on })} />
          ))}
          <button type="button" className={`mt-2 min-h-12 w-full rounded-xl border-2 font-bold ${none ? "border-ink bg-ink text-white" : "border-line bg-white"}`} onClick={() => setV(Object.fromEntries(ITEMS.map((i) => [i.key, false])) as Partial<Violations>)}>
            해당 없음
          </button>
        </div>
      );
    }
    case "driverRelation":
      return (
        <Choice
          options={[
            { value: "policyholder_or_named", label: "보험계약자 또는 기명피보험자 본인" },
            { value: "cohabiting_relative", label: "기명피보험자와 같이 사는(생계를 같이하는) 가족" },
            { value: "long_term_lessee", label: "30일 넘게 빌려 쓰는 사람" },
            { value: "other", label: "그 밖의 사람" },
          ]}
          value={v.driverRelation}
          onChange={(driverRelation) => setV({ driverRelation })}
        />
      );
    case "fault": {
      const value = claim.fault.mode === "known" ? claim.fault.myPercent : null;
      return (
        <div className="space-y-3">
          <Choice columns={3} options={Array.from({ length: 11 }, (_, i) => ({ value: i * 10, label: `${i * 10}%` }))} value={value} onChange={(myPercent) => update((c) => ({ ...c, fault: { mode: "known", myPercent } }))} />
          <button type="button" className={`min-h-12 w-full rounded-xl border-2 font-bold ${claim.fault.mode === "unknown" && !claim.skipped.includes("fault") ? "border-ink bg-ink text-white" : "border-line bg-white"}`} onClick={() => update((c) => ({ ...c, fault: { mode: "unknown" } }))}>
            모름 — 0·30·50·70% 모두 보기
          </button>
        </div>
      );
    }
    default:
      return null;
  }
}
