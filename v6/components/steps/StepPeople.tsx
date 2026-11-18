"use client";

import { VICTIM_POSITIONS, VICTIM_POSITION_LABELS, positionOf, type Property, type Victim } from "@/lib/claim/types";
import { setOtherCount, setPersonFacts, setPropertyCount, setVictimCount } from "@/lib/ui/flow";
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
          <Counter label="다른 다친 사람" hint="내 차 동승자·상대 차량 탑승자·보행자" value={claim.victims.filter((v) => v.role !== "driver").length} onChange={(n) => update((c) => setOtherCount(c, n))} />
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
  const position = positionOf(victim);
  const outcome = victim.died ? "died" : victim.disabilityGrade != null ? "disability" : victim.died === false ? "recovered" : null;
  return (
    <div className="space-y-3">
      {victim.role !== "driver" && (
        // 라운드 9b: 위치에 따라 받을 곳(내 대인배상·상대 대인배상·자기신체사고·자동차상해)이 달라진다
        <Select label="다친 사람의 위치" unknown={null} options={VICTIM_POSITIONS.map((p) => ({ value: p, label: VICTIM_POSITION_LABELS[p] }))} value={position === "driver" ? null : position} onChange={(p) => p && update((c) => setPersonFacts(c, victim.id, { position: p }))} />
      )}
      {position === "my_vehicle" && (
        <Select
          label="기명피보험자와의 관계"
          unknown={null}
          options={[
            { value: "spouse" as const, label: "배우자" },
            { value: "child" as const, label: "자녀" },
            { value: "parent" as const, label: "부모" },
            { value: "other_family" as const, label: "그 밖의 가족(형제·자매 등)" },
            { value: "none" as const, label: "가족 아님(친구·동료 등)" },
          ]}
          value={victim.relationToNamedInsured === "self" ? null : victim.relationToNamedInsured}
          onChange={(relationToNamedInsured) => relationToNamedInsured && update((c) => setPersonFacts(c, victim.id, { relationToNamedInsured }))}
        />
      )}
      {position === "counterparty_vehicle" && (
        <Select
          label="상대 차량의 어느 자리"
          options={[
            { value: "car" as const, label: "운전자(자동차)" },
            { value: "bike" as const, label: "운전자(이륜차)" },
            { value: "passenger" as const, label: "동승자" },
            { value: "passenger_family" as const, label: "동승자(상대 운전자의 가족)" },
          ]}
          value={victim.seat === "passenger" || victim.seat === "passenger_family" ? victim.seat : victim.seat === "driver" ? (victim.vehicleDriver ? "car" : "bike") : null}
          // 경상 구상은 자동차(이륜자동차 제외) 운전자에게만 적용된다(별표4 (*1))
          onChange={(seat) => update((c) => setPersonFacts(c, victim.id, seat === null ? { seat: null, vehicleDriver: null } : { seat: seat === "passenger" || seat === "passenger_family" ? seat : "driver", vehicleDriver: seat === "car" }))}
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
