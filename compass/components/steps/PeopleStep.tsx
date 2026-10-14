"use client";

import { StepShell } from "@/components/StepShell";
import { Card, Choice, NumberField, TextField, type FieldMark } from "@/components/ui";
import { suggestInjuryGrades } from "@/lib/engine/injury-grade";
import { injuryGradeMap } from "@/lib/rules/injury-grade-map";
import { newPerson } from "@/lib/draft/store";
import { personLabel } from "@/lib/draft/to-claim";
import {
  CARE_LABELS,
  RELATION_LABELS,
  ROLE_LABELS,
  VEHICLE_CLASS_LABELS,
  type PersonCare,
  type PersonDraft,
  type PersonRelation,
  type PersonRole,
  type VehicleClass,
} from "@/lib/draft/types";

const ROLES = Object.keys(ROLE_LABELS) as PersonRole[];
const RELATIONS = (Object.keys(RELATION_LABELS) as PersonRelation[]).map((value) => ({ value, label: RELATION_LABELS[value] }));
const CARES = (Object.keys(CARE_LABELS) as PersonCare[]).map((value) => ({ value, label: CARE_LABELS[value] }));
/** 사실 추출이 채우는 사람 칸. 추출로 만든 카드에서 이 칸이 비어 있으면 "확인 필요"를 붙인다. */
const EXTRACTED = ["relation", "injury", "diagnosis", "surgery", "care", "hospitalDays", "outpatientDays", "faultPercent", "occupation", "age"];
const GRADES = Array.from(new Set(injuryGradeMap.items.map((item) => item.grade))).sort((a, b) => a - b);

