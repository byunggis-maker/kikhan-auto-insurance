"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { openWorkingCase } from "@/lib/draft/use-draft";
import { readConsent } from "@/lib/privacy/consent";
import { primaryButton } from "./ui";

/** "바로 시작하기": 로그인 없이 동의 화면으로, 이미 동의했으면 쓰던(또는 새) 사고의 "내 보험" 화면으로 간다. */
export function StartButton() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  function start() {
    if (!readConsent().service) return router.push("/consent");
    const id = openWorkingCase();
    if (!id) return setFailed(true);
    router.push(`/cases/${id}/policy`);
  }

  return (
    <>
      <button type="button" className={primaryButton} onClick={start}>
        바로 시작하기
      </button>
      {failed && (
        <p role="alert" className="mt-2 text-center font-semibold">
          이 브라우저에서는 저장을 쓸 수 없습니다. 사생활 보호 모드를 끄고 다시 시도해 주세요.
        </p>
      )}
    </>
  );
}
