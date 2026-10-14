import type { VehicleDamage } from "@/lib/schemas/vehicle-claim";
import { addYears } from "./dates";
import { exceedsPercent } from "./decimal";
import { same, won } from "./range";
import { scale, type Rules } from "./rules";
import type { LineStatus, MissingInfo, Notice, Range, Scenario } from "./types";

// 차량 한 대의 물적 손해 장부. 대물배상 지급기준(별표2)의 항목을 여기서 한 번만 만든다.
// 대물배상·자기차량손해·렌트비용 특약은 이 장부의 줄을 가져다 쓴다.

export type PropertyItem = "repair" | "exchange_value" | "rental" | "idle" | "depreciation" | "towing";

export type PropertyLine = {
  item: PropertyItem;
  label: string;
  status: LineStatus;
  amount: Range | null;
  formula: string;
  ruleIds: string[];
  missing: MissingInfo[];
  flags: Notice[];
  /** true면 이 줄이 없을 때 대물배상을 계산하지 않는다 */
  required: boolean;
};

export type PropertyLedger = { lines: PropertyLine[] };

type Base = { item: PropertyItem; label: string; required?: boolean };
const line = (b: Base, status: LineStatus, amount: Range | null, formula: string, ruleIds: string[], missing: MissingInfo[] = []): PropertyLine => ({
  item: b.item,
  label: b.label,
  required: b.required ?? false,
  status,
  amount,
  formula,
  ruleIds,
  missing,
  flags: [],
});
const calculated = (b: Base, amount: Range | number, formula: string, ruleIds: string[] = []) => line(b, "calculated", typeof amount === "number" ? same(amount) : amount, formula, ruleIds);
const missing = (b: Base, info: MissingInfo[], ruleIds: string[] = []) => line(b, "missing", null, info.map((m) => m.message).join(" / "), ruleIds, info);
const needsCheck = (b: Base, formula: string, ruleIds: string[]) => line(b, "needs_check", null, formula, ruleIds);
const notApplicable = (b: Base, formula: string, ruleIds: string[] = []) => line(b, "not_applicable", null, formula, ruleIds);

/** 수리비(수리 가능) 또는 교환가액(전손) */
function mainLoss(damage: VehicleDamage, rules: Rules): PropertyLine {
  if (damage.totalLoss === true) {
    const b = { item: "exchange_value" as const, label: "교환가액(전손)", required: true };
    if (damage.valueAtAccident === null) return missing(b, [{ field: "vehicle.valueAtAccident", message: "사고 직전 차량가액을 입력하면 계산됩니다" }]);
    return calculated(b, damage.valueAtAccident, `수리하지 않고 폐차하는 경우: 사고 직전 차량가액 ${won(damage.valueAtAccident)}`);
  }
  const b = { item: "repair" as const, label: "수리비", required: true };
  if (damage.repairCost === null) return missing(b, [{ field: "vehicle.repairCost", message: "수리비를 입력하면 계산됩니다" }]);
  const repair = damage.repairCost;
  const assumed = damage.totalLoss === null ? " (수리할 수 있는 사고로 보고 계산)" : "";
  if (damage.valueAtAccident === null) {
    const result = calculated(b, repair, `실제 수리비 ${won(repair)}${assumed}`);
    result.missing.push({ field: "vehicle.valueAtAccident", message: "사고 직전 차량가액을 입력하면 수리비 한도를 확인합니다" });
    return result;
  }
  const used: string[] = [];
  const standard = rules.number("property.repair.capPercent", used);
  const extended = rules.number("property.repair.capPercentExtended", used);
  if (standard === null || extended === null) return needsCheck(b, "수리비 한도 기준을 확인하지 못했습니다", used);
  const value = damage.valueAtAccident;
  const capped = (percent: number) => {
    const cap = scale(rules, used, value, [[percent, 100]]);
    return cap === null ? null : Math.min(repair, cap);
  };
  // 한도가 넓어지는 차량인지 모르면 최소·예상은 기본 한도, 최대는 넓은 한도로 계산한다.
  const low = capped(damage.extendedRepairCap === true ? extended : standard);
  const high = capped(damage.extendedRepairCap === false ? standard : extended);
  if (low === null || high === null) return needsCheck(b, "원 미만 처리 방식을 확인하지 못했습니다", used);
  const percentText = damage.extendedRepairCap === null ? `${standard}%(내용연수가 지난 차량 등은 ${extended}%)` : `${damage.extendedRepairCap ? extended : standard}%`;
  return calculated(b, { min: low, expected: low, max: high }, `실제 수리비 ${won(repair)}, 한도는 사고 직전 차량가액 ${won(value)}의 ${percentText}${assumed}`, used);
}

