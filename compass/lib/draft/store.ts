import { caseDraftSchema } from "./schema";
import type { AccidentDraft, CaseDraft, CoverageDraft, PersonDraft, PersonRole, PolicyDraft } from "./types";

// 입력 초안을 브라우저 저장소에 넣고 꺼내는 함수들이다. 저장소를 인자로 받아 테스트할 수 있게 한다.

export type DraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

// 이 앱이 브라우저에 두는 키는 모두 "kc2."로 시작한다. "모두 지우기"는 이 접두어로 지운다.
export const APP_PREFIX = "kc2.";
const PREFIX = "kc2.case.";
export const draftKey = (id: string) => PREFIX + id;
// v1·2단계 때 쓰던 키. 읽어서 신원 칸을 버리고 새 키로 옮긴다.
const LEGACY_PREFIX = "kac:draft:";

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

// v1 초안에 있던 신원 칸. 옛 키에서 옮길 때만 지운다. 새 키의 초안에 이 칸이 있으면 읽지 않는다.
const POLICY_IDENTITY = ["policyNumber", "policyholderName", "insuredName", "birthDate", "gender", "vehicleNumber"];
const PERSON_IDENTITY = ["name"];

function withoutKeys(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const copy = { ...value } as Record<string, unknown>;
  for (const key of keys) delete copy[key];
  return copy;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 저장된 초안을 스키마로 검증해 읽는다. 모르는 칸(신원 칸 포함)이 있거나 깨졌으면 null */
export function parseDraft(raw: string | null): CaseDraft | null {
  const result = caseDraftSchema.safeParse(parseJson(raw));
  return result.success ? result.data : null;
}

/** 옛 키(v1·2단계)의 초안. 신원 칸을 버린 뒤 검증한다. */
export function parseLegacyDraft(raw: string | null): CaseDraft | null {
  const value = parseJson(raw);
  if (!value || typeof value !== "object") return null;
  const draft = value as Record<string, unknown>;
  const people = Array.isArray(draft.people) ? draft.people.map((person) => withoutKeys(person, PERSON_IDENTITY)) : draft.people;
  const result = caseDraftSchema.safeParse({ ...draft, policy: withoutKeys(draft.policy, POLICY_IDENTITY), people });
  return result.success ? result.data : null;
}

export function loadDraft(storage: DraftStorage, id: string): CaseDraft | null {
  return parseDraft(storage.getItem(draftKey(id)));
}

export function saveDraft(storage: DraftStorage, draft: CaseDraft): void {
  storage.setItem(draftKey(draft.id), JSON.stringify(caseDraftSchema.parse(draft)));
}

export function deleteDraft(storage: DraftStorage, id: string): void {
  storage.removeItem(draftKey(id));
}

function keysWith(storage: DraftStorage, prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/** 옛 키의 초안을 새 키로 옮긴다. 읽을 수 없는 옛 초안은 남겨 두고 "모두 지우기"로만 지운다. 옮긴 수를 돌려준다. */
export function migrateLegacyDrafts(storage: DraftStorage): number {
  let moved = 0;
  for (const key of keysWith(storage, LEGACY_PREFIX)) {
    const draft = parseLegacyDraft(storage.getItem(key));
    if (!draft) continue;
    if (storage.getItem(draftKey(draft.id)) === null) saveDraft(storage, draft);
    storage.removeItem(key);
    moved++;
  }
  return moved;
}

/** 사고 목록의 한 줄. draft가 null이면 "읽을 수 없는 기록"이다(지우기만 할 수 있다). */
export type CaseEntry = { id: string; draft: CaseDraft | null };

/** 최근에 고친 기록이 먼저 오고, 읽을 수 없는 기록은 맨 뒤에 온다. 따로 목록을 두지 않고 저장된 초안에서 바로 만든다. */
export function listCases(storage: DraftStorage): CaseEntry[] {
  const entries = keysWith(storage, PREFIX).map((key) => ({ id: key.slice(PREFIX.length), draft: parseDraft(storage.getItem(key)) }));
  return entries.sort((a, b) => {
    if (!a.draft || !b.draft) return a.draft ? -1 : b.draft ? 1 : a.id.localeCompare(b.id);
    return b.draft.updatedAt.localeCompare(a.draft.updatedAt);
  });
}

export function listDrafts(storage: DraftStorage): CaseDraft[] {
  return listCases(storage).flatMap((entry) => (entry.draft ? [entry.draft] : []));
}

/** "이 기기의 기록 모두 지우기". 이 앱의 키(kc2.)와 옛 키를 모두 지운다. 지운 키 수를 돌려준다. */
export function clearAll(storage: DraftStorage): number {
  const keys = [...keysWith(storage, APP_PREFIX), ...keysWith(storage, LEGACY_PREFIX)];
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}

// 건강정보 동의를 철회하면 지우는 칸. 다친 내용, 진단, 상해급수, 수술, 입원·통원 일수, 치료비
export const HEALTH_FIELDS = ["injury", "diagnosis", "injuryGrade", "surgery", "hospitalDays", "outpatientDays", "treatmentCost"] as const;

export function withoutHealth(draft: CaseDraft): CaseDraft {
  const blank = newPerson("", "driver");
  return {
    ...draft,
    people: draft.people.map((person) => {
      const next = { ...person, inferred: person.inferred.filter((field) => !(HEALTH_FIELDS as readonly string[]).includes(field)) };
      for (const field of HEALTH_FIELDS) (next as Record<string, unknown>)[field] = blank[field];
      return next;
    }),
  };
}

/** 이 브라우저의 모든 사고 기록에서 건강정보 칸을 비운다. 고친 기록 수를 돌려준다. */
export function clearHealth(storage: DraftStorage): number {
  let changed = 0;
  for (const draft of listDrafts(storage)) {
    const next = withoutHealth(draft);
    if (JSON.stringify(next) === JSON.stringify(draft)) continue;
    saveDraft(storage, next);
    changed++;
  }
  return changed;
}

export type CaseStep = "policy" | "accident" | "people";

/** "이어서 하기"가 여는 단계. 따로 기억하지 않고, 입력이 빈 첫 단계를 고른다. */
export function resumeStep(draft: CaseDraft): CaseStep {
  const policyStarted = draft.policy.insurer !== "" || draft.policy.fileName !== null || draft.policy.coverages.some((c) => c.joined);
  const accidentStarted = draft.accident.text !== "" || draft.accident.date !== "" || draft.accident.kind !== "";
  if (draft.people.length > 0) return "people";
  return accidentStarted || policyStarted ? "accident" : "policy";
}
