import type { Claim } from "@/lib/claim/types";
import type { Screen } from "@/lib/ui/flow";

/** 화면 하나가 받는 것. update는 입력값을 바꾸고, 그 화면의 "건너뜀" 표시를 지운다 */
export type ScreenProps = { screen: Screen; claim: Claim; update: (change: (claim: Claim) => Claim) => void };
