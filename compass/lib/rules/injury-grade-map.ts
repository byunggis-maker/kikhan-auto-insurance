import raw from "@/data/rules/injury-grade-map.json";
import { injuryGradeMapSchema } from "@/lib/schemas/injury-grade-map";

/** 검증을 통과한 상해 구분표. 엔진 함수에는 이것을 인자로 넘긴다. */
export const injuryGradeMap = injuryGradeMapSchema.parse(raw);
