"use client";

import type { Property, Victim } from "@/lib/claim/types";
import { setPropertyCount, setVictimCount } from "@/lib/ui/flow";
import { Choice, Counter, MoneyInput } from "../fields";
import type { ScreenProps } from "./types";

// MASTER.md 7장 2단계 사람·물건 정리. 사람 한 명·물건 한 개가 카드 하나다.

const GRADE_HINTS: Record<number, string> = { 1: "가장 무거움", 5: "", 9: "", 12: "가벼운 염좌 등", 14: "가장 가벼움" };

export function Step2People({ screen, claim, update }: ScreenProps) {
  const victim = claim.victims.find((v) => v.id === screen.cardId);
  const setVictim = (change: Partial<Victim>) => update((c) => ({ ...c, victims: c.victims.map((v) => (v.id === screen.cardId ? { ...v, ...change } : v)) }));
  const setProperty = (change: Partial<Property>) => update((c) => ({ ...c, properties: c.properties.map((p) => (p.id === screen.cardId ? { ...p, ...change } : p)) }));
  const count = (role: Victim["role"]) => claim.victims.filter((v) => v.role === role).length;
  const has = (role: Property["role"]) => claim.properties.filter((p) => p.role === role).length;

  switch (screen.kind) {
    case "parties":
      return (
        <div className="space-y-5">
          <section className="space-y-2">
            <h3 className="font-bold">다친 사람</h3>
            <Counter label="나(운전자)" value={count("driver")} max={1} onChange={(n) => update((c) => setVictimCount(c, "driver", n))} />
            <Counter label="가족 동승자" hint="배우자·자녀·부모 등" value={count("family_passenger")} onChange={(n) => update((c) => setVictimCount(c, "family_passenger", n))} />
            <Counter label="남 동승자" hint="친구·동료 등" value={count("other_passenger")} onChange={(n) => update((c) => setVictimCount(c, "other_passenger", n))} />
            <Counter label="상대방" hint="상대 차 운전자·동승자, 보행자" value={count("counterparty")} onChange={(n) => update((c) => setVictimCount(c, "counterparty", n))} />
          </section>
          <section className="space-y-2">
            <h3 className="font-bold">부서진 물건</h3>
            <Counter label="내 차" value={has("my_vehicle")} max={1} onChange={(n) => update((c) => setPropertyCount(c, "my_vehicle", n))} />
            <Counter label="상대 차" value={has("counterparty_vehicle")} onChange={(n) => update((c) => setPropertyCount(c, "counterparty_vehicle", n))} />
            <Counter label="상대 물건" hint="가게·담장·시설물 등" value={has("counterparty_property")} onChange={(n) => update((c) => setPropertyCount(c, "counterparty_property", n))} />
          </section>
        </div>
      );
    case "relation":
      return (
        <Choice
          options={[
            { value: "spouse", label: "배우자" },
            { value: "child", label: "자녀" },
            { value: "parent", label: "부모" },
            { value: "other_family", label: "그 밖의 가족", hint: "형제·자매 등" },
          ]}
          value={victim?.relationToNamedInsured ?? null}
          onChange={(relationToNamedInsured) => setVictim({ relationToNamedInsured })}
        />
      );
    case "counterpartyRole":
      return (
        <Choice
          options={[
            { value: "driver", label: "자동차를 운전하고 있었음", hint: "이륜차는 빼고" },
            { value: "other", label: "그 밖", hint: "이륜차 운전·차에 타고 있음·걷고 있음" },
          ]}
          value={victim?.vehicleDriver === true ? "driver" : victim?.vehicleDriver === false ? "other" : null}
          // 경상 구상은 자동차(이륜자동차 제외) 운전자에게만 적용된다(별표4 (*1))
          onChange={(role) => setVictim({ vehicleDriver: role === "driver" })}
        />
      );
    case "injury":
      return (
        <Choice
          columns={3}
          options={Array.from({ length: 14 }, (_, i) => ({ value: i + 1, label: `${i + 1}급`, hint: GRADE_HINTS[i + 1] || undefined }))}
          value={victim?.injuryGrade ?? null}
          onChange={(injuryGrade) => setVictim({ injuryGrade })}
        />
      );
    case "outcome":
      return (
        <div className="space-y-4">
          <Choice
            options={[
              { value: "recovered", label: "부상만(치료 중이거나 다 나음)" },
              { value: "disability", label: "후유장애 진단을 받음" },
              { value: "died", label: "사망" },
            ]}
            value={victim?.died ? "died" : victim?.disabilityGrade != null ? "disability" : victim ? "recovered" : null}
            onChange={(outcome) => setVictim({ died: outcome === "died", disabilityGrade: outcome === "disability" ? (victim?.disabilityGrade ?? 14) : null })}
          />
          {victim?.disabilityGrade != null && !victim.died && (
            <div>
              <p className="mb-2 font-bold">후유장애 급수</p>
              <Choice columns={3} options={Array.from({ length: 14 }, (_, i) => ({ value: i + 1, label: `${i + 1}급` }))} value={victim.disabilityGrade} onChange={(disabilityGrade) => setVictim({ disabilityGrade })} />
            </div>
          )}
        </div>
      );
    case "vehicleValue": {
      const property = claim.properties.find((p) => p.id === screen.cardId);
      return <MoneyInput label="차량가액" value={property?.valueAtAccident ?? null} onChange={(valueAtAccident) => setProperty({ valueAtAccident })} />;
    }
    default:
      return null;
  }
}
