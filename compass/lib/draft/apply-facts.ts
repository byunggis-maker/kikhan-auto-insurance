import type { AccidentFacts } from "@/lib/schemas/accident-facts";
import { newPerson } from "./store";
import type { CaseDraft, PersonDraft } from "./types";

// 사실 추출 결과를 입력 초안에 옮긴다. 뽑히지 않은 칸은 사용자가 적어 둔 값을 그대로 둔다.
// 짐작으로 채운 칸의 이름은 inferred에 남겨 화면에서 "추정"으로 표시한다.

const ACCIDENT_KEYS = ["date", "time", "place", "kind"] as const;

export function applyFacts(draft: CaseDraft, facts: AccidentFacts, newId: () => string): CaseDraft {
  const read = facts.accident;
  const accident = {
    ...draft.accident,
    date: read.date ?? draft.accident.date,
    time: read.time ?? draft.accident.time,
    place: read.place ?? draft.accident.place,
    kind: read.kind ?? draft.accident.kind,
  };
  const inferred = new Set(draft.accident.inferred);
  for (const key of ACCIDENT_KEYS) {
    if (read[key] === null) continue;
    if (read.inferred.includes(key)) inferred.add(key);
    else inferred.delete(key);
  }

  const people: PersonDraft[] = facts.people.map((person) => ({
    ...newPerson(newId(), person.role),
    injury: person.injury ?? "",
    diagnosis: person.diagnosis ?? "",
    surgery: person.surgery,
    hospitalDays: person.hospitalDays,
    outpatientDays: person.outpatientDays,
    faultPercent: person.faultPercent,
    occupation: person.occupation ?? "",
    inferred: [...person.inferred],
  }));

  return {
    ...draft,
    accident: { ...accident, inferred: [...inferred] },
    // 사람을 하나도 뽑지 못했으면 적어 둔 사람 카드를 지우지 않는다.
    people: people.length > 0 ? people : draft.people,
    vehicle: { ...draft.vehicle, damage: facts.accident.vehicleDamage ?? draft.vehicle.damage },
  };
}
