function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }

  return stringValue;
}

function rowsToCsv(rows, columns) {
  const headerLine = columns.map((col) => escapeCsvValue(col.header)).join(",");
  const dataLines = rows.map((row) => rowToCsvLine(row, columns));

  return [headerLine, ...dataLines].join("\n");
}

function rowToCsvLine(row, columns) {
  return columns.map((col) => escapeCsvValue(row[col.key])).join(",");
}

function csvHeaderLine(columns) {
  return columns.map((col) => escapeCsvValue(col.header)).join(",");
}

module.exports = {
  escapeCsvValue,
  rowsToCsv,
  rowToCsvLine,
  csvHeaderLine,
};
