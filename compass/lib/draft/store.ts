import type { AccidentDraft, CaseDraft, CoverageDraft, PersonDraft, PersonRole, PolicyDraft } from "./types";

// 입력 초안을 브라우저 저장소에 넣고 꺼내는 함수들이다. 저장소를 인자로 받아 테스트할 수 있게 한다.

export type DraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

const PREFIX = "kac:draft:";
export const draftKey = (id: string) => PREFIX + id;

const STANDARD_COVERAGES = [
  "대인배상Ⅰ",
  "대인배상Ⅱ",
  "대물배상",
  "자기신체사고",
  "자동차상해",
  "무보험자동차에 의한 상해",
  "자기차량손해",
];

export function standardCoverages(): CoverageDraft[] {
  return STANDARD_COVERAGES.map((name, i) => newCoverage(`c${i + 1}`, name));
}

export function newPolicy(): PolicyDraft {
  return {
    insurer: "",
    productName: "",
    productLine: "",
    periodStart: "",
    periodEnd: "",
    vehicleModel: "",
    driverScope: "",
    driverAgeLimit: "",
    riders: [],
    unread: [],
    fileName: null,
    coverages: standardCoverages(),
  };
}

export function newCoverage(id: string, name = ""): CoverageDraft {
  return { id, name, joined: false, limit: "", deductible: "" };
}

export function newPerson(id: string, role: PersonRole): PersonDraft {
  return {
    id,
    role,
    injury: "",
    diagnosis: "",
    injuryGrade: null,
    inferred: [],
    surgery: null,
    hospitalDays: null,
    outpatientDays: null,
    treatmentCost: null,
    daysOffWork: null,
    birthDate: "",
    occupation: "",
    monthlyIncome: null,
    faultPercent: null,
  };
}

export function newAccident(): AccidentDraft {
  return { date: "", time: "", place: "", kind: "", text: "", counterpartyInsurance: "", counterpartyBodily2Limit: "", counterpartyPropertyLimit: "", inferred: [] };
}

const newVehicle = (): CaseDraft["vehicle"] => ({ damage: "", repairCost: null, rentalDays: null, rented: null, rentalDailyRate: null, valueAtAccident: null, firstRegisteredOn: "", vehicleClass: "" });

export function newDraft(id: string, now: string): CaseDraft {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    policy: newPolicy(),
    accident: newAccident(),
    people: [],
    vehicle: newVehicle(),
  };
}

// v1 초안에 있던 신원 칸. 읽을 때 지워서 화면과 저장소에 다시 남지 않게 한다.
const POLICY_IDENTITY = ["policyNumber", "policyholderName", "insuredName", "birthDate", "gender", "vehicleNumber"];
const PERSON_IDENTITY = ["name"];

function withoutIdentity<T extends object>(value: T, keys: string[]): T {
  const copy = { ...value } as Record<string, unknown>;
  for (const key of keys) delete copy[key];
  return copy as T;
}

export function parseDraft(raw: string | null): CaseDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const ok =
      value &&
      typeof value.id === "string" &&
      Array.isArray(value.people) &&
      Array.isArray(value.policy?.coverages) &&
      typeof value.accident?.text === "string" &&
      typeof value.vehicle === "object";
    if (!ok) return null;
    // 예전에 저장한 초안에는 없는 칸이 있을 수 있어 빈 값으로 채운다. 신원 칸이 남아 있으면 버린다.
    return {
      ...value,
      policy: withoutIdentity({ ...newPolicy(), ...value.policy }, POLICY_IDENTITY),
      accident: { ...newAccident(), ...value.accident },
      people: (value.people as PersonDraft[]).map((person) => withoutIdentity({ ...newPerson(person.id, person.role), ...person }, PERSON_IDENTITY)),
      vehicle: { ...newVehicle(), ...value.vehicle },
    } as CaseDraft;
  } catch {
    return null;
  }
}

export function loadDraft(storage: DraftStorage, id: string): CaseDraft | null {
  return parseDraft(storage.getItem(draftKey(id)));
}

export function saveDraft(storage: DraftStorage, draft: CaseDraft): void {
  storage.setItem(draftKey(draft.id), JSON.stringify(draft));
}

export function deleteDraft(storage: DraftStorage, id: string): void {
  storage.removeItem(draftKey(id));
}

/** 최근에 고친 기록이 먼저 온다. 따로 목록을 두지 않고 저장된 초안에서 바로 만든다. */
export function listDrafts(storage: DraftStorage): CaseDraft[] {
  const drafts: CaseDraft[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const draft = parseDraft(storage.getItem(key));
    if (draft) drafts.push(draft);
  }
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
