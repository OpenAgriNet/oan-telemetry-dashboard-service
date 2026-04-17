const pool = require('../services/db');

// Simple in-process cache for materialized view existence checks.
// TTL is per process; refreshed by the 15-min cron on the processor side.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map(); // viewName -> { exists: boolean, expiresAt: number }

/**
 * Returns true if a materialized view (or table) with the given name exists.
 * Result is cached for 5 minutes to avoid repeated catalog round-trips.
 */
async function mvExists(viewName) {
  const now = Date.now();
  const cached = cache.get(viewName);
  if (cached && cached.expiresAt > now) {
    return cached.exists;
  }
  try {
    const result = await pool.query(
      `SELECT 1 FROM pg_matviews WHERE matviewname = $1
       UNION ALL
       SELECT 1 FROM pg_stat_user_tables WHERE relname = $1
       LIMIT 1`,
      [viewName]
    );
    const exists = result.rows.length > 0;
    cache.set(viewName, { exists, expiresAt: now + CACHE_TTL_MS });
    return exists;
  } catch (err) {
    cache.set(viewName, { exists: false, expiresAt: now + 30 * 1000 });
    return false;
  }
}

/** Invalidate cached MV existence entry (e.g. after manual DDL). */
function invalidateMvCache(viewName) {
  if (viewName) cache.delete(viewName);
  else cache.clear();
}

module.exports = {
  mvExists,
  invalidateMvCache,
};
