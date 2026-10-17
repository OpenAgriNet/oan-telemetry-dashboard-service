const router = require("express").Router();
const { getServiceSnapshot } = require("../controllers/serviceSnapshot.controller");
const { getServiceApiCalls } = require("../controllers/serviceApiCalls.controller");

router.get("/service-snapshot", getServiceSnapshot);
router.get("/service-snapshot/api-calls", getServiceApiCalls);

module.exports = router;
