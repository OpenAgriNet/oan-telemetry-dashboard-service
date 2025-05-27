const pool = require('../db'); // adjust path as needed

/**
 * GET /dashboard/user-logins?granularity=daily|hourly
 * Returns user login analytics for dashboard
 */
const getUserLoginAnalytics = async (req, res) => {
    try {
        const granularity = req.query.granularity === 'hourly' ? 'hourly' : 'daily';

        if (granularity === 'daily') {
            // Last 7 days including today
            const result = await pool.query(`
                SELECT 
                    to_char(to_timestamp(ets / 1000)::date, 'YYYY-MM-DD') as date,
                    COUNT(DISTINCT uid) as unique_logins
                FROM (
                    SELECT uid, ets FROM questions WHERE uid IS NOT NULL
                    UNION ALL
                    SELECT uid, ets FROM errordetails WHERE uid IS NOT NULL
                ) AS combined
                WHERE to_timestamp(ets / 1000)::date >= CURRENT_DATE - INTERVAL '6 days'
                GROUP BY date
                ORDER BY date DESC
                LIMIT 7
            `);

            // Fill missing days with 0
            const today = new Date();
            const days = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                days.push(d.toISOString().slice(0, 10));
            }
            const dataMap = {};
            result.rows.forEach(row => { dataMap[row.date] = parseInt(row.unique_logins); });
            const data = days.map(date => ({
                date,
                uniqueLogins: dataMap[date] || 0
            }));

            return res.json({ success: true, granularity, data });
        } else {
            // Last 12 hours including current hour
            const result = await pool.query(`
                SELECT 
                    to_char(date_trunc('hour', to_timestamp(ets / 1000)), 'YYYY-MM-DD HH24:00') as hour,
                    COUNT(DISTINCT uid) as unique_logins
                FROM (
                    SELECT uid, ets FROM questions WHERE uid IS NOT NULL
                    UNION ALL
                    SELECT uid, ets FROM errordetails WHERE uid IS NOT NULL
                ) AS combined
                WHERE to_timestamp(ets / 1000) >= date_trunc('hour', now()) - INTERVAL '11 hours'
                GROUP BY hour
                ORDER BY hour DESC
                LIMIT 12
            `);

            // Fill missing hours with 0
            const now = new Date();
            const hours = [];
            for (let i = 11; i >= 0; i--) {
                const h = new Date(now);
                h.setHours(now.getHours() - i, 0, 0, 0);
                hours.push(h.toISOString().slice(0, 13) + ':00');
            }
            const dataMap = {};
            result.rows.forEach(row => { dataMap[row.hour] = parseInt(row.unique_logins); });
            const data = hours.map(hour => ({
                hour,
                uniqueLogins: dataMap[hour] || 0
            }));

            return res.json({ success: true, granularity, data });
        }
    } catch (error) {
        console.error('Error in getUserLoginAnalytics:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

module.exports = {
    getUserLoginAnalytics,
    // ... existing exports ...
};
