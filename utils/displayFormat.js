function naIfEmpty(value) {
  if (value === null || value === undefined) {
    return "N/A";
  }

  if (typeof value === "string" && value.trim() === "") {
    return "N/A";
  }

  return value;
}

function buildExportFileName(moduleName, referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(referenceDate);

  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const month = get("month");
  const day = get("day");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod").toUpperCase();
  const safeModule = String(moduleName || "export")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${safeModule}-${month}-${day}-${year}-${hour}-${minute}-${dayPeriod}.xlsx`;
}

module.exports = {
  naIfEmpty,
  buildExportFileName,
};
