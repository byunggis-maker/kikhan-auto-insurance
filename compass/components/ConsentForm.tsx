"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { openWorkingCase } from "@/lib/draft/use-draft";
import { safeNext, saveConsent, useConsent } from "@/lib/privacy/consent";
import { primaryButton } from "./ui";

// 동의 문안은 초안이다. 법무 확인 뒤 문안을 바꾸면 lib/privacy/consent.ts의 버전을 올린다.
// 동의 기록은 서버가 아니라 이 브라우저에만 남는다.

function Item(props: {
  tag: "필수" | "선택";
  title: string;
  when?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-2xl border p-5 shadow-sm ${props.checked ? "border-navy" : "border-line"}`}>
      <label className="flex cursor-pointer items-start gap-4">
        <input
          type="checkbox"
          className="mt-1 h-7 w-7 shrink-0 accent-navy"
          checked={props.checked}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        <span>
          <span className="block text-lg font-bold">
            <span className={props.tag === "필수" ? "text-navy" : "text-muted"}>[{props.tag}]</span> {props.title}
          </span>
          {props.when && <span className="block text-sm font-semibold text-navy">{props.when}</span>}
        </span>
      </label>
      <div className="mt-3 flex flex-col gap-1.5 pl-11 text-base text-muted">{props.children}</div>
    </section>
  );
}

export function ConsentForm() {
  const router = useRouter();
  const saved = useConsent();
  // 사용자가 고치기 전에는 이 브라우저에 저장된 상태를 보여 준다.
  const [edited, setEdited] = useState<{ service?: boolean; health?: boolean }>({});
  const [message, setMessage] = useState("");

  if (saved === undefined) return <p className="p-5 text-muted">불러오는 중…</p>;

  const service = edited.service ?? saved.service;
  const health = edited.health ?? saved.health;
  const withdrawingHealth = saved.health && !health;

  function submit() {
    setMessage("");
    if (!saveConsent({ service, health })) {
      setMessage("이 브라우저에서는 저장을 쓸 수 없습니다. 사생활 보호 모드를 끄고 다시 시도해 주세요.");
      return;
    }
    // 건강정보 동의를 철회하면 이 브라우저에 남은 진단·수술 등을 지우는 일은 3단계에서 붙인다.
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    const id = next ? null : openWorkingCase();
    if (!next && !id) {
      setMessage("이 브라우저에서는 저장을 쓸 수 없습니다. 사생활 보호 모드를 끄고 다시 시도해 주세요.");
      return;
    }
    router.push(next ?? `/cases/${id}/policy`);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-5 pb-36 pt-8">
      <div>
        <h1 className="text-2xl font-bold">동의</h1>
        <p className="mt-1 text-muted">시작하기 전에 확인해 주세요. 문안은 초안이며 바뀔 수 있습니다.</p>
      </div>

      <Item tag="필수" title="서비스 이용과 개인정보 처리" checked={service} onChange={(v) => setEdited({ ...edited, service: v })}>
        <p>가입 담보와 가입금액, 특약, 자기부담금, 보험기간, 사고 내용을 예상 보험금 계산에 씁니다.</p>
        <p>이름, 주민등록번호, 전화번호, 주소, 이메일, 증권번호, 차량번호, 계좌·카드번호는 가린 뒤에만 분석에 쓰고 남기지 않습니다.</p>
        <p>입력한 내용은 서버에 저장하지 않고 이 브라우저에만 남습니다. 언제든 지울 수 있습니다.</p>
      </Item>

      <Item
        tag="필수"
        title="건강정보 처리"
        when="음성 입력과 사고 사실 뽑기에 필요합니다"
        checked={health}
        onChange={(v) => setEdited({ ...edited, health: v })}
      >
        <p>진단명, 수술 여부, 입원·통원 기간, 치료비를 다친 사람의 예상 보험금 계산에 씁니다.</p>
        <p>음성 입력, 사고 사실 뽑기, 쉬운 말 설명은 이 내용을 서버와 AI 제공자에게 보내 처리하고, 처리 뒤 남기지 않습니다.</p>
        <p>동의하지 않아도 직접 입력해 계산할 수 있습니다. 이때 건강정보는 이 브라우저 밖으로 나가지 않습니다.</p>
      </Item>

      {withdrawingHealth && (
        <p role="alert" className="rounded-xl border-2 border-navy p-4 font-semibold">
          건강정보 동의를 철회하면 음성 입력, 사고 사실 뽑기, 쉬운 말 설명을 쓸 수 없습니다.
        </p>
      )}
      <p role="status" aria-live="polite" className="font-semibold">
        {message}
      </p>

      <footer className="fixed inset-x-0 bottom-0 border-t border-line bg-white">
        <div className="mx-auto w-full max-w-xl px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <button type="button" className={primaryButton} disabled={!service} onClick={submit}>
            동의하고 계속
          </button>
          {!service && <p className="mt-1.5 text-center text-sm text-muted">서비스 이용 동의는 필수입니다</p>}
        </div>
      </footer>
    </main>
  );
}
