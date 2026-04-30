const IST_TIMEZONE = "Asia/Kolkata";

function epochMsToIstTimestamp(expr) {
  return `timezone('${IST_TIMEZONE}', to_timestamp((${expr})::double precision / 1000.0))`;
}

function epochMsToIstDate(expr) {
  return `DATE(${epochMsToIstTimestamp(expr)})`;
}

function utcTimestampToIstTimestamp(expr) {
  return `timezone('${IST_TIMEZONE}', (${expr}) AT TIME ZONE 'UTC')`;
}

function utcTimestampToIstDate(expr) {
  return `DATE(${utcTimestampToIstTimestamp(expr)})`;
}

function epochMsDateTruncIst(granularity, expr) {
  return `DATE_TRUNC('${granularity}', ${epochMsToIstTimestamp(expr)})`;
}

module.exports = {
  IST_TIMEZONE,
  epochMsToIstTimestamp,
  epochMsToIstDate,
  utcTimestampToIstTimestamp,
  utcTimestampToIstDate,
  epochMsDateTruncIst,
};
