import { Suspense } from "react";
import { AccidentStep } from "@/components/steps/AccidentStep";

// 주소의 사고 번호는 요청할 때 정해지므로 Suspense 안에서 읽는다.
export default function Page() {
  return (
    <Suspense fallback={<p className="p-5 text-muted">불러오는 중…</p>}>
      <AccidentStep />
    </Suspense>
  );
}
