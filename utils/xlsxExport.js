const ExcelJS = require("exceljs");

const HEADER_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8EEF7" },
};

const HEADER_FONT = {
  bold: true,
  size: 11,
  color: { argb: "FF1F2937" },
};

const TEXT_COLUMN_KEYS = new Set([
  "question",
  "answer",
  "feedback",
  "feedbacktext",
  "questiontext",
  "answertext",
  "text",
  "errormessage",
  "reason",
  "action",
  "metadata",
]);

const COLUMN_WIDTH_BY_KEY = {
  telemetryState: 18,
  exportedBy: 24,
  fingerprint: 36,
  id: 38,
  qid: 24,
  question: 65,
  answer: 85,
  user_id: 36,
  user: 36,
  session_id: 36,
  sessionId: 36,
  sid: 36,
  fingerprint_id: 36,
  channel: 20,
  dateAsked: 26,
  date: 26,
  event_time: 26,
  session_time: 26,
  rating: 14,
  feedbackSource: 18,
  feedbacktype: 14,
  language: 16,
  success: 12,
  latencyMs: 16,
  statusCode: 14,
  status_code: 14,
  event_name: 28,
  category: 20,
  notification_id: 30,
  interactionId: 40,
  userId: 36,
  startDatetime: 28,
  endDatetime: 28,
  text: 55,
  errormessage: 45,
};

function getColumnWidth(col) {
  if (col.width) {
    return col.width;
  }

  if (COLUMN_WIDTH_BY_KEY[col.key]) {
    return COLUMN_WIDTH_BY_KEY[col.key];
  }

  return Math.min(Math.max(String(col.header || "").length + 6, 16), 30);
}

function isTextColumn(key) {
  return TEXT_COLUMN_KEYS.has(key);
}

function hasExportCellValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string" && value.trim() === "") {
    return false;
  }

  return true;
}

function pruneEmptyExportColumns(columns, rows) {
  if (!rows.length) {
    return columns;
  }

  return columns.filter((col) =>
    rows.some((row) => hasExportCellValue(row[col.key])),
  );
}

function estimateRowHeight(row, columns) {
  let maxLines = 1;

  columns.forEach((col, index) => {
    const cell = row.getCell(index + 1);
    const value = cell.value === null || cell.value === undefined ? "" : String(cell.value);
    if (!value) {
      return;
    }

    const width = getColumnWidth(col);
    const charsPerLine = Math.max(Math.floor(width * 1.15), 12);
    const lines = Math.ceil(value.length / charsPerLine);
    maxLines = Math.max(maxLines, lines);
  });

  return Math.min(Math.max(maxLines * 16, 28), 180);
}

function applyHeaderStyle(row, columns) {
  row.height = 32;
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;

  columns.forEach((col, index) => {
    const cell = row.getCell(index + 1);
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD1D5DB" } },
      left: { style: "thin", color: { argb: "FFD1D5DB" } },
      bottom: { style: "medium", color: { argb: "FF9CA3AF" } },
      right: { style: "thin", color: { argb: "FFD1D5DB" } },
    };
  });
}

function applyDataRowStyle(row, columns) {
  columns.forEach((col, index) => {
    const cell = row.getCell(index + 1);
    const isText = isTextColumn(col.key);

    cell.alignment = {
      horizontal: isText ? "left" : "center",
      vertical: "top",
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFE5E7EB" } },
      left: { style: "thin", color: { argb: "FFE5E7EB" } },
      bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
      right: { style: "thin", color: { argb: "FFE5E7EB" } },
    };
  });

  row.height = estimateRowHeight(row, columns);
}

function buildRowValues(rowData, activeColumns) {
  const values = {};
  activeColumns.forEach((col) => {
    const value = rowData[col.key];
    values[col.key] = value === null || value === undefined ? "" : value;
  });
  return values;
}

function appendRowsToWorksheet(worksheet, rows, activeColumns, currentTotal, maxRows) {
  let totalRows = currentTotal;
  let truncated = false;

  for (const rowData of rows) {
    if (totalRows >= maxRows) {
      truncated = true;
      break;
    }

    const excelRow = worksheet.addRow(buildRowValues(rowData, activeColumns));
    applyDataRowStyle(excelRow, activeColumns);
    excelRow.commit();
    totalRows += 1;
  }

  return { totalRows, truncated };
}

async function writeFormattedXlsx({
  filePath,
  columns,
  fetchPage,
  maxRows,
  pageSize,
  onPageWritten,
}) {
  const firstPageRows = await fetchPage(1, pageSize);
  const activeColumns = pruneEmptyExportColumns(columns, firstPageRows);

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useSharedStrings: true,
    useStyles: true,
  });

  const worksheet = workbook.addWorksheet("Export", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 28 },
  });

  worksheet.columns = activeColumns.map((col) => ({
    header: col.header,
    key: col.key,
    width: getColumnWidth(col),
  }));

  applyHeaderStyle(worksheet.getRow(1), activeColumns);
  worksheet.getRow(1).commit();

  let totalRows = 0;
  let page = 1;
  let truncated = false;

  while (totalRows < maxRows) {
    const rows = page === 1 ? firstPageRows : await fetchPage(page, pageSize);
    if (!rows.length) {
      break;
    }

    const pageResult = appendRowsToWorksheet(
      worksheet,
      rows,
      activeColumns,
      totalRows,
      maxRows,
    );
    totalRows = pageResult.totalRows;
    truncated = pageResult.truncated;

    if (typeof onPageWritten === "function") {
      onPageWritten(page, rows.length, totalRows);
    }

    if (truncated || rows.length < pageSize) {
      break;
    }

    page += 1;
  }

  await workbook.commit();

  if (truncated) {
    throw new Error(
      `Export exceeds maximum of ${maxRows.toLocaleString()} rows. Please narrow the date range or set EXPORT_MAX_ROWS higher.`,
    );
  }

  return totalRows;
}

module.exports = {
  hasExportCellValue,
  pruneEmptyExportColumns,
  writeFormattedXlsx,
};
