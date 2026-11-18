"use client";

import type { Property, Victim } from "@/lib/claim/types";
import { setPropertyCount, setVictimCount } from "@/lib/ui/flow";
import { Counter, Select } from "../fields";
import type { ScreenProps } from "./types";

// 3단계 사람·물건. 사람 한 명·물건 한 개가 카드 하나다.
// 라운드 9: 사람마다 관계·상해 급별·치료 결과를 한 화면의 드롭다운으로 묻는다.

const GRADES = Array.from({ length: 14 }, (_, i) => ({ value: i + 1, label: `${i + 1}급${i === 0 ? "(가장 무거움)" : i === 13 ? "(가장 가벼움)" : ""}` }));

export function StepPeople({ screen, claim, update }: ScreenProps) {
  const victim = claim.victims.find((v) => v.id === screen.cardId);
  const setVictim = (change: Partial<Victim>) => update((c) => ({ ...c, victims: c.victims.map((v) => (v.id === screen.cardId ? { ...v, ...change } : v)) }));
  const count = (role: Victim["role"]) => claim.victims.filter((v) => v.role === role).length;
  const has = (role: Property["role"]) => claim.properties.filter((p) => p.role === role).length;

  if (screen.kind === "parties")
    return (
      <div className="space-y-3">
        <section className="space-y-1">
          <h3 className="font-bold">다친 사람</h3>
          <Counter label="피보험자(나)" value={count("driver")} max={1} onChange={(n) => update((c) => setVictimCount(c, "driver", n))} />
          <Counter label="가족 동승자" hint="배우자·자녀·부모 등" value={count("family_passenger")} onChange={(n) => update((c) => setVictimCount(c, "family_passenger", n))} />
          <Counter label="남 동승자" hint="친구·동료 등" value={count("other_passenger")} onChange={(n) => update((c) => setVictimCount(c, "other_passenger", n))} />
          <Counter label="상대방" hint="상대 차량 운전자·동승자·보행자" value={count("counterparty")} onChange={(n) => update((c) => setVictimCount(c, "counterparty", n))} />
        </section>
        <section className="space-y-1">
          <h3 className="font-bold">부서진 물건</h3>
          <Counter label="내 차" value={has("my_vehicle")} max={1} onChange={(n) => update((c) => setPropertyCount(c, "my_vehicle", n))} />
          <Counter label="상대 차량" value={has("counterparty_vehicle")} onChange={(n) => update((c) => setPropertyCount(c, "counterparty_vehicle", n))} />
          <Counter label="상대 물건" hint="가게·담장·시설물 등" value={has("counterparty_property")} onChange={(n) => update((c) => setPropertyCount(c, "counterparty_property", n))} />
        </section>
      </div>
    );

  if (screen.kind !== "person" || !victim) return null;
  const outcome = victim.died ? "died" : victim.disabilityGrade != null ? "disability" : victim.died === false ? "recovered" : null;
  return (
    <div className="space-y-3">
      {victim.role === "family_passenger" && (
        <Select
          label="기명피보험자와의 관계"
          options={[
            { value: "spouse" as const, label: "배우자" },
            { value: "child" as const, label: "자녀" },
            { value: "parent" as const, label: "부모" },
            { value: "other_family" as const, label: "그 밖의 가족(형제·자매 등)" },
          ]}
          value={victim.relationToNamedInsured === "spouse" || victim.relationToNamedInsured === "child" || victim.relationToNamedInsured === "parent" || victim.relationToNamedInsured === "other_family" ? victim.relationToNamedInsured : null}
          onChange={(relationToNamedInsured) => setVictim({ relationToNamedInsured })}
        />
      )}
      {victim.role === "counterparty" && (
        <Select
          label="사고 때 하던 일"
          options={[
            { value: "driver" as const, label: "자동차 운전(이륜차 제외)" },
            { value: "other" as const, label: "그 밖(이륜차 운전·탑승·보행)" },
          ]}
          value={victim.vehicleDriver === true ? "driver" : victim.vehicleDriver === false ? "other" : null}
          // 경상 구상은 자동차(이륜자동차 제외) 운전자에게만 적용된다(별표4 (*1))
          onChange={(role) => setVictim({ vehicleDriver: role === null ? null : role === "driver" })}
        />
      )}
      <Select label="상해 급별(진단서·보험사 안내)" options={GRADES} value={victim.injuryGrade} onChange={(injuryGrade) => setVictim({ injuryGrade })} />
      <Select
        label="치료 결과"
        options={[
          { value: "recovered" as const, label: "부상만(치료 중이거나 다 나음)" },
          { value: "disability" as const, label: "후유장애 진단" },
          { value: "died" as const, label: "사망" },
        ]}
        value={outcome}
        onChange={(o) => setVictim({ died: o === "died", disabilityGrade: o === "disability" ? (victim.disabilityGrade ?? 14) : null })}
      />
      {victim.disabilityGrade != null && !victim.died && <Select label="후유장애 급별" unknown={null} options={GRADES} value={victim.disabilityGrade} onChange={(disabilityGrade) => setVictim({ disabilityGrade })} />}
    </div>
  );
}
