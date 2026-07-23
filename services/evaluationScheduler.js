const cron = require("node-cron");
const pool = require("./db");
const { ensureEvaluationSchema } = require("./evaluationSchema");
const { launchEvaluationRun } = require("./evaluationRunLauncher");

let checking = false;

async function checkEvaluationSchedules() {
  if (checking) return;
  checking = true;
  try {
    await ensureEvaluationSchema();
    const due = await pool.query(`
      SELECT * FROM evaluation_schedules
      WHERE enabled=TRUE
        AND daily_hour_ist <= EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Asia/Kolkata')
        AND last_started_on IS DISTINCT FROM (NOW() AT TIME ZONE 'Asia/Kolkata')::date
      ORDER BY daily_hour_ist, created_at
    `);
    for (const schedule of due.rows) {
      const claimed = await pool.query(`UPDATE evaluation_schedules
        SET last_started_on=(NOW() AT TIME ZONE 'Asia/Kolkata')::date, last_error=NULL, updated_at=NOW()
        WHERE id=$1 AND last_started_on IS DISTINCT FROM (NOW() AT TIME ZONE 'Asia/Kolkata')::date
        RETURNING id`, [schedule.id]);
      if (!claimed.rowCount) continue;
      try {
        const run = await launchEvaluationRun({
          requestedBy: `schedule:${schedule.name}`,
          endpointId: schedule.judge_endpoint_id,
          populationLimit: schedule.population_limit,
          samplingMode: schedule.sampling_mode,
          samplingValue: Number(schedule.sampling_value),
          targetLanguages: schedule.target_languages || [],
        });
        await pool.query("UPDATE evaluation_schedules SET last_run_id=$2, updated_at=NOW() WHERE id=$1", [schedule.id, run.run_id]);
      } catch (error) {
        await pool.query("UPDATE evaluation_schedules SET last_error=$2, updated_at=NOW() WHERE id=$1", [schedule.id, String(error.message).slice(0, 4000)]);
      }
    }
  } catch (error) {
    console.error("evaluation scheduler check failed", error.message);
  } finally {
    checking = false;
  }
}

function startEvaluationScheduler() {
  cron.schedule("*/5 * * * *", checkEvaluationSchedules, { timezone: "Asia/Kolkata" });
}

module.exports = { checkEvaluationSchedules, startEvaluationScheduler };
