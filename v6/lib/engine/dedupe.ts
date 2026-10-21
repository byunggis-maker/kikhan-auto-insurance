import { won } from "./legacy/range";
import type { RunLine } from "./types";

// MASTER.md 6장 (5) 중복 차감의 마지막 확인: 사람·물건 한 장의 지급 합계는 그 실제손해를 넘을 수 없다.
// 뒤 순위 담보는 이미 "실제손해 − 앞 순위 지급액"으로 계산하지만, 반올림·하한 등으로 넘칠 수 있으므로 앞 순위부터 차례로 깎는다.
// lines는 지급 순위 순서(상대 대인Ⅰ → 상대 대인Ⅱ → 내 대인Ⅰ → 내 대인Ⅱ → 무보험차상해 → 자동차상해)로 들어온다.

export function capToLoss(lines: RunLine[], actualLoss: number): RunLine[] {
  let left = actualLoss;
  return lines.map((line) => {
    if (line.status !== "paid") return line;
    const amount = Math.min(line.amount, Math.max(0, left));
    left -= amount;
    if (amount === line.amount) return line;
    return { ...line, amount, formula: `${line.formula} → 실제손해 ${won(actualLoss)} 상한으로 ${won(amount)}`, flags: [...line.flags, "실제손해 상한 적용"] };
  });
}
