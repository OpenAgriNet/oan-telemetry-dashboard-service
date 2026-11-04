const router = require("express").Router();
const { getMhGap } = require("../controllers/mhGapReconstruction.controller");
const { getServiceSnapshot } = require("../controllers/serviceSnapshot.controller");
const { getServiceApiCalls } = require("../controllers/serviceApiCalls.controller");

router.get("/service-snapshot/mh-gap-reconstruction", getMhGap);
router.get("/service-snapshot", getServiceSnapshot);
router.get("/service-snapshot/api-calls", getServiceApiCalls);

module.exports = router;