/** 진단명·수술 여부로 찾은 상해급수 후보를 보여 주고 사용자가 고르게 한다. 후보일 뿐 확정이 아니다. */
function InjuryGradePicker({ person, onPick }: { person: PersonDraft; onPick: (grade: number | null) => void }) {
  const { candidates } = suggestInjuryGrades(
    { diagnosis: `${person.diagnosis} ${person.injury}`, surgery: person.surgery, hospitalDays: person.hospitalDays },
    injuryGradeMap,
  );
  return (
    <fieldset id={`f-${person.id}-injuryGrade`} className="flex scroll-mt-28 flex-col gap-3 rounded-xl border border-line p-4 target:border-navy">
      <legend className="px-1 font-semibold">상해급수</legend>
      <p className="text-sm text-muted">
        아래는 진단명으로 찾은 <strong>후보</strong>이며 확정이 아닙니다. 실제 급수는 진단서와 보험사 판단으로 정해지고, 여러 군데를 다쳤거나 수술 없이 치료한
        골절은 급수가 달라질 수 있습니다. 맞는 것을 직접 골라 주세요.
      </p>
      {candidates.length === 0 ? (
        <p className="rounded-xl bg-navy-soft px-4 py-3 text-navy">
          {person.diagnosis.trim() || person.injury.trim()
            ? "이 진단명으로는 후보를 찾지 못했습니다. 진단서를 보고 아래에서 직접 골라 주세요."
            : "정보 부족: 진단명을 입력하면 후보가 표시됩니다."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidates.map((candidate) => {
            const on = person.injuryGrade === candidate.grade;
            return (
              <li key={candidate.itemId}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onPick(candidate.grade)}
                  className={`w-full rounded-xl border-2 p-3 text-left ${on ? "border-navy bg-navy-soft" : "border-line bg-white"}`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="shrink-0 text-lg font-bold text-navy">{candidate.grade}급 후보</span>
                    <span className="font-semibold">{candidate.text}</span>
                  </span>
                  <span className="mt-1 block text-sm text-muted">{candidate.reason}</span>
                  <span className="mt-1 block text-sm text-muted">
                    근거: {candidate.basis} (약관 {candidate.page}쪽)
                    {candidate.status === "needs_check" && " · 약관 확인 필요"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="font-semibold">내가 고른 급수</span>
        <select
          className="min-h-13 w-full rounded-xl border border-line bg-white px-4 text-lg focus:border-navy"
          value={person.injuryGrade ?? ""}
          onChange={(e) => onPick(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">아직 고르지 않음</option>
          {GRADES.map((grade) => (
            <option key={grade} value={grade}>
              {grade}급
            </option>
          ))}
        </select>
        <span className="text-sm text-muted">진단서에 급수가 적혀 있으면 그 급수를 골라 주세요.</span>
      </label>
    </fieldset>
  );
}

const CLASSES = (Object.keys(VEHICLE_CLASS_LABELS) as VehicleClass[]).map((value) => ({ value, label: VEHICLE_CLASS_LABELS[value] }));
const RENTED = [
  { value: "yes" as const, label: "렌트했음" },
  { value: "no" as const, label: "렌트 안 함" },
];

const YES_NO = [
  { value: "yes" as const, label: "했음" },
  { value: "no" as const, label: "안 했음" },
];

export function PeopleStep() {
  // 진단·수술 등 건강정보는 이 브라우저에만 남고 서버로 가지 않으므로 동의 없이도 입력할 수 있다.
  // 서버로 보내는 기능(음성 변환, 사실 추출)만 건강정보 동의가 필요하다.
  return (
    <StepShell step={3} lead="다친 사람을 한 명씩 추가하고, 차량 피해를 적습니다.">
      {(draft, update) => {
        // 사용자가 고친 칸은 더 이상 추정이 아니다.
        const setPerson = (id: string, change: Partial<PersonDraft>) =>
          update((d) => ({
            ...d,
            people: d.people.map((p) =>
              p.id === id ? { ...p, ...change, inferred: p.inferred.filter((key) => !(key in change)), heard: p.heard.filter((key) => !(key in change)) } : p,
            ),
          }));
        // 음성에서 인식한 칸은 "음성에서 인식됨", 사실 추출로 만든 카드에서 비어 있는 칸은 "확인 필요"
        const mark = (person: PersonDraft, key: keyof PersonDraft): FieldMark | undefined =>
          person.heard.includes(key) ? "heard" : person.heard.length > 0 && EXTRACTED.includes(key) && (person[key] === null || person[key] === "") ? "check" : undefined;
        const guess = (person: PersonDraft, key: keyof PersonDraft) =>
          person.inferred.includes(key)
            ? () => update((d) => ({ ...d, people: d.people.map((p) => (p.id === person.id ? { ...p, inferred: p.inferred.filter((k) => k !== key) } : p)) }))
            : undefined;
        const setVehicle = (change: Partial<typeof draft.vehicle>) =>
          update((d) => ({
            ...d,
            vehicle: { ...d.vehicle, ...change },
            // 고친 차량 피해 칸은 더 이상 음성에서 인식한 값이 아니다.
            accident: "damage" in change ? { ...d.accident, heard: d.accident.heard.filter((key) => key !== "vehicleDamage") } : d.accident,
          }));
        const damageMark: FieldMark | undefined = draft.accident.heard.includes("vehicleDamage")
          ? "heard"
          : draft.accident.extracted && !draft.vehicle.damage
            ? "check"
            : undefined;

        return (
          <>
            {draft.people.map((person, index) => (
              <Card
                key={person.id}
                title={personLabel(draft.people, index)}
                action={
                  <button
                    type="button"
                    className="min-h-11 shrink-0 px-2 font-semibold text-muted underline"
                    onClick={() => update((d) => ({ ...d, people: d.people.filter((p) => p.id !== person.id) }))}
                  >
                    지우기
                  </button>
                }
              >
                <Choice
                  label="이 사람은"
                  value={person.role}
                  options={ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
                  onChange={(role) => setPerson(person.id, { role })}
                  onConfirmGuess={guess(person, "role")}
                  mark={mark(person, "role")}
                />
                <Choice
                  label="나와의 관계"
                  value={person.relation || null}
                  options={RELATIONS}
                  onChange={(relation) => setPerson(person.id, { relation })}
                  onConfirmGuess={guess(person, "relation")}
                  mark={mark(person, "relation")}
                />
                  <>
                    <TextField
                      label="다친 내용"
                      value={person.injury}
                      placeholder="예: 목과 허리가 아픔"
                      onChange={(injury) => setPerson(person.id, { injury })}
                      onConfirmGuess={guess(person, "injury")}
                      mark={mark(person, "injury")}
                    />
                    <TextField
                      label="진단명"
                      value={person.diagnosis}
                      placeholder="진단서에 적힌 그대로"
                      onChange={(diagnosis) => setPerson(person.id, { diagnosis })}
                      onConfirmGuess={guess(person, "diagnosis")}
                      mark={mark(person, "diagnosis")}
                    />
                    <Choice
                      label="수술"
                      value={person.surgery === null ? null : person.surgery ? "yes" : "no"}
                      options={YES_NO}
                      onChange={(v) => setPerson(person.id, { surgery: v === "yes" })}
                      onConfirmGuess={guess(person, "surgery")}
                      mark={mark(person, "surgery")}
                    />
                    <Choice
                      label="입원·통원"
                      value={person.care || null}
                      options={CARES}
                      onChange={(care) => setPerson(person.id, { care })}
                      onConfirmGuess={guess(person, "care")}
                      mark={mark(person, "care")}
                    />
                    <NumberField
                      anchor={`f-${person.id}-treatmentCost`}
                      label="치료비"
                      unit="원"
                      value={person.treatmentCost}
                      hint="병원비 영수증의 합계. 아직 치료 중이면 지금까지의 금액"
                      onChange={(treatmentCost) => setPerson(person.id, { treatmentCost })}
                    />
                    <NumberField
                      anchor={`f-${person.id}-hospitalDays`}
                      label="입원일"
                      unit="일"
                      max={3650}
                      value={person.hospitalDays}
                      onChange={(hospitalDays) => setPerson(person.id, { hospitalDays })}
                      onConfirmGuess={guess(person, "hospitalDays")}
                      mark={mark(person, "hospitalDays")}
                    />
                    <NumberField
                      anchor={`f-${person.id}-outpatientDays`}
                      label="통원일"
                      unit="일"
                      max={3650}
                      value={person.outpatientDays}
                      onChange={(outpatientDays) => setPerson(person.id, { outpatientDays })}
                      onConfirmGuess={guess(person, "outpatientDays")}
                      mark={mark(person, "outpatientDays")}
                    />
                    <InjuryGradePicker person={person} onPick={(injuryGrade) => setPerson(person.id, { injuryGrade })} />
                  </>
                <details className="rounded-xl border border-line" open={person.disabilityPercent !== null || person.deathDate !== ""}>
                  <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">후유장애·사망 (해당할 때만)</summary>
                  <div className="flex flex-col gap-4 border-t border-line p-4">
                    <NumberField anchor={`f-${person.id}-disabilityPercent`} label="노동능력상실률 (후유장애 판정을 받았을 때)" unit="%" max={100} value={person.disabilityPercent} onChange={(disabilityPercent) => setPerson(person.id, { disabilityPercent })} />
                    <NumberField anchor={`f-${person.id}-disabilityGrade`} label="후유장애 급수" unit="급" max={14} value={person.disabilityGrade} onChange={(disabilityGrade) => setPerson(person.id, { disabilityGrade: disabilityGrade === 0 ? null : disabilityGrade })} />
                    <TextField anchor={`f-${person.id}-deathDate`} label="사망일 (사망했을 때)" type="date" value={person.deathDate} onChange={(deathDate) => setPerson(person.id, { deathDate })} />
                    <p className="text-sm text-muted">상실수익액과 위자료는 만 나이로 계산하고, 생일을 모르는 만큼 최소~최대로 보여 드립니다.</p>
                  </div>
                </details>
                <NumberField anchor={`f-${person.id}-age`} label="만 나이 (사고일 기준)" unit="세" max={120} value={person.age} onChange={(age) => setPerson(person.id, { age })} onConfirmGuess={guess(person, "age")} mark={mark(person, "age")} />
                <TextField
                  anchor={`f-${person.id}-occupation`}
                  label="직업"
                  placeholder="예: 회사원, 자영업, 주부, 학생, 무직"
                  value={person.occupation}
                  onChange={(occupation) => setPerson(person.id, { occupation })}
                  onConfirmGuess={guess(person, "occupation")}
                  mark={mark(person, "occupation")}
                />
                <NumberField anchor={`f-${person.id}-monthlyIncome`} label="월소득" unit="원" value={person.monthlyIncome} onChange={(monthlyIncome) => setPerson(person.id, { monthlyIncome })} />
                <NumberField
                  anchor={`f-${person.id}-daysOffWork`}
                  label="일을 쉰 날"
                  unit="일"
                  max={3650}
                  value={person.daysOffWork}
                  hint="쉬지 않았으면 0을 적어 주세요."
                  onChange={(daysOffWork) => setPerson(person.id, { daysOffWork })}
                />
                <NumberField
                  anchor={`f-${person.id}-faultPercent`}
                  label="과실비율"
                  unit="%"
                  max={100}
                  value={person.faultPercent}
                  hint="이 사람 쪽의 과실입니다. 과실이 없으면 0을 적어 주세요."
                  onChange={(faultPercent) => setPerson(person.id, { faultPercent })}
                  onConfirmGuess={guess(person, "faultPercent")}
                  mark={mark(person, "faultPercent")}
                />
              </Card>
            ))}

            <Card title="사람 추가">
              <div className="grid grid-cols-2 gap-3">
                {ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    className="min-h-14 rounded-2xl border-2 border-navy text-lg font-bold text-navy"
                    onClick={() => update((d) => ({ ...d, people: [...d.people, newPerson(crypto.randomUUID(), role)] }))}
                  >
                    + {ROLE_LABELS[role]}
                  </button>
                ))}
              </div>
            </Card>

            <div id="f-vehicle" className="scroll-mt-28">
              <Card title="차량 피해">
                <p className="text-muted">내 차량의 피해입니다. 과실비율은 운전자 카드에 적은 값을 씁니다.</p>
                <TextField label="피해 내용 (파손 부위)" value={draft.vehicle.damage} placeholder="예: 뒤 범퍼가 찌그러짐" onChange={(damage) => setVehicle({ damage })} mark={damageMark} />
                <NumberField anchor="f-vehicle-repairCost" label="수리비" unit="원" value={draft.vehicle.repairCost} hint="견적서나 정비소에서 들은 금액" onChange={(repairCost) => setVehicle({ repairCost })} />
                <NumberField
                  anchor="f-vehicle-valueAtAccident"
                  label="사고 직전 차량가액"
                  unit="원"
                  value={draft.vehicle.valueAtAccident}
                  hint="증권의 차량가액이나 보험사가 알려 준 금액"
                  onChange={(valueAtAccident) => setVehicle({ valueAtAccident })}
                />
                <TextField anchor="f-vehicle-firstRegisteredOn" label="출고일(최초 등록일)" type="date" value={draft.vehicle.firstRegisteredOn} hint="자동차등록증에 있습니다. 시세하락손해를 확인하는 데 씁니다." onChange={(firstRegisteredOn) => setVehicle({ firstRegisteredOn })} />
                <NumberField anchor="f-vehicle-rentalDays" label="차를 쓰지 못한 기간" unit="일" max={365} value={draft.vehicle.rentalDays} hint="수리 때문에 차를 못 쓴 날수. 없으면 0" onChange={(rentalDays) => setVehicle({ rentalDays })} />
                <Choice anchor="f-vehicle-rented" label="그동안 렌트를" value={draft.vehicle.rented === null ? null : draft.vehicle.rented ? "yes" : "no"} options={RENTED} onChange={(v) => setVehicle({ rented: v === "yes" })} />
                <NumberField
                  anchor="f-vehicle-rentalDailyRate"
                  label="같은 급 차량의 1일 렌트 요금"
                  unit="원"
                  value={draft.vehicle.rentalDailyRate}
                  hint="렌트하지 않았어도 요금을 알면 적어 주세요."
                  onChange={(rentalDailyRate) => setVehicle({ rentalDailyRate })}
                />
                <Choice anchor="f-vehicle-vehicleClass" label="내 차의 크기 (렌트비용 특약이 있을 때)" value={draft.vehicle.vehicleClass || null} options={CLASSES} onChange={(vehicleClass) => setVehicle({ vehicleClass })} />
              </Card>
            </div>
          </>
        );
      }}
    </StepShell>
  );
}
