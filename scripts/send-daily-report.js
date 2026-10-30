#!/usr/bin/env node
/**
 * Send (or preview) the daily health report now, outside the 9 PM schedule.
 *
 *   node scripts/send-daily-report.js --dry-run [--out report.html]
 *   node scripts/send-daily-report.js --to you@example.com
 *   node scripts/send-daily-report.js            # scheduled recipients, once per day
 *   node scripts/send-daily-report.js --force    # resend to scheduled recipients
 *
 * --to sends only to the given addresses and doesn't count as today's run.
 */
require("dotenv").config();
const fs = require("node:fs");
const pool = require("../services/db");
const { DAILY_REPORTS, sendDailyReport } = require("../services/dailyReport");

function parseArgs(argv) {
  const args = { to: null, dryRun: false, force: false, out: null, report: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--to") args.to = argv[++i].split(",").map((e) => e.trim()).filter(Boolean);
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--report") args.report = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const report = args.report
    ? DAILY_REPORTS.find((r) => r.key === args.report)
    : DAILY_REPORTS[0];
  if (!report) {
    throw new Error(
      `Unknown report "${args.report}". Known: ${DAILY_REPORTS.map((r) => r.key).join(", ")}`,
    );
  }

  const result = await sendDailyReport(report, {
    to: args.to,
    dryRun: args.dryRun,
    force: args.force,
  });

  if (result.status === "dry-run") {
    console.log(`Subject: ${result.message.subject}\n`);
    console.log(result.message.text);
    if (args.out) {
      fs.writeFileSync(args.out, result.message.html);
      console.log(`\nHTML written to ${args.out}`);
    }
  } else if (result.status === "sent") {
    console.log(`Sent "${report.subject}" to ${result.recipients.join(", ")}`);
  } else {
    console.log(`Not sent: ${result.reason}`);
  }
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
