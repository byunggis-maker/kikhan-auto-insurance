import Link from "next/link";
import { StartButton } from "@/components/StartButton";

// 로그인 없이 쓴다. 기록은 서버가 아니라 이 브라우저에만 남는다.
const LOCAL_ONLY = "기록은 이 기기의 이 브라우저에만 남고 서버에는 저장되지 않습니다. 브라우저 기록을 지우면 다시 볼 수 없으니 결과를 엑셀·PDF로 받아 두세요.";

const POINTS = [
  { title: "내 보험 올리기", text: "증권이나 가입증명서로 가입한 담보를 확인합니다." },
  { title: "사고를 말로 설명하기", text: "마이크에 대고 말하면 글로 바꿔 드립니다." },
  { title: "사람별·담보별 예상 보험금", text: "최소·예상·최대 금액과 계산 근거를 함께 보여 드립니다." },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pb-8 pt-12">
      <p className="font-bold text-navy">키칸 자동차보험 보상 나침반</p>
      <h1 className="mt-3 text-3xl font-bold leading-snug">
        내 자동차보험,
        <br />
        얼마나 받을 수 있을까요?
      </h1>
      <p className="mt-4 text-lg text-muted">보상 담당자의 설명을 기다리지 않고, 내가 아는 정보만으로 예상 보험금을 미리 살펴봅니다.</p>

      <ol className="mt-8 flex flex-col gap-3">
        {POINTS.map((point, i) => (
          <li key={point.title} className="flex gap-4 rounded-2xl border border-line p-5 shadow-sm">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy font-bold text-white">{i + 1}</span>
            <div>
              <p className="font-bold">{point.title}</p>
              <p className="text-muted">{point.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-auto pt-10">
        <StartButton />
        <Link href="/cases" className="mt-2 flex min-h-11 items-center justify-center text-base font-semibold text-navy underline">
          내 사고 기록
        </Link>
        <p className="text-center text-sm text-muted">{LOCAL_ONLY}</p>
        <p className="mt-6 text-center text-sm text-muted">참고용 추정이며 손해사정이나 보험금 지급 확정이 아닙니다</p>
      </div>
    </main>
  );
}
