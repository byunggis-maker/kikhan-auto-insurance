import { describe, expect, it } from "vitest";
import {
  clearAll,
  clearHealth,
  deleteDraft,
  draftKey,
  listCases,
  listDrafts,
  loadDraft,
  migrateLegacyDrafts,
  newDraft,
  newPerson,
  parseDraft,
  parseLegacyDraft,
  resumeStep,
  saveDraft,
  type DraftStorage,
} from "@/lib/draft/store";
import { CONSENT_KEY, saveConsent } from "@/lib/privacy/consent";
import { personLabel } from "@/lib/draft/to-claim";

function memoryStorage(): DraftStorage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("입력 초안 저장", () => {
  it("저장한 초안을 그대로 다시 읽는다", () => {
    const storage = memoryStorage();
    const draft = newDraft("a", "2026-10-13T00:00:00.000Z");
    draft.people.push({ ...newPerson("p1", "driver"), hospitalDays: 0, monthlyIncome: 3500000 });
    saveDraft(storage, draft);
    expect(loadDraft(storage, "a")).toEqual(draft);
  });

  it("입력하지 않은 숫자는 0이 아니라 null로 남는다", () => {
    const storage = memoryStorage();
    const draft = newDraft("a", "2026-10-13T00:00:00.000Z");
    draft.people.push({ ...newPerson("p1", "passenger"), hospitalDays: 0 });
    saveDraft(storage, draft);
    const person = loadDraft(storage, "a")!.people[0];
    expect(person.hospitalDays).toBe(0);
    expect(person.outpatientDays).toBeNull();
    expect(loadDraft(storage, "a")!.vehicle.repairCost).toBeNull();
  });

  it("목록은 최근에 고친 기록이 먼저 오고, 다른 키와 깨진 값은 건너뛴다", () => {
    const storage = memoryStorage();
    saveDraft(storage, newDraft("old", "2026-10-01T00:00:00.000Z"));
    saveDraft(storage, newDraft("new", "2026-10-12T00:00:00.000Z"));
    storage.setItem("other", "{}");
    storage.setItem("kac:draft:broken", "{not json");
    expect(listDrafts(storage).map((d) => d.id)).toEqual(["new", "old"]);
  });

  it("지운 기록은 읽히지 않는다", () => {
    const storage = memoryStorage();
    saveDraft(storage, newDraft("a", "2026-10-13T00:00:00.000Z"));
    deleteDraft(storage, "a");
    expect(loadDraft(storage, "a")).toBeNull();
    expect(listDrafts(storage)).toEqual([]);
  });

  it("새 초안에는 기본 담보 7개가 미가입 상태로 들어 있다", () => {
    const draft = newDraft("a", "2026-10-13T00:00:00.000Z");
    expect(draft.policy.coverages).toHaveLength(7);
    expect(draft.policy.coverages.every((c) => !c.joined && c.limit === "")).toBe(true);
  });

  it("v1 때 저장된 신원 칸(이름·증권번호·차량번호·생년월일·성별)은 옛 초안을 옮길 때 버린다", () => {
    const draft = newDraft("a", "2026-10-13T00:00:00.000Z");
    const legacy = {
      ...draft,
      policy: { ...draft.policy, policyNumber: "가상-0000", policyholderName: "가상 계약자", insuredName: "가상 피보험자", birthDate: "1980-05-05", gender: "M", vehicleNumber: "12가3456" },
      people: [{ ...newPerson("p1", "driver"), name: "가상 본인" }],
    };
    const parsed = parseLegacyDraft(JSON.stringify(legacy))!;
    const raw = JSON.stringify(parsed);
    for (const secret of ["가상-0000", "가상 계약자", "가상 피보험자", "1980-05-05", "12가3456", "가상 본인", "policyNumber"]) expect(raw).not.toContain(secret);
    expect(parsed.people[0]).not.toHaveProperty("name");

    // 새 키의 초안에 신원 칸이 있으면 지워서 읽지 않고, 통째로 "읽을 수 없는 기록"이 된다.
    expect(parseDraft(JSON.stringify(legacy))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, people: [{ ...newPerson("p1", "driver"), phone: "010-0000-0000" }] }))).toBeNull();
  });

  it("옛 키(kac:draft:)의 초안은 신원 칸을 버리고 kc2.case. 키로 옮긴다", () => {
    const storage = memoryStorage();
    const draft = newDraft("a", "2026-10-13T00:00:00.000Z");
    storage.setItem("kac:draft:a", JSON.stringify({ ...draft, policy: { ...draft.policy, vehicleNumber: "12가3456" } }));
    storage.setItem("kac:draft:broken", "{not json");
    expect(migrateLegacyDrafts(storage)).toBe(1);
    expect(storage.getItem("kac:draft:a")).toBeNull();
    expect(storage.getItem(draftKey("a"))).not.toContain("12가3456");
    expect(loadDraft(storage, "a")).toEqual(draft);
    expect(draftKey("a")).toBe("kc2.case.a");
  });

  it("빠진 칸은 빈 값으로 채우고, 잘못된 값이 있으면 읽지 않는다", () => {
    const draft = newDraft("a", "2026-10-13T00:00:00.000Z");
    const { vehicle, ...rest } = draft;
    const { vehicleClass, rented, ...olderVehicle } = vehicle;
    void vehicleClass;
    void rented;
    expect(parseDraft(JSON.stringify({ ...rest, vehicle: olderVehicle }))).toEqual(draft);
    expect(parseDraft(JSON.stringify({ ...draft, people: [{ ...newPerson("p1", "driver"), hospitalDays: "열흘" }] }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, policy: { ...draft.policy, productLine: "truck" } }))).toBeNull();
  });

  it("목록: 읽을 수 없는 기록은 맨 뒤에 따로 보여 지울 수 있게 한다", () => {
    const storage = memoryStorage();
    saveDraft(storage, newDraft("ok", "2026-10-13T00:00:00.000Z"));
    storage.setItem(draftKey("bad"), "{not json");
    expect(listCases(storage).map((entry) => [entry.id, entry.draft !== null])).toEqual([
      ["ok", true],
      ["bad", false],
    ]);
  });

  it("새로고침(다시 읽기) 뒤에도 입력이 그대로다", () => {
    const storage = memoryStorage();
    const draft = newDraft("a", "2026-10-13T00:00:00.000Z");
    draft.accident.text = "교차로에서 신호 대기 중 뒤에서 받혔다";
    draft.people.push({ ...newPerson("p1", "driver"), diagnosis: "경추 염좌", hospitalDays: 3, faultPercent: 0 });
    saveDraft(storage, draft);
    const reloaded = loadDraft(storage, "a")!;
    saveDraft(storage, reloaded);
    expect(loadDraft(storage, "a")).toEqual(draft);
  });

  it("모두 지우기: kc2. 키와 옛 키를 모두 지우고 다른 사이트 키는 건드리지 않는다", () => {
    const storage = memoryStorage();
    saveDraft(storage, newDraft("a", "2026-10-13T00:00:00.000Z"));
    saveDraft(storage, newDraft("b", "2026-10-13T00:00:00.000Z"));
    expect(saveConsent({ service: true, health: true }, new Date(), storage)).toBe(true);
    storage.setItem("kc2.quota", "2");
    storage.setItem("kac:draft:old", "{}");
    storage.setItem("other-app", "x");
    expect(storage.getItem(CONSENT_KEY)).not.toBeNull();
    expect(clearAll(storage)).toBe(5);
    const left = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    expect(left).toEqual(["other-app"]);
    expect(left.filter((key) => key?.startsWith("kc2."))).toHaveLength(0);
  });

  it("건강정보 동의 철회: 다친 내용·진단·상해급수·수술·입원·통원·치료비를 비우고 나머지는 남긴다", () => {
    const storage = memoryStorage();
    const draft = newDraft("a", "2026-10-13T00:00:00.000Z");
    draft.accident.text = "뒤에서 받혔다";
    draft.people.push({
      ...newPerson("p1", "driver"),
      injury: "목이 아프다",
      diagnosis: "경추 염좌",
      injuryGrade: 12,
      surgery: false,
      hospitalDays: 3,
      outpatientDays: 10,
      treatmentCost: 1200000,
      inferred: ["diagnosis", "faultPercent"],
      occupation: "회사원",
      monthlyIncome: 3000000,
      faultPercent: 20,
      disabilityPercent: 30,
      disabilityGrade: 9,
      deathDate: "2026-10-01",
    });
    saveDraft(storage, draft);
    expect(clearHealth(storage)).toBe(1);
    expect(loadDraft(storage, "a")!.people[0]).toMatchObject({ disabilityPercent: null, disabilityGrade: null, deathDate: "" });
    const person = loadDraft(storage, "a")!.people[0];
    expect(person).toMatchObject({ injury: "", diagnosis: "", injuryGrade: null, surgery: null, hospitalDays: null, outpatientDays: null, treatmentCost: null });
    expect(person).toMatchObject({ occupation: "회사원", monthlyIncome: 3000000, faultPercent: 20, inferred: ["faultPercent"] });
    expect(loadDraft(storage, "a")!.accident.text).toBe("뒤에서 받혔다");
    expect(clearHealth(storage)).toBe(0);
  });

  it("7단계 전 초안의 생년월일은 사고일의 만 나이로 바꾸고 생년월일은 버린다", () => {
    const draft = newDraft("a", "2026-10-13T00:00:00.000Z");
    draft.accident.date = "2026-09-01";
    const { age, ...rest } = newPerson("p1", "driver");
    void age;
    const old = { ...draft, people: [{ ...rest, birthDate: "1986-09-02" }, { ...rest, id: "p2", birthDate: "" }] };
    const parsed = parseDraft(JSON.stringify(old))!;
    expect(parsed.people.map((p) => p.age)).toEqual([39, null]);
    expect(JSON.stringify(parsed)).not.toContain("1986-09-02");
    expect(parsed.people[0]).not.toHaveProperty("birthDate");
    // 사고일을 모르면 나이도 비운다.
    expect(parseDraft(JSON.stringify({ ...old, accident: { ...old.accident, date: "" } }))!.people[0].age).toBeNull();
  });

  it("이어서 하기: 입력이 빈 첫 단계를 연다", () => {
    const draft = newDraft("a", "2026-10-13T00:00:00.000Z");
    expect(resumeStep(draft)).toBe("policy");
    draft.policy.insurer = "가상화재";
    expect(resumeStep(draft)).toBe("accident");
    draft.people.push(newPerson("p1", "driver"));
    expect(resumeStep(draft)).toBe("people");
  });
});

describe("사람 카드 제목", () => {
  it("이름 대신 역할 이름을 쓴다", () => {
    const people = [newPerson("a", "driver"), newPerson("b", "passenger"), newPerson("c", "passenger"), newPerson("d", "counterparty"), newPerson("e", "counterparty"), newPerson("f", "pedestrian")];
    expect(people.map((_, i) => personLabel(people, i))).toEqual(["운전자(나)", "동승자 1", "동승자 2", "상대방", "상대방 2", "보행자"]);
  });
});
