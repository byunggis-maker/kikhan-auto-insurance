"use client";

import { useState } from "react";
import { outlineButton } from "@/components/ui";
import { keywordsFor, lawOf, type LawRef, type PrecedentKeyword } from "@/lib/law/catalog";
import type { AccidentKind } from "@/lib/draft/types";
import type { LawArticle, Precedent } from "@/lib/law/client";

// 법령 조문과 참고 판례를 보여 준다. 불러오지 못해도 화면은 그대로 두고 안내 문구만 보여 준다.

const FAILED = "법령 정보를 불러오지 못했습니다";
const INDENT = ["", "", "pl-4", "pl-8"];

type Loaded<T> = { status: "idle" | "loading" | "error" } | { status: "done"; value: T };

async function load<T>(url: string, pick: (body: unknown) => T | null): Promise<T> {
  const response = await fetch(url);
  const body: unknown = await response.json().catch(() => null);
  const value = response.ok ? pick(body) : null;
  if (value === null) throw new Error(FAILED);
  return value;
}

function Failed() {
  return <p className="rounded-xl bg-warn-soft px-4 py-3 font-semibold text-warn-ink">{FAILED}</p>;
}

/** 조문 하나: 누르면 원문을 불러와 펼친다 */
function LawArticleButton({ lawRef }: { lawRef: LawRef }) {
  const [state, setState] = useState<Loaded<LawArticle>>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const { label, why } = lawOf(lawRef);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (state.status === "done" || state.status === "loading") return;
    setState({ status: "loading" });
    try {
      const article = await load(`/api/laws?ref=${lawRef}`, (body) => {
        const value = (body as { article?: LawArticle } | null)?.article;
        return value && Array.isArray(value.lines) ? value : null;
      });
      setState({ status: "done", value: article });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <li className="rounded-xl border border-line">
      <button type="button" aria-expanded={open} onClick={toggle} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left">
        <span>
          <span className="font-semibold text-navy">{label}</span>
          <span className="block text-sm text-muted">{why}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-navy">{open ? "접기" : "법령 보기"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
          {state.status === "loading" && <p className="text-muted">불러오는 중…</p>}
          {state.status === "error" && <Failed />}
          {state.status === "done" && (
            <>
              <p className="font-bold">{state.value.heading}</p>
              {state.value.lines.map((line, index) => (
                <p key={index} className={`break-words text-sm ${INDENT[line.level]}`}>
                  {line.text}
                </p>
              ))}
              <p className="text-sm text-muted">
                {state.value.effectiveDate ? `${state.value.effectiveDate} 시행 조문입니다. ` : ""}지금 시행 중인 내용이라 사고 당시의 조문과 다를 수 있습니다.
              </p>
              <a href={state.value.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-navy underline">
                국가법령정보센터에서 보기
              </a>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function LawArticles({ refs }: { refs: LawRef[] }) {
  if (refs.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {refs.map((lawRef) => (
        <LawArticleButton key={lawRef} lawRef={lawRef} />
      ))}
    </ul>
  );
}

/** 과실비율이 다툼이 될 때 참고할 판례를 검색어로 찾는다 */
export function PrecedentSearch({ kind }: { kind: AccidentKind | "" }) {
  const [keyword, setKeyword] = useState<PrecedentKeyword | null>(null);
  const [state, setState] = useState<Loaded<Precedent[]>>({ status: "idle" });

  async function search(next: PrecedentKeyword) {
    setKeyword(next);
    setState({ status: "loading" });
    try {
      const precedents = await load(`/api/laws/precedents?q=${encodeURIComponent(next)}`, (body) => {
        const value = (body as { precedents?: Precedent[] } | null)?.precedents;
        return Array.isArray(value) ? value : null;
      });
      setState({ status: "done", value: precedents });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted">과실비율에 다툼이 있으면 비슷한 사고의 판례를 참고할 수 있습니다. 검색어를 눌러 주세요.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="참고 판례 검색">
        {keywordsFor(kind).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={keyword === item}
            onClick={() => search(item)}
            className={`min-h-11 rounded-full border px-4 text-base font-semibold ${keyword === item ? "border-navy bg-navy text-white" : "border-line bg-white text-ink"}`}
          >
            {item}
          </button>
        ))}
      </div>
      {state.status === "idle" && <p className={`${outlineButton} border-dashed text-base font-semibold text-muted`}>참고 판례 검색: 위에서 검색어를 고르세요</p>}
      {state.status === "loading" && <p className="text-muted">판례를 찾는 중…</p>}
      {state.status === "error" && <Failed />}
      {state.status === "done" &&
        (state.value.length === 0 ? (
          <p className="text-muted">이 검색어로 찾은 판례가 없습니다.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {state.value.map((precedent) => (
              <li key={precedent.id}>
                <a href={precedent.url} target="_blank" rel="noreferrer" className="block px-4 py-2.5">
                  <span className="font-semibold text-navy underline">{precedent.title}</span>
                  <span className="block text-sm text-muted">
                    {precedent.court} {precedent.date} · {precedent.caseNumber}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ))}
      <p className="text-sm text-muted">판례는 참고 자료입니다. 내 사고의 과실비율은 사고 상황과 증거에 따라 달라집니다.</p>
    </div>
  );
}
