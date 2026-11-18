import type { Claim } from "@/lib/claim/types";
import type { Screen } from "@/lib/ui/flow";

/** 화면 하나가 받는 것. update는 입력값을 바꾼다. next는 다음 화면으로 넘어간다 */
export type ScreenProps = { screen: Screen; claim: Claim; update: (change: (claim: Claim) => Claim) => void; next: () => void };
