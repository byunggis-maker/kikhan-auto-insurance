"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCase, removeCase, useCaseList } from "@/lib/draft/use-draft";
import { primaryButton } from "./ui";

function when(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

export function CaseList() {
  const router = useRouter();
  const cases = useCaseList();
  const [error, setError] = useState("");

  function start() {
    const id = createCase();
    if (!id) return setError("이 브라우저에서는 저장을 쓸 수 없습니다. 사생활 보호 모드를 끄고 다시 시도해 주세요.");
    router.push(`/cases/${id}/policy`);
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pb-32 pt-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="-ml-2 flex min-h-11 items-center px-2 font-semibold text-navy">
          ← 처음으로
        </Link>
        <Link href="/consent" className="flex min-h-11 items-center text-base font-semibold text-navy">
          동의 관리
        </Link>
      </div>
      <h1 className="mt-2 text-2xl font-bold">내 사고 기록</h1>
      <p className="mt-1 text-muted">이 기기의 이 브라우저에만 저장된 기록입니다. 서버에는 저장되지 않으니 결과를 엑셀·PDF로 받아 두세요.</p>

      <ul className="mt-6 flex flex-col gap-3">
        {cases === undefined && <li className="text-muted">불러오는 중…</li>}
        {cases?.length === 0 && <li className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">아직 기록이 없습니다.</li>}
        {cases?.map((item) => (
          <li key={item.id} className="rounded-2xl border border-line p-5 shadow-sm">
            <Link href={`/cases/${item.id}/policy`} className="block">
              <p className="text-lg font-bold">{item.accident.date ? `${item.accident.date} 사고` : "사고 날짜 미입력"}</p>
              <p className="line-clamp-2 text-muted">{item.accident.text || "사고 내용 미입력"}</p>
              <p className="mt-2 text-sm text-muted">
                다친 사람 {item.people.length}명 · 마지막 수정 {when(item.updatedAt)}
              </p>
            </Link>
            <div className="mt-3 flex gap-4 border-t border-line pt-3">
              <Link href={`/cases/${item.id}/result`} className="flex min-h-11 items-center font-semibold text-navy">
                결과 보기
              </Link>
              <button
                type="button"
                className="ml-auto min-h-11 font-semibold text-muted underline"
                onClick={() => {
                  if (window.confirm("이 기록을 지울까요? 되돌릴 수 없습니다.")) removeCase(item.id);
                }}
              >
                지우기
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-4 font-semibold">
          {error}
        </p>
      )}

      <footer className="fixed inset-x-0 bottom-0 border-t border-line bg-white">
        <div className="mx-auto w-full max-w-xl px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <button type="button" className={primaryButton} onClick={start}>
            새 사고 입력 시작
          </button>
        </div>
      </footer>
    </div>
  );
}
