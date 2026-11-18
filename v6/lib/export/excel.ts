import { PARTIAL_NOTE, TO_COUNTERPARTY_NOTE, UNCALCULATED_STATUS, totalText, type Review } from "@/lib/report/review";

// MASTER.md 8장 엑셀 저장: 시트 3개(요약, 담보별 상세, 필요 서류). 금액은 숫자 셀(#,##0), 계산식·조항은 글자 열.
// exceljs는 크므로 저장 버튼을 누를 때만 불러온다(dynamic import).

const MONEY = "#,##0";

export async function reviewToXlsx(review: Review): Promise<Uint8Array> {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "키칸 자동차보험 보상 나침반";

  // ── 요약 ──
  const summary = book.addWorksheet("요약");
  summary.columns = [{ width: 34 }, { width: 18 }, { width: 18 }, { width: 60 }];
  // 긴 글(고지·기준·목록)은 A~D 열을 합쳐 한 줄로 두고 글 길이만큼 줄 높이를 늘린다(합친 칸은 엑셀이 높이를 자동으로 맞추지 않는다)
  const wide = (text: string) => {
    const row = summary.addRow([text]);
    summary.mergeCells(row.number, 1, row.number, 4);
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    row.height = Math.max(1, Math.ceil(text.length / 60)) * 16;
    return row;
  };
  const title = summary.addRow(["보상 검토서"]);
  title.font = { bold: true, size: 16 };
  wide(review.notice).font = { bold: true, color: { argb: "FF0B4A8F" } };
  summary.addRow([]);
  for (const [label, value] of [
    ["사고일", review.accident.date],
    ["사고 유형", review.accident.type],
    ["장소", review.accident.place],
    ["내 과실", review.faultKnown ? `${review.faultPercent}%` : `모름(아래 표는 ${review.faultPercent}% 시나리오)`],
  ] as const)
    summary.addRow([label, value]);
  if (review.accident.narrative) wide(`사고 경위: ${review.accident.narrative}`);
  summary.addRow([]);
  summary.addRow(["계산 기준"]).font = { bold: true };
  for (const line of review.standards) wide(line);
  summary.addRow([]);
  const head = summary.addRow(["", "확정 기준", "추정 포함", ""]);
  head.font = { bold: true };
  const money = (row: ReturnType<typeof summary.addRow>) => {
    row.getCell(2).numFmt = MONEY;
    row.getCell(3).numFmt = MONEY;
    return row;
  };
  // 라운드 9d: 미계산이 있으면 합계를 숫자 칸(확정처럼 보임) 대신 "○원 + 미계산" 글자로 두고 옆에 문구
  // 라운드 9e: 범위 안에 미계산이 있는 칸만 "○원 + 미계산" 글자, 나머지는 숫자 칸(#,##0)
  const total = (n: number, partial: boolean) => (partial ? totalText(`${n.toLocaleString("ko-KR")}원`, true) : n);
  const note = (partial: boolean) => (partial ? PARTIAL_NOTE : "");
  const receivePartial = review.top.receivePartial;
  money(summary.addRow(["받을 돈", total(review.top.receiveConfirmed, receivePartial), total(review.top.receiveWithEstimates, receivePartial), note(receivePartial)])).font = { bold: true };
  money(summary.addRow(["내가 낼 돈", review.top.burdenConfirmed, review.top.burdenWithEstimates])).font = { bold: true };
  if (review.top.toCounterparty > 0) money(summary.addRow(["내 보험이 상대방에게 줄 돈*", null, total(review.top.toCounterparty, review.top.toCounterpartyPartial), `* ${TO_COUNTERPARTY_NOTE}${review.top.toCounterpartyPartial ? ` ${PARTIAL_NOTE}` : ""}`]));
  summary.addRow([]);
  summary.addRow(["받을 곳별"]).font = { bold: true };
  for (const p of review.byPayer) money(summary.addRow([p.payer, total(p.confirmed, p.partial), total(p.withEstimates, p.partial), note(p.partial)]));
  // 라운드 9c: 앱이 계산하지 않은 줄은 0 대신 '미계산'
  for (const u of review.uncalculated) summary.addRow([`${u.payer}(${u.card} ${u.label})`, UNCALCULATED_STATUS, UNCALCULATED_STATUS, u.text]);
  if (review.burdens.length) {
    summary.addRow([]);
    summary.addRow(["내가 낼 돈 내역", "확정 기준", "추정 포함", "계산식·근거"]).font = { bold: true };
    for (const b of review.burdens) money(summary.addRow([b.label, b.confirmed, b.withEstimates, `${b.formula} / ${b.basis}`]));
  }
  summary.addRow([]);
  summary.addRow(["과실 시나리오", "받을 돈(확정)", "받을 돈(추정 포함)", "내가 낼 돈(추정 포함)"]).font = { bold: true };
  for (const s of review.scenarios) {
    const row = summary.addRow([s.label, total(s.receiveConfirmed, s.receivePartial), total(s.receiveWithEstimates, s.receivePartial), s.burdenWithEstimates]);
    money(row).getCell(4).numFmt = MONEY;
  }
  for (const [heading, items] of [
    ["입력 필요", review.missing],
    ["다음 할 일", review.nextSteps],
    ["안내", review.notices],
  ] as const) {
    if (!items.length) continue;
    summary.addRow([]);
    summary.addRow([heading]).font = { bold: true };
    for (const item of items) wide(item);
  }
  summary.getColumn(1).alignment = { wrapText: true, vertical: "top" };
  summary.getColumn(4).alignment = { wrapText: true, vertical: "top" };

  // ── 담보별 상세 ──
  const detail = book.addWorksheet("담보별 상세");
  detail.columns = [
    { header: "사람·물건", width: 16 },
    { header: "담보", width: 26 },
    { header: "지급처", width: 14 },
    { header: "상태", width: 12 },
    { header: "확정액", width: 14, style: { numFmt: MONEY } },
    { header: "추정 포함액", width: 14, style: { numFmt: MONEY } },
    { header: "추정분", width: 14, style: { numFmt: MONEY } },
    { header: "계산식", width: 70 },
    { header: "약관 조항", width: 50 },
    { header: "면책 사유", width: 40 },
    { header: "표시", width: 40 },
  ];
  detail.getRow(1).font = { bold: true };
  for (const card of review.cards)
    for (const l of card.lines) {
      const none = l.status === UNCALCULATED_STATUS;
      detail.addRow([card.label, l.label, l.payer, l.status, none ? UNCALCULATED_STATUS : l.confirmed, none ? UNCALCULATED_STATUS : l.withEstimates, none ? UNCALCULATED_STATUS : l.estimatePart, l.formula, l.basis, l.exclusion, l.flags.join(" / ")]);
    }
  for (const col of [8, 9, 10, 11]) detail.getColumn(col).alignment = { wrapText: true, vertical: "top" };
  detail.views = [{ state: "frozen", ySplit: 1 }];

  // ── 필요 서류 ──
  const docs = book.addWorksheet("필요 서류");
  docs.columns = [
    { header: "받을 곳", width: 14 },
    { header: "담보", width: 26 },
    { header: "서류", width: 60 },
    { header: "근거", width: 16 },
    { header: "확인", width: 8 },
  ];
  docs.getRow(1).font = { bold: true };
  for (const group of review.checklist) for (const doc of group.docs) docs.addRow([group.payer, group.coverage, doc.label, `약관 제27조 ${doc.clause27}호`, doc.checked ? "■" : "□"]);
  docs.getColumn(3).alignment = { wrapText: true, vertical: "top" };
  docs.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await book.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
