import type { AccidentFacts } from "@/lib/schemas/accident-facts";
import { newPerson } from "./store";
import type { CaseDraft, PersonDraft, YesNo } from "./types";

// 사실 추출 결과를 입력 초안에 옮긴다. 뽑히지 않은 칸은 사용자가 적어 둔 값을 그대로 둔다.
// 짐작으로 채운 칸의 이름은 inferred에 남겨 화면에서 "추정"으로 표시한다.
// 말·글에서 채운 칸의 이름은 heard에 남겨 "음성에서 인식됨"으로 표시한다. 말에 없던 칸은 비워 두고 화면이 "확인 필요"를 붙인다.

const ACCIDENT_KEYS = ["date", "time", "place", "kind", "myDriver", "counterpartyExists", "faultStatement", "policeReport", "insuranceReport"] as const;
const PERSON_KEYS = ["role", "relation", "injury", "diagnosis", "surgery", "care", "hospitalDays", "outpatientDays", "faultPercent", "occupation", "age"] as const;

const yesNo = (value: boolean | null): YesNo | null => (value === null ? null : value ? "yes" : "no");

export function applyFacts(draft: CaseDraft, facts: AccidentFacts, newId: () => string): CaseDraft {
  const read = facts.accident;
  const found = {
    date: read.date,
    time: read.time,
    place: read.place,
    kind: read.kind,
    myDriver: read.myDriver,
    counterpartyExists: yesNo(read.counterpartyExists),
    faultStatement: read.faultStatement,
    policeReport: yesNo(read.policeReport),
    insuranceReport: yesNo(read.insuranceReport),
  };
  const accident = { ...draft.accident };
  const inferred = new Set(draft.accident.inferred);
  const heard = new Set(draft.accident.heard);
  for (const key of ACCIDENT_KEYS) {
    const value = found[key];
    if (value === null) continue;
    (accident as Record<string, unknown>)[key] = value;
    heard.add(key);
    if (read.inferred.includes(key)) inferred.add(key);
    else inferred.delete(key);
  }
  if (read.vehicleDamage !== null) heard.add("vehicleDamage");

  const people: PersonDraft[] = facts.people.map((person) => {
    const values = {
      role: person.role,
      relation: person.relation ?? ("" as const),
      injury: person.injury ?? "",
      diagnosis: person.diagnosis ?? "",
      surgery: person.surgery,
      care: person.care ?? ("" as const),
      hospitalDays: person.hospitalDays,
      outpatientDays: person.outpatientDays,
      faultPercent: person.faultPercent,
      occupation: person.occupation ?? "",
      age: person.age,
    };
    return {
      ...newPerson(newId(), person.role),
      ...values,
      inferred: [...person.inferred],
      heard: PERSON_KEYS.filter((key) => values[key] !== null && values[key] !== ""),
    };
  });

  return {
    ...draft,
    accident: { ...accident, inferred: [...inferred], heard: [...heard], extracted: true },
    // 사람을 하나도 뽑지 못했으면 적어 둔 사람 카드를 지우지 않는다.
    people: people.length > 0 ? people : draft.people,
    vehicle: { ...draft.vehicle, damage: facts.accident.vehicleDamage ?? draft.vehicle.damage },
  };
}
