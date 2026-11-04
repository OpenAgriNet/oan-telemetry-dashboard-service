const pool = require('../services/db');
const { getMhGapReconstruction } = require('../services/mhGapReconstruction');
const { parseDateRange } = require('../utils/dateUtils');

async function getMhGap(req, res) {
  const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
  const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
  const range = parseDateRange(startDate, endDate);
  if ((startDate && range.startTimestamp === null) || (endDate && range.endTimestamp === null) ||
      (range.startTimestamp !== null && range.endTimestamp !== null && range.startTimestamp > range.endTimestamp)) {
    return res.status(400).json({ success: false, error: 'Invalid date range' });
  }
  try {
    res.json({ success: true, data: await getMhGapReconstruction(pool, range) });
  } catch (error) {
    console.error('MH gap reconstruction failed:', error.message);
    res.status(500).json({ success: false, error: 'Unable to reconstruct MH gap' });
  }
}
module.exports = { getMhGap };
