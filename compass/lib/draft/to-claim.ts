import { moneyAfterLabel, parseDeductible, singleMoney, type Money } from "@/lib/engine/money";
import type { MissingInfo } from "@/lib/engine/types";
import { accidentClaimSchema, type AccidentClaim } from "@/lib/schemas/accident-claim";
import type { CaseDraft, CoverageDraft, PersonDraft } from "./types";
import { ROLE_LABELS } from "./types";

// 화면의 입력 초안을 계산 엔진의 입력으로 바꾼다. 금액을 계산하지 않는다.
// 입력하지 않은 칸은 null로 넘겨 엔진이 "정보 부족"으로 표시하게 한다. 0으로 채우지 않는다.

export type ClaimResult = { ok: true; claim: AccidentClaim } | { ok: false; missing: MissingInfo[] };

/** 같은 담보인지 견줄 때 쓰는 꼴 */
const plain = (name: string) => name.replace(/\s/g, "").replace(/Ⅰ/g, "I").replace(/Ⅱ/g, "II").toUpperCase();
const find = (coverages: CoverageDraft[], test: (name: string) => boolean) => coverages.find((coverage) => coverage.joined && test(plain(coverage.name))) ?? null;

const MATCHERS = {
  bodily1: (name: string) => /대인(배상)?(I|1)$/.test(name),
  bodily2: (name: string) => /대인(배상)?(II|2)$/.test(name),
  property: (name: string) => name.includes("대물"),
  selfInjury: (name: string) => name.includes("자기신체") || name === "자손",
  autoInjury: (name: string) => name.includes("자동차상해") || name === "자상",
  uninsured: (name: string) => name.includes("무보험"),
  ownDamage: (name: string) => name.includes("자기차량") || name === "자차",
  legal: (name: string) => name.includes("법률비용"),
  rental: (name: string) => name.includes("렌트비용"),
};

const won = (value: Money | null) => (typeof value === "number" ? value : null);

function occupationType(text: string) {
  const value = text.replace(/\s/g, "");
  if (!value) return null;
  if (/주부|가사/.test(value)) return "homemaker" as const;
  if (/무직|없음|백수/.test(value)) return "unemployed" as const;
  if (/학생/.test(value)) return "student" as const;
  if (/연금/.test(value)) return "pensioner" as const;
  if (/자영|사업|가게|프리랜서/.test(value)) return "self_employed" as const;
  if (/회사|직장|사원|공무원|근로|교사|간호/.test(value)) return "employee" as const;
  return "other" as const;
}

function legalPlan(text: string) {
  const value = plain(text);
  if (/최고급형(II|2)/.test(value)) return "top2" as const;
  if (value.includes("최고급형")) return "top" as const;
  // 영업용 약관의 "고보장형"은 한도가 고급형과 같다.
  if (value.includes("고급형") || value.includes("고보장형")) return "premium" as const;
  if (value.includes("기본형")) return "basic" as const;
  return null;
}

const hasInjury = (person: PersonDraft) =>
  person.injuryGrade !== null || person.treatmentCost !== null || person.hospitalDays !== null || person.outpatientDays !== null || person.surgery !== null || !!person.injury.trim() || !!person.diagnosis.trim();

const FIRST_LABELS: Record<PersonDraft["role"], string> = {
  driver: "운전자(나)",
  passenger: "동승자 1",
  counterparty: "상대방",
  pedestrian: "보행자",
};

/** 사람 카드의 제목. 이름 대신 역할 이름을 쓴다: "운전자(나)", "동승자 1", "동승자 2", "상대방", "상대방 2" */
export function personLabel(people: PersonDraft[], index: number) {
  const person = people[index];
  const order = people.slice(0, index + 1).filter((other) => other.role === person.role).length;
  return order === 1 ? FIRST_LABELS[person.role] : `${ROLE_LABELS[person.role]} ${order}`;
}

