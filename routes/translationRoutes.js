const express = require("express");
const { getTranslationBuckets } = require("../controllers/translation.controller");

const router = express.Router();

// Get translated vs already-English query buckets from Langfuse
router.get("/translations/pretranslation", getTranslationBuckets);

module.exports = router;
