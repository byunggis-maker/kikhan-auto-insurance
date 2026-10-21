// 첫 화면. 7단계 화면(components/steps)은 다음 라운드부터 연결한다.
export default function Home() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-bold">키칸 자동차보험 보상 나침반</h1>
      <p className="mt-3 text-ink-soft">사고 접수부터 보상 검토서까지, 보상담당자의 처리 순서대로 사람·물건마다 받을 돈을 추정합니다.</p>
      <p className="mt-6 rounded-xl border border-estimate-line bg-estimate px-4 py-3 text-estimate-ink">추정액이며 확정 금액은 보험사가 정합니다.</p>
      <p className="mt-6">화면을 준비하고 있습니다.</p>
    </main>
  );
}
