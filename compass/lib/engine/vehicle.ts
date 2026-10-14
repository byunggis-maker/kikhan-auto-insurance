import type { VehicleClaim } from "@/lib/schemas/vehicle-claim";
import { makeCell, notApplicableCell, unique, type CellParts } from "./cell";
import { liabilityProperty } from "./coverages/liability-property";
import { ownDamage } from "./coverages/own-damage";
import { buildPropertyLedger, type PropertyItem } from "./property-ledger";
import { won } from "./range";
import { scale, type Rules } from "./rules";
import { combineSimple } from "./steps";
import type { CellLine, CoverageCell, CoverageKey, MissingInfo, Scenario } from "./types";

// 차량 한 대의 담보 사이 관계를 처리하는 곳.
//   ① 대물배상        : 상대 차량의 보험(상대방 쪽 차량이면 내 보험). 손해액 × (100 − 이 차량 쪽 과실)%, 가입금액까지.
//   ② 자기차량손해    : 내 보험. 손해액에서 ①이 처리하는 수리비(또는 교환가액)를 빼고 자기부담금을 뺀다.
//   ③ 렌트비용지원 특약: 내 보험. ②가 지급될 때만. ①이 처리하는 대차료를 뺀다.
// 뒤 담보가 앞 담보의 금액을 빼므로 계산된 칸끼리는 금액이 겹치지 않는다.

type Deduction = { amount: number; assumed: boolean };

