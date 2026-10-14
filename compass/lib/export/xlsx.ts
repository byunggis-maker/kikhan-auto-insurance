import type { Book } from "./book";

// 표를 엑셀 파일(xlsx)로 만든다. 값만 넣고 수식은 넣지 않는다(합계를 엑셀에서 따로 더하지 않게).

export async function toXlsx(book: Book): Promise<ArrayBuffer> {
  // 내려받을 때만 필요한 큰 패키지라 그때 불러온다.
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  for (const sheet of book.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.columns = sheet.widths.map((width) => ({ width }));
    for (const row of sheet.rows) {
      const added = worksheet.addRow(row);
      added.eachCell((cell) => {
        if (typeof cell.value === "number") cell.numFmt = "#,##0";
        else cell.alignment = { wrapText: true, vertical: "top" };
      });
    }
    worksheet.getRow(1).font = { bold: true, size: 14 };
  }
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
