const fs = require('fs');
const path = require('path');

// Load village list data
let villageData = [];
try {
    const villageListPath = path.join(__dirname, '../village_list.json');
    const rawData = fs.readFileSync(villageListPath, 'utf8');
    villageData = JSON.parse(rawData);
} catch (error) {
    console.error('Error loading village_list.json:', error);
}

const getVillagesByTaluka = (req, res, next) => {
    try {
        // Get village code from query, params, or body
        const villageCode = req.query.village_code || 
                           req.params.village_code || 
                           req.body.village_code;

        if (!villageCode) {
            return res.status(400).json({
                success: false,
                message: 'village_code is required'
            });
        }

        // Convert to number for comparison
        const villageCodeNum = parseInt(villageCode);

        // Find the village with the given village code
        const village = villageData.find(v => v.village_code === villageCodeNum);

        if (!village) {
            return res.status(404).json({
                success: false,
                message: `Village with code ${villageCode} not found`
            });
        }

        // Get the taluka_code from the found village
        const talukaCode = village.taluka_code;

        // Find all villages with the same taluka_code
        const villagesInTaluka = villageData.filter(v => v.taluka_code === talukaCode);

        // Extract just the village codes
        const villageCodes = villagesInTaluka.map(v => v.village_code);

        // Attach to request object for use in route handlers
        req.talukaInfo = {
            village_code: villageCodeNum,
            taluka_code: talukaCode,
            taluka_name: village.taluka,
            taluka_name_marathi: village.taluka_marathi,
            district_code: village.district_code,
            district_name: village.district,
            district_name_marathi: village.district_marathi,
            total_villages: villagesInTaluka.length,
            village_codes: villageCodes,
            villages: villagesInTaluka // Full village data if needed
        };

        next();
    } catch (error) {
        console.error('Error in getVillagesByTaluka middleware:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

/**
 * Utility function to get villages by taluka code directly
 * Can be used without middleware
 * 
 * @param {number} villageCode - The village code to look up
 * @returns {Object} Object containing taluka info and village codes
 */
const getVillagesByTalukaUtil = (villageCode) => {
    try {
        const villageCodeNum = parseInt(villageCode);

        // Find the village with the given village code
        const village = villageData.find(v => v.village_code === villageCodeNum);

        if (!village) {
            return {
                success: false,
                message: `Village with code ${villageCode} not found`
            };
        }

        // Get the taluka_code from the found village
        const talukaCode = village.taluka_code;

        // Find all villages with the same taluka_code
        const villagesInTaluka = villageData.filter(v => v.taluka_code === talukaCode);

        // Extract just the village codes
        const villageCodes = villagesInTaluka.map(v => v.village_code);

        return {
            success: true,
            data: {
                village_code: villageCodeNum,
                taluka_code: talukaCode,
                taluka_name: village.taluka,
                taluka_name_marathi: village.taluka_marathi,
                district_code: village.district_code,
                district_name: village.district,
                district_name_marathi: village.district_marathi,
                total_villages: villagesInTaluka.length,
                village_codes: villageCodes,
                villages: villagesInTaluka
            }
        };
    } catch (error) {
        return {
            success: false,
            message: 'Error processing request',
            error: error.message
        };
    }
};

module.exports = {
    getVillagesByTaluka,
    getVillagesByTalukaUtil
};
