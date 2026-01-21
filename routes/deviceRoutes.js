const express = require("express");
const router = express.Router();

const { getDevices } = require("../controllers/device.controller");
router.get("/devices", getDevices);

module.exports = router;
