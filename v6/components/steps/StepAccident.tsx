"use client";

import { ACCIDENT_TYPES, ACCIDENT_TYPE_LABELS, DRIVER_RELATIONS, type Accident, type DriverRelation } from "@/lib/claim/types";
import { Select } from "../fields";
import type { ScreenProps } from "./types";

// 라운드 9: 2단계 사고 당시 상황. 사고 유형과 면책·사고부담금 사유를 한 화면의 드롭다운으로 묻는다.

type Violations = Accident["violations"];
const ITEMS: { key: keyof Omit<Violations, "driverRelation">; label: string }[] = [
  { key: "drunk", label: "음주운전" },
  { key: "unlicensed", label: "무면허운전" },
  { key: "drugs", label: "마약·약물운전" },
  { key: "fledScene", label: "조치의무 위반(뺑소니)" },
  { key: "outsideDriverScope", label: "운전자 범위 밖 운전" },
  { key: "intentional", label: "고의 사고" },
];
const YES_NO = [
  { value: "no" as const, label: "아니오" },
  { value: "yes" as const, label: "예" },
];
const RELATION_LABELS: Record<DriverRelation, string> = {
  policyholder_or_named: "보험계약자·기명피보험자 본인",
  cohabiting_relative: "기명피보험자와 같이 사는 친족",
  long_term_lessee: "30일 넘게 빌린 임차인",
  other: "그 밖의 사람",
};
const TYPE_LABELS: Record<(typeof ACCIDENT_TYPES)[number], string> = {
  car_car: `${ACCIDENT_TYPE_LABELS.car_car}(차와 차)`,
  car_person: `${ACCIDENT_TYPE_LABELS.car_person}(보행자)`,
  single: `${ACCIDENT_TYPE_LABELS.single}(혼자 난 사고)`,
  hit_and_run_or_uninsured: `${ACCIDENT_TYPE_LABELS.hit_and_run_or_uninsured}(상대가 달아남·보험 없음)`,
};

export function StepAccident({ claim, update }: ScreenProps) {
  const a = claim.accident;
  const v = a.violations;
  const setV = (change: Partial<Violations>) => update((c) => ({ ...c, accident: { ...c.accident, violations: { ...c.accident.violations, ...change } } }));
  const yn = (value: boolean | null) => (value === true ? "yes" : value === false ? "no" : null);
  return (
    <div className="space-y-3">
      <Select label="사고 유형" options={ACCIDENT_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))} value={a.type} onChange={(type) => update((c) => ({ ...c, accident: { ...c.accident, type } }))} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        {ITEMS.map((item) => (
          <Select key={item.key} label={item.label} options={YES_NO} value={yn(v[item.key])} onChange={(choice) => setV({ [item.key]: choice === null ? null : choice === "yes" })} />
        ))}
      </div>
      {(v.drunk || v.unlicensed || v.drugs) && (
        // 자기차량손해 보상 여부가 이 관계로 정해진다(약관 제23조 14호)
        <Select label="운전한 사람과 이 보험의 관계" options={DRIVER_RELATIONS.map((r) => ({ value: r, label: RELATION_LABELS[r] }))} value={v.driverRelation} onChange={(driverRelation) => setV({ driverRelation })} />
      )}
    </div>
  );
}
