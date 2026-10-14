import { describe, expect, it } from "vitest";
import { deleteDraft, listDrafts, loadDraft, newDraft, newPerson, parseDraft, saveDraft, type DraftStorage } from "@/lib/draft/store";
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

  it("v1 때 저장된 신원 칸(이름·증권번호·차량번호·생년월일·성별)은 읽을 때 버린다", () => {
    const draft = newDraft("a", "2026-10-13T00:00:00.000Z");
    const legacy = {
      ...draft,
      policy: { ...draft.policy, policyNumber: "가상-0000", policyholderName: "가상 계약자", insuredName: "가상 피보험자", birthDate: "1980-05-05", gender: "M", vehicleNumber: "12가3456" },
      people: [{ ...newPerson("p1", "driver"), name: "가상 본인" }],
    };
    const parsed = parseDraft(JSON.stringify(legacy))!;
    const raw = JSON.stringify(parsed);
    for (const secret of ["가상-0000", "가상 계약자", "가상 피보험자", "1980-05-05", "12가3456", "가상 본인", "policyNumber"]) expect(raw).not.toContain(secret);
    expect(parsed.people[0]).not.toHaveProperty("name");
  });
});

describe("사람 카드 제목", () => {
  it("이름 대신 역할 이름을 쓴다", () => {
    const people = [newPerson("a", "driver"), newPerson("b", "passenger"), newPerson("c", "passenger"), newPerson("d", "counterparty"), newPerson("e", "counterparty"), newPerson("f", "pedestrian")];
    expect(people.map((_, i) => personLabel(people, i))).toEqual(["운전자(나)", "동승자 1", "동승자 2", "상대방", "상대방 2", "보행자"]);
  });
});