function rental(damage: VehicleDamage, rules: Rules): PropertyLine {
  const b = { item: "rental" as const, label: "대차료(렌트비)" };
  if (damage.commercialUse === true) return notApplicable(b, "사업용자동차는 대차료 대신 휴차료를 인정합니다");
  const input = damage.rental;
  if (input === null) return missing(b, [{ field: "vehicle.rental", message: "차를 쓰지 못한 기간과 렌트 여부를 입력하면 대차료가 더해집니다(없으면 0일)" }]);
  const need: MissingInfo[] = [];
  if (input.days === null) need.push({ field: "vehicle.rental.days", message: "차를 쓰지 못한 날수를 입력하면 대차료가 더해집니다" });
  if (input.days !== 0 && input.rented === null) need.push({ field: "vehicle.rental.rented", message: "렌트를 했는지 알려 주면 대차료가 더해집니다" });
  if (input.days !== 0 && input.dailyRate === null) need.push({ field: "vehicle.rental.dailyRate", message: "같은 급 차량의 1일 렌트 요금을 입력하면 대차료가 더해집니다" });
  if (need.length > 0 || input.days === null) return missing(b, need);
  if (input.days === 0) return calculated(b, 0, "차를 쓰지 못한 날이 없음 → 0원");

  const used: string[] = [];
  const maxDays = rules.number("property.rental.maxDays", used);
  const longDays = rules.number("property.rental.maxDaysLongRepair", used);
  const totalLossDays = rules.number("property.rental.totalLossDays", used);
  const notRented = rules.number("property.rental.notRentedPercent", used);
  if (maxDays === null || longDays === null || totalLossDays === null || notRented === null) return needsCheck(b, "대차료 인정기간 기준을 확인하지 못했습니다", used);
  const rate = input.dailyRate as number;
  const amountFor = (cap: number) => scale(rules, used, rate, [[Math.min(input.days as number, cap), 1], input.rented ? [1, 1] : [notRented, 100]]);
  // 정비작업시간이 긴 경우인지 모르면 최소·예상은 기본 기간, 최대는 긴 기간으로 계산한다.
  const lowCap = damage.totalLoss === true ? totalLossDays : input.longRepair === true ? longDays : maxDays;
  const highCap = damage.totalLoss === true ? totalLossDays : input.longRepair === false ? maxDays : longDays;
  const low = amountFor(lowCap);
  const high = amountFor(highCap);
  if (low === null || high === null) return needsCheck(b, "원 미만 처리 방식을 확인하지 못했습니다", used);
  const capText = lowCap === highCap ? `${lowCap}일` : `${lowCap}일(정비작업시간이 길면 ${highCap}일)`;
  return calculated(
    b,
    { min: low, expected: low, max: high },
    `1일 ${won(rate)} × ${Math.min(input.days, lowCap)}일(쓰지 못한 ${input.days}일, 인정 한도 ${capText})${input.rented ? "" : ` × ${notRented}%(렌트하지 않음)`} = ${won(low)}`,
    used,
  );
}

