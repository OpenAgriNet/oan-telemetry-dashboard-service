const express = require('express');
const router = express.Router();
const { getVillagesByTaluka, getVillagesByTalukaUtil } = require('../middleware/villageMiddleware');

/**
 * @route   GET /api/villages/taluka
 * @desc    Get all villages in the same taluka as the provided village code
 * @access  Public
 * @param   {number} village_code - The village code (query parameter)
 * @example GET /api/villages/taluka?village_code=979797
 */
router.get('/taluka', getVillagesByTaluka, (req, res) => {
    try {
        // The middleware has already populated req.talukaInfo
        return res.status(200).json({
            success: true,
            message: 'Villages fetched successfully',
            data: req.talukaInfo
        });
    } catch (error) {
        console.error('Error in /taluka route:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/villages/taluka/codes
 * @desc    Get only village codes (simplified response)
 * @access  Public
 * @param   {number} village_code - The village code (query parameter)
 * @example GET /api/villages/taluka/codes?village_code=979797
 */
router.get('/taluka/codes', getVillagesByTaluka, (req, res) => {
    try {
        return res.status(200).json({
            success: true,
            message: 'Village codes fetched successfully',
            data: {
                village_code: req.talukaInfo.village_code,
                taluka_code: req.talukaInfo.taluka_code,
                taluka_name: req.talukaInfo.taluka_name,
                total_villages: req.talukaInfo.total_villages,
                village_codes: req.talukaInfo.village_codes
            }
        });
    } catch (error) {
        console.error('Error in /taluka/codes route:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

/**
 * @route   POST /api/villages/taluka
 * @desc    Get all villages in the same taluka (POST method)
 * @access  Public
 * @body    {number} village_code - The village code
 * @example POST /api/villages/taluka with body: { "village_code": 979797 }
 */
router.post('/taluka', getVillagesByTaluka, (req, res) => {
    try {
        return res.status(200).json({
            success: true,
            message: 'Villages fetched successfully',
            data: req.talukaInfo
        });
    } catch (error) {
        console.error('Error in POST /taluka route:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/villages/taluka/:village_code
 * @desc    Get all villages using path parameter
 * @access  Public
 * @param   {number} village_code - The village code (path parameter)
 * @example GET /api/villages/taluka/979797
 */
router.get('/taluka/:village_code', getVillagesByTaluka, (req, res) => {
    try {
        return res.status(200).json({
            success: true,
            message: 'Villages fetched successfully',
            data: req.talukaInfo
        });
    } catch (error) {
        console.error('Error in /taluka/:village_code route:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

module.exports = router;