export function toClaim(draft: CaseDraft): ClaimResult {
  const { policy, accident, vehicle } = draft;
  const missing: MissingInfo[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(accident.date)) missing.push({ field: "accident.date", message: "사고 날짜를 입력하면 계산됩니다" });
  if (!policy.productLine) missing.push({ field: "policy.productLine", message: "보험 종류(개인용·업무용·영업용·이륜)를 고르면 계산됩니다" });
  if (missing.length > 0 || !policy.productLine) return { ok: false, missing };

  const coverage = Object.fromEntries(Object.entries(MATCHERS).map(([key, test]) => [key, find(policy.coverages, test)])) as Record<keyof typeof MATCHERS, CoverageDraft | null>;
  const riderNames = [...policy.riders, ...policy.coverages.filter((c) => c.joined && !Object.values(MATCHERS).some((test) => test(plain(c.name)))).map((c) => c.name)].map((name) => name.trim()).filter(Boolean);
  const legalName = coverage.legal ? `${coverage.legal.name} ${coverage.legal.limit}` : (riderNames.find((name) => MATCHERS.legal(plain(name))) ?? null);
  const hasRental = coverage.rental !== null || riderNames.some((name) => MATCHERS.rental(plain(name)));

  const single = accident.kind === "single";
  const counterparty = accident.counterpartyInsurance || "unknown";
  const theirBodily = { status: single ? ("no_counterparty" as const) : counterparty, bodily2Limit: single ? null : singleMoney(accident.counterpartyBodily2Limit) };
  // 상대방 쪽 사람은 내 보험의 대인배상으로 보상한다. 한도는 내 증권의 대인배상Ⅱ다.
  const myBodily = coverage.bodily2
    ? { status: "full" as const, bodily2Limit: singleMoney(coverage.bodily2.limit) }
    : { status: coverage.bodily1 ? ("mandatory_only" as const) : ("unknown" as const), bodily2Limit: null };

  const own = {
    autoInjury: coverage.autoInjury
      ? { injuryLimit: moneyAfterLabel(coverage.autoInjury.limit, ["부상"]), deathDisabilityLimit: moneyAfterLabel(coverage.autoInjury.limit, ["사망", "후유장애", "후유장해"]) }
      : null,
    selfInjury: coverage.selfInjury
      ? {
          injuryLimit: won(moneyAfterLabel(coverage.selfInjury.limit, ["부상"])),
          deathLimit: won(moneyAfterLabel(coverage.selfInjury.limit, ["사망"])),
          disabilityLimit: won(moneyAfterLabel(coverage.selfInjury.limit, ["후유장애", "후유장해"])),
        }
      : null,
    uninsured: coverage.uninsured ? { limit: singleMoney(coverage.uninsured.limit) } : null,
  };

  const persons = draft.people.map((person, index) => {
    const mine = person.role === "driver" || person.role === "passenger";
    const driver = person.role === "driver";
    return {
      side: mine ? ("mine" as const) : ("others" as const),
      liable: mine ? theirBodily : myBodily,
      own: mine ? own : null,
      person: {
        id: person.id,
        label: personLabel(draft.people, index),
        age: person.age,
        faultPercent: person.faultPercent,
        occupationType: occupationType(person.occupation),
        monthlyIncome: person.monthlyIncome,
        incomeProven: null,
        // 이륜자동차 운전자는 경상환자 규정의 "차량운전자"가 아니다.
        vehicleDriver: driver ? policy.productLine !== "motorcycle" && accident.kind !== "motorcycle" : mine ? false : null,
        injury: hasInjury(person)
          ? {
              grade: person.injuryGrade,
              treatmentCost: person.treatmentCost,
              futureTreatmentCost: null,
              hospitalDays: person.hospitalDays,
              outpatientDays: person.outpatientDays,
              daysOffWork: person.daysOffWork,
              dailyIncomeLoss: null,
              mealsNotProvided: null,
              nursingProven: null,
            }
          : null,
        death: person.deathDate ? { date: person.deathDate } : null,
        disability: person.disabilityPercent !== null ? { lossRatePercent: String(person.disabilityPercent), grade: person.disabilityGrade, determinedOn: null } : null,
        receivedFromThirdParty: null,
        receivedFromLiableParty: null,
      },
    };
  });

  const driver = draft.people.find((person) => person.role === "driver");
  const driverIndex = driver ? draft.people.indexOf(driver) : -1;
  const insured = { id: driver?.id ?? "insured", label: driver ? personLabel(draft.people, driverIndex) : "본인" };
  const vehicleEntered = vehicle.repairCost !== null || vehicle.rentalDays !== null || !!vehicle.damage.trim();
  const vehicles = vehicleEntered
    ? [
        {
          side: "mine" as const,
          liable: {
            status: single ? ("no_counterparty" as const) : counterparty === "full" || counterparty === "mandatory_only" ? ("insured" as const) : counterparty === "unknown" ? ("unknown" as const) : ("none" as const),
            propertyLimit: single ? null : won(singleMoney(accident.counterpartyPropertyLimit)),
          },
          own: {
            ownDamage: coverage.ownDamage ? { limit: won(singleMoney(coverage.ownDamage.limit)), deductible: parseDeductible(coverage.ownDamage.deductible) } : null,
            rentalRider: hasRental ? { vehicleClass: vehicle.vehicleClass || null } : null,
          },
          damage: {
            id: "my-vehicle",
            label: `${insured.label}의 차량`,
            ownerId: insured.id,
            faultPercent: driver?.faultPercent ?? null,
            repairCost: vehicle.repairCost,
            totalLoss: null,
            valueAtAccident: vehicle.valueAtAccident,
            extendedRepairCap: null,
            firstRegisteredOn: /^\d{4}-\d{2}-\d{2}$/.test(vehicle.firstRegisteredOn) ? vehicle.firstRegisteredOn : null,
            commercialUse: policy.productLine === "commercial" ? true : policy.productLine === "personal" ? false : null,
            rental: vehicle.rentalDays === null ? null : { rented: vehicle.rented, days: vehicle.rentalDays, dailyRate: vehicle.rentalDailyRate, longRepair: null },
            idle: null,
            towingCost: null,
          },
        },
      ]
    : [];

  const claim = accidentClaimSchema.safeParse({
    accidentDate: accident.date,
    productLine: policy.productLine,
    persons,
    vehicles,
    // 법률비용의 실제 부담액(형사합의금·변호사비용·벌금)은 아직 입력 칸이 없다. 특약이 있으면 "정보 부족"으로 나온다.
    legal: legalName
      ? { insuredId: insured.id, insuredLabel: insured.label, plan: legalPlan(legalName), lawyerIncluded: true, fineIncluded: true, settlements: [], lawyerEligible: null, lawyerFee: null, fine: null, schoolZone: null }
      : null,
    otherRiders: [...new Set(riderNames.filter((name) => !MATCHERS.legal(plain(name)) && !MATCHERS.rental(plain(name))))].map((name) => ({ name: name.slice(0, 80), insuredId: insured.id, insuredLabel: insured.label })),
  });
  return claim.success ? { ok: true, claim: claim.data } : { ok: false, missing: [{ field: "draft", message: "입력한 값 가운데 범위를 벗어난 것이 있습니다. 앞 단계의 숫자를 확인해 주세요" }] };
}
