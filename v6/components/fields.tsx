"use client";

import { useId, useState } from "react";

// 입력 화면이 함께 쓰는 입력 도구. 모바일 우선: 누르는 곳은 48px 이상, 숫자는 숫자 자판.

/**
 * 드롭다운(라운드 9). 선택형 질문은 버튼 격자 대신 이것을 쓴다. 첫 항목은 '모름'(값 null).
 * unknown을 null로 주면 '모름' 항목이 없다.
 */
export function Select<T extends string | number>({ label, value, options, onChange, unknown = "모름", name }: { label: string; value: T | null; options: { value: T; label: string }[]; onChange: (value: T | null) => void; unknown?: string | null; name?: string }) {
  const id = useId();
  const index = value === null ? -1 : options.findIndex((o) => o.value === value);
  return (
    <label htmlFor={id} className="block">
      <span className="text-sm font-bold">{label}</span>
      <select
        id={id}
        name={name}
        aria-label={label}
        className="mt-1 min-h-12 w-full rounded-xl border-2 border-line bg-white px-3 text-base font-bold text-ink outline-none focus:border-ink"
        value={index === -1 ? "" : String(index)}
        onChange={(e) => onChange(e.target.value === "" ? null : options[Number(e.target.value)].value)}
      >
        {(unknown !== null || index === -1) && <option value="">{unknown ?? "고르세요"}</option>}
        {options.map((o, i) => (
          <option key={String(o.value)} value={String(i)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex min-h-12 items-start gap-3 rounded-xl border-2 px-4 py-3 ${checked ? "border-ink bg-white" : "border-line bg-white"} ${disabled ? "opacity-70" : ""}`}>
      <input type="checkbox" className="mt-1 size-5 accent-[#0b1220]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="font-bold">
        {label}
        {hint && <span className="block text-sm font-semibold text-ink-soft">{hint}</span>}
      </span>
    </label>
  );
}

const fmt = (n: number) => n.toLocaleString("ko-KR");

/** 금액을 "만 원"으로 읽어 준다: 19,000,000 → "1,900만 원" */
export function manwon(n: number) {
  if (n < 10_000) return `${fmt(n)}원`;
  const man = Math.floor(n / 10_000);
  const rest = n % 10_000;
  return `${fmt(man)}만${rest ? ` ${fmt(rest)}` : ""} 원`;
}

/** 금액 입력. 콤마를 넣어 보여 주고, 아래에 "만 원" 읽기를 적는다. 비우면 null */
export function MoneyInput({ label, value, onChange, tone = "confirmed", placeholder }: { label: string; value: number | null; onChange: (value: number | null) => void; tone?: "confirmed" | "estimate"; placeholder?: string }) {
  const id = useId();
  const [text, setText] = useState(value === null ? "" : fmt(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    // 바깥에서 값이 바뀌면(불러오기·지우기) 보이는 글자도 맞춘다
    setLast(value);
    setText(value === null ? "" : fmt(value));
  }
  const estimate = tone === "estimate";
  return (
    <label htmlFor={id} className="block">
      <span className={`text-sm font-bold ${estimate ? "text-estimate-ink" : "text-ink"}`}>{label}</span>
      <span className={`mt-1 flex items-center rounded-xl border-2 px-3 ${estimate ? "border-estimate-line bg-estimate" : "border-line bg-white"}`}>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder ?? "0"}
          className={`min-h-12 w-full bg-transparent text-right text-lg font-bold outline-none ${estimate ? "text-estimate-ink" : "text-ink"}`}
          value={text}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 15);
            const next = digits === "" ? null : Number(digits);
            setText(next === null ? "" : fmt(next));
            setLast(next);
            onChange(next);
          }}
        />
        <span className={`ml-1 font-bold ${estimate ? "text-estimate-ink" : "text-ink"}`}>원</span>
      </span>
      {value !== null && value >= 10_000 && <span className={`mt-1 block text-right text-sm font-semibold ${estimate ? "text-estimate-ink" : "text-ink-soft"}`}>{manwon(value)}</span>}
    </label>
  );
}

/** 정수 입력(일수·끼니 수 등). 비우면 null */
export function IntInput({ label, value, onChange, unit, max = 36_500 }: { label: string; value: number | null; onChange: (value: number | null) => void; unit: string; max?: number }) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="text-sm font-bold">{label}</span>
      <span className="mt-1 flex items-center rounded-xl border-2 border-line bg-white px-3">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          placeholder="모름"
          className="min-h-12 w-full bg-transparent text-right text-lg font-bold outline-none"
          value={value ?? ""}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 6);
            onChange(digits === "" ? null : Math.min(Number(digits), max));
          }}
        />
        <span className="ml-1 font-bold">{unit}</span>
      </span>
    </label>
  );
}

/** − n + 개수 고르기 */
export function Counter({ label, hint, value, onChange, max = 9 }: { label: string; hint?: string; value: number; onChange: (value: number) => void; max?: number }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 border-line bg-white px-4 py-1">
      <span className="font-bold">
        {label}
        {hint && <span className="block text-xs font-semibold text-ink-soft">{hint}</span>}
      </span>
      <span className="flex items-center gap-2">
        <button type="button" aria-label={`${label} 빼기`} className="size-11 rounded-full border-2 border-line text-xl font-bold disabled:opacity-30" disabled={value === 0} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span className="w-6 text-center text-lg font-bold" aria-live="polite">
          {value}
        </span>
        <button type="button" aria-label={`${label} 더하기`} className="size-11 rounded-full border-2 border-line text-xl font-bold disabled:opacity-30" disabled={value === max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </span>
    </div>
  );
}
