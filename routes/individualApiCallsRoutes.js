const router = require("express").Router();
const { getIndividualApiCalls, getIndividualApiCall } = require("../controllers/individualApiCalls.controller");

router.get("/individual-api-calls", getIndividualApiCalls);
router.get("/individual-api-calls/:id", getIndividualApiCall);

module.exports = router;
