import { VEHICLE_CLASS_LABELS, type Property } from "./types";

// 라운드 9: 사고 직전 차량가액을 사용자에게 묻지 않는다. 내 차는 증권의 차량가액(차량가입금액)을 쓰고,
// 그 밖(상대 차량, 증권이 없는 내 차)은 차종 등급·연식으로 앱이 추정한다.
// 보험개발원 차량기준가액은 차종·연식별 표로 정해지는데 앱에는 그 표가 없다. 그래서 등급별 대표 신차가격 × 경과연수 잔존율로 근사한다.
// 결과는 언제나 '추정'으로 표시한다. 대표 신차가격·잔존율은 앱이 정한 근사값이다(약관·보험개발원 표의 값이 아님).

type VehicleClass = NonNullable<Property["vehicleClass"]>;

/** 등급별 대표 신차가격(원) */
export const NEW_CAR_PRICE: Record<VehicleClass, number> = {
  light: 15_000_000,
  small: 23_000_000,
  mid: 33_000_000,
  large: 50_000_000,
  suv: 38_000_000,
  imported: 70_000_000,
};

/** 경과연수(0년 = 사고 연도와 연식이 같음)별 잔존율(%). 10년을 넘으면 해마다 2%p씩 줄고 10%에서 멈춘다 */
const RESIDUAL = [90, 83, 72, 63, 55, 48, 42, 37, 32, 28, 25];

export function residualPercent(age: number): number {
  if (age <= 0) return RESIDUAL[0];
  if (age < RESIDUAL.length) return RESIDUAL[age];
  return Math.max(10, RESIDUAL[RESIDUAL.length - 1] - 2 * (age - (RESIDUAL.length - 1)));
}

/** 차종 등급·연식 → 사고 직전 가액 추정. accidentYear: 사고 연도 */
export function estimateVehicleValue(vehicleClass: VehicleClass, modelYear: number, accidentYear: number): { value: number; formula: string } {
  const age = Math.max(0, accidentYear - modelYear);
  const rate = residualPercent(age);
  const base = NEW_CAR_PRICE[vehicleClass];
  // 만 원 단위로 내린다
  const value = Math.floor((base * rate) / 100 / 10_000) * 10_000;
  const man = (n: number) => `${(n / 10_000).toLocaleString("ko-KR")}만 원`;
  return { value, formula: `${VEHICLE_CLASS_LABELS[vehicleClass]} 대표 신차가격 ${man(base)} × ${modelYear}년식 ${age}년 경과 잔존율 ${rate}% = ${man(value)}(추정, 보험개발원 차량기준가액 방식의 감가 근사치)` };
}

/** 선택할 수 있는 연식(사고 연도부터 20년 전까지) */
export function modelYears(accidentYear: number): number[] {
  return Array.from({ length: 21 }, (_, i) => accidentYear - i);
}

/** 추정값 옆에 늘 붙이는 한 줄(라운드 9b) */
export const ESTIMATE_DISCLAIMER = "보험개발원 차량기준가액이 아닌 앱 자체 추정치입니다";