export function calculateVehicleCoverages(claim: VehicleClaim, accidentDate: string, rules: Rules): CoverageCell[] {
  const { damage, liable, own, side } = claim;
  const ledger = buildPropertyLedger(damage, accidentDate, rules);
  const lossLines: CellLine[] = ledger.lines.map((row) => ({ kind: "loss", item: row.item, label: row.label, amount: row.amount, formula: row.formula, ruleIds: row.ruleIds, flags: row.flags }));
  const ledgerRuleIds = ledger.lines.filter((row) => row.status !== "missing").flatMap((row) => row.ruleIds);
  const main = ledger.lines[0];
  const mainItem: PropertyItem = main.item;
  const optionalGaps = ledger.lines.filter((row) => !(row.required && row.status === "missing")).flatMap((row) => row.missing);
  const partial = ledger.lines.some((row) => !row.required && (row.status === "missing" || row.status === "needs_check"));

  const cell = (coverage: CoverageKey, parts: CellParts, ruleIds: string[] = []) => makeCell(rules, coverage, parts, ruleIds);
  const insufficient = (coverage: CoverageKey, missing: MissingInfo[]) =>
    cell(coverage, { status: "insufficient_info", amount: null, lines: lossLines, missing, flags: [], reason: `정보 부족: ${missing.map((m) => m.message).join(" / ")}` });
  const needsCheck = (coverage: CoverageKey, reason: string, ruleIds: string[]) => cell(coverage, { status: "needs_check", amount: null, lines: lossLines, missing: [], flags: [], reason: `약관 확인 필요: ${reason}` }, ruleIds);
  const faultMissing: MissingInfo[] = [{ field: "vehicle.faultPercent", message: "과실비율을 입력하면 계산됩니다" }];

  // ── ① 대물배상 ──
  const noLiableParty = liable.status === "no_counterparty" ? "상대 차량이 없는 사고라 배상받을 상대가 없습니다" : damage.faultPercent === 100 ? "이 차량 쪽의 과실이 100%라 상대방에게 배상책임이 없습니다" : null;
  const used: string[] = [];
  const offsetRule = rules.flag("fault.propertyOffset", used);
  const fault = damage.faultPercent;
  /** 이 차량 손해 가운데 대물배상이 지급하는 금액. limit이 "unlimited"이면 가입금액을 모를 때의 가정 계산이다 */
  const payment = (scenario: Scenario, limit: number | "unlimited") => (fault === null ? null : liabilityProperty(ledger, fault, limit, scenario, rules, used));

  let propertyCell: CoverageCell;
  let propertyPaid = false;
  if (noLiableParty) propertyCell = notApplicableCell(rules, "liability_property", noLiableParty);
  else if (liable.status === "unknown") propertyCell = insufficient("liability_property", [{ field: "liable.status", message: "상대 차량의 보험 가입 여부를 입력하면 계산됩니다" }]);
  else if (liable.status === "none") propertyCell = notApplicableCell(rules, "liability_property", "상대 차량이 대물배상에 가입하지 않았습니다. 상대방에게 직접 청구해야 합니다");
  else if (main.status === "missing") propertyCell = insufficient("liability_property", main.missing);
  else if (main.status === "needs_check") propertyCell = needsCheck("liability_property", main.formula, main.ruleIds);
  else if (fault === null) propertyCell = insufficient("liability_property", faultMissing);
  else if (offsetRule === null) propertyCell = needsCheck("liability_property", "대물배상 과실상계 기준을 확인하지 못했습니다", used);
  else if (liable.propertyLimit === null)
    propertyCell = insufficient("liability_property", [
      side === "mine"
        ? { field: "liable.propertyLimit", message: "상대방 계약 확인 필요: 상대방의 대물배상 가입금액을 입력하면 계산됩니다" }
        : { field: "liable.propertyLimit", message: "내 증권의 대물배상 가입금액을 입력하면 계산됩니다" },
    ]);
  else {
    const limit = liable.propertyLimit;
    const result = combineSimple((scenario) => {
      const paid = payment(scenario, limit);
      if (paid === null) return null;
      return {
        value: paid.paid,
        steps: [
          { item: "after_fault", label: "과실상계 후", value: paid.afterFault, formula: paid.formulas.afterFault, ruleIds: ["fault.propertyOffset"] },
          { item: "limit", label: "지급 예상액", value: paid.paid, formula: paid.formulas.limit, ruleIds: [] },
        ],
      };
    });
    if (result === null) propertyCell = needsCheck("liability_property", "원 미만 처리 방식을 확인하지 못했습니다", used);
    else {
      propertyPaid = true;
      propertyCell = cell(
        "liability_property",
        { status: "calculated", amount: result.amount, lines: [...lossLines, ...result.steps], missing: optionalGaps, flags: partial ? ["partial"] : [], reason: null },
        [...ledgerRuleIds, ...used],
      );
    }
  }
  if (!own) return [propertyCell];

  // ── 내 보험에서 뺄 금액: 상대방 대물배상이 처리하는 부분 ──
  // 처리분을 알 수 없으면(상대 보험을 모르거나 가입금액을 모름) "최소"에서만 과실분 전부를 처리받는 경우를 가정하고, 예상·최대는 빼지 않는다.
  const deductionKnown = noLiableParty !== null || propertyPaid;
  function recovered(item: PropertyItem, scenario: Scenario): Deduction | null {
    if (noLiableParty) return { amount: 0, assumed: false };
    if (propertyPaid) {
      const paid = payment(scenario, liable.propertyLimit as number);
      return paid === null ? null : { amount: paid.byItem[item] ?? 0, assumed: false };
    }
    if (scenario !== "min") return { amount: 0, assumed: true };
    const paid = payment(scenario, "unlimited");
    return paid === null ? null : { amount: paid.byItem[item] ?? 0, assumed: true };
  }
  const ownFlags = deductionKnown ? [] : ["deduction_unknown"];

  // ── ② 자기차량손해 ──
  let ownCell: CoverageCell;
  let ownPaid = false;
  if (own.ownDamage === null) ownCell = notApplicableCell(rules, "own_damage", "가입하지 않은 담보입니다");
  else {
    const terms = own.ownDamage;
    const ownUsed: string[] = [];
    const waivedRule = rules.flag("ownDamage.deductible.waivedOnTotalLoss", ownUsed);
    const netRule = rules.flag("ownDamage.deductible.onNetOfRecovery", ownUsed);
    const need: MissingInfo[] = main.status === "missing" ? [...main.missing] : [];
    if (terms.limit === null) need.push({ field: "own.ownDamage.limit", message: "자기차량손해 가입금액을 입력하면 계산됩니다" });
    if (terms.deductible === null) need.push({ field: "own.ownDamage.deductible", message: "증권의 자기부담금 조건(정액, 또는 비율·최소·최대)을 입력하면 계산됩니다" });
    if (!noLiableParty && fault === null) need.push(...faultMissing);
    if (need.length > 0 || terms.limit === null || terms.deductible === null) ownCell = insufficient("own_damage", need);
    else if (main.status !== "calculated" || !main.amount) ownCell = needsCheck("own_damage", main.formula, main.ruleIds);
    else if (waivedRule === null || netRule === null) ownCell = needsCheck("own_damage", "자기부담금 적용 기준을 확인하지 못했습니다", ownUsed);
    else {
      const { limit, deductible } = terms;
      // 자기차량손해의 손해액은 실제 수리비(또는 전손 가액)다. 대물배상의 수리비 한도(차량가액의 일정 비율)는 쓰지 않는다.
      const loss = damage.totalLoss === true ? (damage.valueAtAccident as number) : (damage.repairCost as number);
      const flags = [...ownFlags];
      if (deductible.type === "rate") {
        const options = rules.list<{ ratePercent: number; min: number; max: number }>("ownDamage.deductible.options", ownUsed);
        if (!options?.some((row) => row.ratePercent === deductible.ratePercent && row.min === deductible.min && row.max === deductible.max)) flags.push("deductible_not_in_table");
      }
      const result = combineSimple((scenario) => {
        const deduction = recovered(mainItem, scenario);
        return deduction === null ? null : ownDamage(damage, loss, { limit, deductible, waivedOnTotalLoss: waivedRule, onNetOfRecovery: netRule }, deduction.amount, rules, ownUsed);
      });
      if (result === null) ownCell = needsCheck("own_damage", "원 미만 처리 방식을 확인하지 못했습니다", ownUsed);
      else {
        ownPaid = true;
        ownCell = cell("own_damage", { status: "calculated", amount: result.amount, lines: [lossLines[0], ...result.steps], missing: main.missing, flags, reason: null }, [...main.ruleIds, ...ownUsed, ...used]);
      }
    }
  }

  // ── ③ 렌트비용지원 특약 ──
  let rentalCell: CoverageCell;
  if (own.rentalRider === null) rentalCell = notApplicableCell(rules, "rider_rental", "가입하지 않은 특약입니다");
  else if (own.ownDamage === null) rentalCell = notApplicableCell(rules, "rider_rental", "자기차량손해 보험금이 지급되는 경우에만 지급하는 특약입니다");
  else if (!ownPaid) {
    const reason = "자기차량손해 보험금이 지급되는 경우에만 지급합니다. 자기차량손해가 계산되면 함께 계산됩니다";
    rentalCell = ownCell.status === "needs_check" ? needsCheck("rider_rental", reason, []) : insufficient("rider_rental", [{ field: "own.ownDamage", message: reason }]);
  } else {
    const input = damage.rental;
    const vehicleClass = own.rentalRider.vehicleClass;
    const need: MissingInfo[] = [];
    if (input === null || input.days === null) need.push({ field: "vehicle.rental.days", message: "차를 쓰지 못한 날수를 입력하면 계산됩니다" });
    else if (input.days > 0) {
      if (input.rented === null) need.push({ field: "vehicle.rental.rented", message: "렌트를 했는지 알려 주면 계산됩니다" });
      if (input.dailyRate === null) need.push({ field: "vehicle.rental.dailyRate", message: "같은 급 차량의 1일 렌트 요금을 입력하면 계산됩니다" });
    }
    if (vehicleClass === null) need.push({ field: "own.rentalRider.vehicleClass", message: "차종(배기량 구분)을 고르면 1일 한도를 알 수 있습니다" });
    const riderUsed: string[] = [];
    const dailyLimit = vehicleClass === null ? null : rules.number(`rider.rental.dailyLimit.${vehicleClass}`, riderUsed);
    const notRented = rules.number("rider.rental.notRentedPercent", riderUsed);
    const maxDays = rules.number(damage.totalLoss === true ? "rider.rental.totalLossDays" : "rider.rental.maxDays", riderUsed);
    if (need.length > 0 || input === null || input.days === null) rentalCell = insufficient("rider_rental", need);
    else if (dailyLimit === null || notRented === null || maxDays === null) rentalCell = needsCheck("rider_rental", "렌트비용 한도 기준을 확인하지 못했습니다", riderUsed);
    else {
      const days = Math.min(input.days, maxDays);
      const rate = input.dailyRate ?? 0;
      const result = combineSimple((scenario) => {
        const share = input.rented ? [1, 1] : [notRented, 100];
        const byRate = scale(rules, riderUsed, rate, [share as [number, number]]);
        const byLimit = scale(rules, riderUsed, dailyLimit, [share as [number, number]]);
        const deduction = recovered("rental", scenario);
        if (byRate === null || byLimit === null || deduction === null) return null;
        const perDay = Math.min(byRate, byLimit);
        const gross = perDay * days;
        const net = Math.max(0, gross - deduction.amount);
        return {
          value: net,
          steps: [
            {
              item: "rider_rental_gross",
              label: "렌트비용",
              value: gross,
              formula: `1일 ${won(perDay)}(요금 ${won(rate)}${input.rented ? "" : `의 ${notRented}%`}, 차종별 한도 ${won(byLimit)} 이내) × ${days}일(쓰지 못한 ${input.days}일, 인정 한도 ${maxDays}일) = ${won(gross)}`,
              ruleIds: [],
            },
            { item: "rider_rental_paid", label: "지급 예상액", value: net, formula: `${won(gross)} − 상대방 대물배상 대차료 처리분 ${won(deduction.amount)} = ${won(net)}`, ruleIds: [] },
          ],
        };
      });
      rentalCell =
        result === null
          ? needsCheck("rider_rental", "원 미만 처리 방식을 확인하지 못했습니다", riderUsed)
          : cell("rider_rental", { status: "calculated", amount: result.amount, lines: result.steps, missing: [], flags: unique(ownFlags), reason: null }, [...riderUsed, ...used]);
    }
  }
  return [propertyCell, ownCell, rentalCell];
}
