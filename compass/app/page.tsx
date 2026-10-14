import Link from "next/link";
import { StartButton } from "@/components/StartButton";
import { DISCLAIMER } from "@/components/ui";

// 첫 화면. 로그인 없이 쓴다. 기록은 서버가 아니라 이 브라우저에만 남는다.
// 아래 "결과 예시"의 숫자는 지어낸 가상 사례이고 화면에도 예시라고 적는다.

const STEPS = [
  { title: "내 보험 올리기", text: "증권이나 가입증명서를 올리면 가입한 담보와 금액을 읽어 옵니다. 직접 적어도 됩니다." },
  { title: "사고 설명하기", text: "언제, 어떻게, 누가 다쳤는지 말이나 글로 알려 주세요." },
  { title: "예상 보험금 확인", text: "사람별·담보별로 최소·예상·최대 금액과 계산 근거를 보여 드립니다." },
];

const PROMISES = [
  { title: "로그인이 없습니다", text: "가입하지 않고 바로 씁니다." },
  { title: "신원정보는 가립니다", text: "이름·주민번호·차량번호·증권번호는 읽지 않고 남기지 않습니다." },
  { title: "기록은 이 기기에만", text: "서버에 저장하지 않습니다. 언제든 한 번에 지울 수 있습니다." },
];

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 text-navy" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pb-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-2">
        <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
          <circle cx="16" cy="16" r="15" fill="#1b2f6b" />
          <path d="M16 6l4 10-4 10-4-10z" fill="#fff" />
          <path d="M16 6l4 10h-8z" fill="#c7d2ee" />
        </svg>
        <span className="font-bold tracking-tight">보상 나침반</span>
        <span className="ml-auto rounded-full bg-white px-3 py-1 text-xs font-semibold text-muted shadow-[var(--shadow-card)]">자동차보험</span>
      </header>

      <section className="rise mt-12">
        <h1 className="text-[2.1rem] font-bold leading-[1.25] tracking-tight">
          사고 보험금,
          <br />
          먼저 확인해 보세요
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">보상 담당자의 설명을 기다리지 않아도, 내가 아는 정보만으로 담보별 예상 보험금을 미리 살펴볼 수 있습니다.</p>
        <div className="mt-8">
          <StartButton />
          <Link href="/cases" className="mt-2 flex min-h-12 items-center justify-center text-base font-semibold text-navy">
            이전에 입력한 사고 기록 보기
          </Link>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="how">
        <h2 id="how" className="text-sm font-bold text-muted">이렇게 씁니다</h2>
        <ol className="mt-3 flex flex-col gap-2.5">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4 rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)]">
              <span className="num flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-soft text-sm font-bold text-navy">{i + 1}</span>
              <div>
                <p className="font-bold">{step.title}</p>
                <p className="mt-0.5 text-base text-muted">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10" aria-labelledby="example">
        <div className="flex items-center gap-2">
          <h2 id="example" className="text-sm font-bold text-muted">결과 화면 예시</h2>
          <span className="rounded-full border border-line bg-white px-2 py-0.5 text-xs font-semibold text-muted">가상 사례</span>
        </div>
        <div className="mt-3 rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)]" aria-label="예시: 가상 사례의 결과 화면">
          <p className="text-sm font-semibold text-muted">총 예상 보험금</p>
          <p className="num mt-1 text-3xl font-bold text-navy">5,924,000원</p>
          <p className="num mt-0.5 text-sm text-muted">최소 5,924,000원 ~ 최대 5,924,000원</p>
          <div className="mt-4 divide-y divide-line border-t border-line text-base">
            <p className="flex justify-between py-2.5">
              <span>자동차상해</span>
              <span className="num font-semibold">5,924,000원</span>
            </p>
            <p className="flex justify-between py-2.5">
              <span>자기차량손해</span>
              <span className="font-semibold text-muted">정보 부족</span>
            </p>
          </div>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="promise">
        <h2 id="promise" className="text-sm font-bold text-muted">
          개인정보를 저장하지 않습니다
        </h2>
        <ul className="mt-3 flex flex-col gap-4 rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)]">
          {PROMISES.map((promise) => (
            <li key={promise.title} className="flex gap-3">
              <Check />
              <div>
                <p className="font-bold">{promise.title}</p>
                <p className="text-base text-muted">{promise.text}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">브라우저 기록을 지우면 다시 볼 수 없으니, 필요하면 결과를 엑셀·PDF로 받아 두세요.</p>
      </section>

      <footer className="mt-12 border-t border-line pt-5 text-center text-sm text-muted">{DISCLAIMER}</footer>
    </main>
  );
}
