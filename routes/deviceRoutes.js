const express = require("express");
const router = express.Router();

const { getDevices, getDeviceGraph } = require("../controllers/device.controller");
const { requireStateAccess } = require("../utils/stateAccess");

router.use(requireStateAccess);

router.get("/devices", getDevices);
router.get("/devices/graph", getDeviceGraph);

module.exports = router;
