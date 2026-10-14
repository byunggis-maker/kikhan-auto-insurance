import type { InjuryGradeItem, InjuryGradeMap } from "@/lib/schemas/injury-grade-map";

// 진단명과 수술 여부로 상해급수(1~14급) "후보"를 찾는다. 급수를 확정하지 않는다.
// 급수와 문구는 모두 인자로 받은 상해 구분표(data/rules/injury-grade-map.json)에서 온다. 이 파일에 급수나 금액을 쓰지 않는다.

export type InjuryGradeInput = {
  diagnosis: string;
  /** true: 수술함, false: 수술 안 함, null: 모름 */
  surgery: boolean | null;
  /** 별표의 상해 구분에는 입원일수 기준이 없어 후보를 고르는 데 쓰지 않는다. */
  hospitalDays: number | null;
};

export type InjuryGradeCandidate = {
  grade: number;
  itemId: string;
  /** 별표의 문구 */
  text: string;
  /** 근거 조항 */
  basis: string;
  page: number;
  /** 왜 후보인지 */
  reason: string;
  /** 이 항목이 수술 여부를 따지는지 */
  surgery: InjuryGradeItem["surgery"];
  status: InjuryGradeItem["status"];
};

export type InjuryGradeSuggestion = {
  candidates: InjuryGradeCandidate[];
  /** 진단명에서 알아본 낱말(별표에 쓰인 낱말로 바꾼 것) */
  recognized: string[];
};

const longestFirst = (words: string[]) => [...words].sort((a, b) => b.length - a.length);

/**
 * 띄어쓰기를 무시하고 낱말을 찾는 글. 띄어쓰기가 제각각이어도("추간판 탈출증", "추간판탈출증") 찾을 수 있다.
 * 다만 앞 낱말의 끝과 뒤 낱말의 처음이 이어져 생긴 가짜 낱말("분쇄 골절" 속의 "쇄골")은 잡지 않는다.
 */
class Searchable {
  private chars: string[] = [];
  private token: number[] = [];
  private starts: boolean[] = [];

  constructor(text: string) {
    let token = 0;
    let fresh = true;
    for (const ch of text) {
      if (/[\s(),.·ㆍ\[\]"'/]/.test(ch)) {
        if (!fresh) token++;
        fresh = true;
        continue;
      }
      this.chars.push(ch);
      this.token.push(token);
      this.starts.push(fresh);
      fresh = false;
    }
  }

  /** 낱말이 있으면 그 자리를 지우고 true를 돌려준다(긴 낱말 안의 짧은 낱말이 한 번 더 잡히지 않게). */
  take(word: string): boolean {
    const letters = [...word];
    let found = false;
    for (let i = 0; i + letters.length <= this.chars.length; i++) {
      if (!letters.every((letter, k) => this.chars[i + k] === letter)) continue;
      const last = i + letters.length - 1;
      if (this.token[i] !== this.token[last] && !this.starts[i]) continue;
      for (let k = i; k <= last; k++) this.chars[k] = "\u0000";
      found = true;
    }
    return found;
  }
}

function wordsIn(text: string | Searchable, vocabulary: string[]): Set<string> {
  const source = typeof text === "string" ? new Searchable(text) : text;
  const found = new Set<string>();
  for (const word of longestFirst(vocabulary)) if (source.take(word)) found.add(word);
  return found;
}

/** 진단명을 별표에 쓰인 낱말로 바꾼다. 예: "경추 염좌" → 목뼈, 척추, 염좌 */
function diagnosisWords(diagnosis: string, map: InjuryGradeMap): Set<string> {
  const source = new Searchable(diagnosis);
  const found = new Set<string>();
  for (const key of longestFirst(Object.keys(map.matching.synonyms))) {
    if (source.take(key)) for (const word of map.matching.synonyms[key]) found.add(word);
  }
  for (const word of wordsIn(source, [...map.matching.bodyParts, ...map.matching.injuryTypes])) found.add(word);
  return found;
}

const shared = (a: Set<string>, b: Set<string>) => [...a].filter((word) => b.has(word));

export function suggestInjuryGrades(input: InjuryGradeInput, map: InjuryGradeMap, limit = 6): InjuryGradeSuggestion {
  const said = diagnosisWords(input.diagnosis, map);
  const saidParts = new Set(shared(said, new Set(map.matching.bodyParts)));
  const saidTypes = new Set(shared(said, new Set(map.matching.injuryTypes)));
  if (saidTypes.size === 0) return { candidates: [], recognized: [...said] };

  const scored: { item: InjuryGradeItem; parts: string[]; types: string[]; extra: number }[] = [];
  for (const item of map.items) {
    if (item.catchAll) continue;
    if (input.surgery === true && item.surgery === "without") continue;
    if (input.surgery === false && item.surgery === "with") continue;
    const types = shared(wordsIn(item.text, map.matching.injuryTypes), saidTypes);
    if (types.length === 0) continue;
    const itemParts = wordsIn(item.text, map.matching.bodyParts);
    const parts = shared(itemParts, saidParts);
    // 부위가 적힌 항목은 부위도 맞아야 한다. 부위가 없는 항목(뇌진탕, 추간판 탈출증 등)은 상해 종류만 맞으면 된다.
    if (itemParts.size > 0 && parts.length === 0) continue;
    scored.push({ item, parts, types, extra: itemParts.size - parts.length });
  }

  // 부위가 맞는 항목이 있으면, 같은 종류의 상해를 부위 없이 적은 항목("각종 돌기 골절" 등)은 뺀다.
  const typesWithPart = new Set(scored.filter((entry) => entry.parts.length > 0).flatMap((entry) => entry.types));
  const kept = scored.filter((entry) => entry.parts.length > 0 || !entry.types.every((type) => typesWithPart.has(type)));

  kept.sort(
    // 맞는 부위가 많은 항목 먼저, 그다음 진단명에 없는 부위가 적은(더 꼭 맞는) 항목 먼저.
    (a, b) => b.parts.length - a.parts.length || a.extra - b.extra || b.types.length - a.types.length || a.item.grade - b.item.grade || a.item.no - b.item.no,
  );
  return {
    recognized: [...said],
    candidates: kept.slice(0, limit).map(({ item, parts, types }) => {
      const matched = [...parts, ...types].map((word) => `"${word}"`).join(", ");
      const surgeryNote =
        item.surgery === "any"
          ? ""
          : input.surgery === null
            ? item.surgery === "with"
              ? " 수술을 한 경우에만 해당합니다."
              : " 수술을 하지 않은 경우에만 해당합니다."
            : item.surgery === "with"
              ? " 수술을 한 경우의 항목입니다."
              : " 수술을 하지 않은 경우의 항목입니다.";
      return {
        grade: item.grade,
        itemId: item.id,
        text: item.text,
        basis: item.basis,
        page: item.page,
        reason: `진단명의 ${matched} 낱말이 별표의 이 항목과 맞습니다.${surgeryNote}`,
        surgery: item.surgery,
        status: item.status,
      };
    }),
  };
}
