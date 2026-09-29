const router = require("express").Router();
const { getServiceSnapshot } = require("../controllers/serviceSnapshot.controller");

router.get("/service-snapshot", getServiceSnapshot);

module.exports = router;
