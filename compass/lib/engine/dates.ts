// "YYYY-MM-DD" 날짜 계산. 시계를 읽지 않는다.

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

/** from부터 to까지 꽉 찬 개월 수. 월 미만 일자는 버린다. to가 앞이면 0 */
export function fullMonthsBetween(from: string, to: string) {
  const a = parts(from);
  const b = parts(to);
  const months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
  return Math.max(0, months);
}

/** 만 나이 */
export function ageOn(birthDate: string, date: string) {
  return Math.floor(fullMonthsBetween(birthDate, date) / 12);
}

/** date에 years년을 더한 날짜. 2월 29일생은 평년에 2월 28일로 본다 */
export function addYears(date: string, years: number) {
  const { y, m, d } = parts(date);
  const year = y + years;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
