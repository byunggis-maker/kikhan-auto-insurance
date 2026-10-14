// 부족한 입력(MissingInfo.field)이 어느 화면의 어느 칸인지 알려 준다. "부족 정보" 버튼이 이 주소로 이동한다.

export type FieldTarget = { step: "policy" | "accident" | "people"; anchor: string };

/** 사람 카드 안에 입력 칸이 있는 것 */
const PERSON_FIELDS: Record<string, string> = {
  "injury.grade": "injuryGrade",
  "injury.treatmentCost": "treatmentCost",
  "injury.hospitalDays": "hospitalDays",
  "injury.outpatientDays": "outpatientDays",
  "injury.daysOffWork": "daysOffWork",
  faultPercent: "faultPercent",
  occupationType: "occupation",
  monthlyIncome: "monthlyIncome",
  age: "age",
};

const VEHICLE_FIELDS: Record<string, string> = {
  "vehicle.repairCost": "repairCost",
  "vehicle.valueAtAccident": "valueAtAccident",
  "vehicle.firstRegisteredOn": "firstRegisteredOn",
  "vehicle.rental": "rentalDays",
  "vehicle.rental.days": "rentalDays",
  "vehicle.rental.rented": "rented",
  "vehicle.rental.dailyRate": "rentalDailyRate",
  "own.rentalRider.vehicleClass": "vehicleClass",
};

/** rowId: 칸이 속한 사람(행)의 id. 입력 칸이 아직 없는 항목은 null */
export function fieldTarget(field: string, rowId: string): FieldTarget | null {
  if (field === "accident.date") return { step: "accident", anchor: "f-accident-date" };
  if (field === "policy.productLine") return { step: "policy", anchor: "f-policy-productLine" };
  if (field === "liable.status") return { step: "accident", anchor: "f-accident-counterpartyInsurance" };
  if (field === "liable.bodily2Limit") return { step: "accident", anchor: "f-accident-counterpartyBodily2Limit" };
  if (field === "liable.propertyLimit") return { step: "accident", anchor: "f-accident-counterpartyPropertyLimit" };
  if (field === "vehicle.faultPercent") return { step: "people", anchor: `f-${rowId}-faultPercent` };
  if (field in VEHICLE_FIELDS) return { step: "people", anchor: `f-vehicle-${VEHICLE_FIELDS[field]}` };
  if (field.startsWith("vehicle.")) return { step: "people", anchor: "f-vehicle" };
  if (field in PERSON_FIELDS) return { step: "people", anchor: `f-${rowId}-${PERSON_FIELDS[field]}` };
  if (field === "injury") return { step: "people", anchor: `f-${rowId}-treatmentCost` };
  if (field.startsWith("own.") || field === "legal.plan") return { step: "policy", anchor: "f-policy-coverages" };
  return null;
}

export function fieldHref(caseId: string, field: string, rowId: string): string | null {
  const target = fieldTarget(field, rowId);
  return target ? `/cases/${caseId}/${target.step}#${target.anchor}` : null;
}