function idle(damage: VehicleDamage, rules: Rules): PropertyLine | null {
  const b = { item: "idle" as const, label: "휴차료" };
  if (damage.commercialUse !== true) return damage.idle === null ? null : notApplicable(b, "휴차료는 사업용자동차에만 인정합니다");
  const input = damage.idle;
  if (input === null || input.days === null) return missing(b, [{ field: "vehicle.idle.days", message: "영업하지 못한 날수를 입력하면 휴차료가 더해집니다(없으면 0일)" }]);
  if (input.days === 0) return calculated(b, 0, "영업하지 못한 날이 없음 → 0원");
  if (input.dailyAmount === null) return missing(b, [{ field: "vehicle.idle.dailyAmount", message: "1일 영업수입에서 운행경비를 뺀 금액(또는 휴차료 일람표 금액)을 입력하면 휴차료가 더해집니다" }]);
  const used: string[] = [];
  const cap = rules.number(damage.totalLoss === true ? "property.idle.totalLossDays" : "property.idle.maxDays", used);
  if (cap === null) return needsCheck(b, "휴차료 인정기간 기준을 확인하지 못했습니다", used);
  const counted = Math.min(input.days, cap);
  return calculated(b, input.dailyAmount * counted, `1일 ${won(input.dailyAmount)} × ${counted}일(쉰 ${input.days}일, 인정 한도 ${cap}일) = ${won(input.dailyAmount * counted)}`, used);
}

type Band = { overYears: number; upToYears: number; percent: number };

function depreciation(damage: VehicleDamage, accidentDate: string, rules: Rules): PropertyLine {
  const b = { item: "depreciation" as const, label: "자동차시세하락손해" };
  if (damage.totalLoss === true) return notApplicable(b, "시세하락손해는 수리하는 경우에만 인정합니다");
  const need: MissingInfo[] = [];
  if (damage.repairCost === null) need.push({ field: "vehicle.repairCost", message: "수리비를 입력하면 시세하락손해를 확인합니다" });
  if (damage.firstRegisteredOn === null) need.push({ field: "vehicle.firstRegisteredOn", message: "출고일을 입력하면 시세하락손해를 확인합니다" });
  if (damage.valueAtAccident === null) need.push({ field: "vehicle.valueAtAccident", message: "사고 직전 차량가액을 입력하면 시세하락손해를 확인합니다" });
  if (damage.repairCost === null || damage.firstRegisteredOn === null || damage.valueAtAccident === null) return missing(b, need);

  const used: string[] = [];
  const maxAge = rules.number("property.depreciation.maxVehicleAgeYears", used);
  const minRatio = rules.number("property.depreciation.minRepairRatioPercent", used);
  const bands = rules.list<Band>("property.depreciation.bands", used);
  if (maxAge === null || minRatio === null || bands === null) return needsCheck(b, "시세하락손해 기준을 확인하지 못했습니다", used);
  const registered = damage.firstRegisteredOn;
  if (accidentDate > addYears(registered, maxAge)) return notApplicable(b, `출고 후 ${maxAge}년이 지난 차량은 대상이 아닙니다`, used);
  if (!exceedsPercent(damage.repairCost, damage.valueAtAccident, minRatio))
    return notApplicable(b, `수리비 ${won(damage.repairCost)}이 사고 직전 차량가액 ${won(damage.valueAtAccident)}의 ${minRatio}%를 넘지 않아 대상이 아닙니다`, used);
  const band = bands.find((row) => accidentDate <= addYears(registered, row.upToYears));
  if (!band) return needsCheck(b, "출고 후 기간에 맞는 시세하락손해 비율을 확인하지 못했습니다", used);
  const amount = scale(rules, used, damage.repairCost, [[band.percent, 100]]);
  if (amount === null) return needsCheck(b, "원 미만 처리 방식을 확인하지 못했습니다", used);
  return calculated(b, amount, `수리비 ${won(damage.repairCost)} × ${band.percent}%(출고 후 ${band.upToYears}년 이하) = ${won(amount)}`, used);
}

export function buildPropertyLedger(damage: VehicleDamage, accidentDate: string, rules: Rules): PropertyLedger {
  const lines = [mainLoss(damage, rules), rental(damage, rules), idle(damage, rules), depreciation(damage, accidentDate, rules)].filter((row): row is PropertyLine => row !== null);
  if (damage.towingCost !== null) lines.push(calculated({ item: "towing", label: "견인비용" }, damage.towingCost, `실제 견인비용 ${won(damage.towingCost)}`));
  return { lines };
}

/** 계산된 줄의 금액. 계산되지 않은 줄은 0으로 본다 */
export function lineAmount(ledger: PropertyLedger, item: PropertyItem, scenario: Scenario) {
  const found = ledger.lines.find((row) => row.item === item);
  return found?.status === "calculated" && found.amount ? found.amount[scenario] : 0;
}
