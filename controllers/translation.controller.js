const {
  getPretranslatedQueries,
  getEnglishQueriesFromTraces,
} = require("../langfuse/pretranslation");

function parseAndValidateDateRange(startDate, endDate) {
  const parsedStart = startDate ? new Date(startDate) : null;
  const parsedEnd = endDate ? new Date(endDate) : null;

  if (parsedStart && Number.isNaN(parsedStart.getTime())) {
    return { valid: false, error: "Invalid startDate. Use ISO date string." };
  }
  if (parsedEnd && Number.isNaN(parsedEnd.getTime())) {
    return { valid: false, error: "Invalid endDate. Use ISO date string." };
  }
  if (parsedStart && parsedEnd && parsedStart.getTime() > parsedEnd.getTime()) {
    return { valid: false, error: "startDate cannot be after endDate" };
  }

  return { valid: true };
}

const getTranslationBuckets = async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    const translatedLimit = Math.max(
      1,
      Math.min(1000, parseInt(req.query.translatedLimit, 10) || 100)
    );
    const translatedCursor = req.query.translatedCursor
      ? String(req.query.translatedCursor)
      : null;

    const englishPage = Math.max(1, parseInt(req.query.englishPage, 10) || 1);
    const englishLimit = Math.max(
      1,
      Math.min(200, parseInt(req.query.englishLimit, 10) || 100)
    );

    const validation = parseAndValidateDateRange(startDate, endDate);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    const [translated, english] = await Promise.all([
      getPretranslatedQueries({
        startDate,
        endDate,
        cursor: translatedCursor,
        limit: translatedLimit,
      }),
      getEnglishQueriesFromTraces({
        startDate,
        endDate,
        page: englishPage,
        limit: englishLimit,
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        pretranslatedQueries: translated.items,
        englishQueries: english.items,
      },
      pagination: {
        pretranslated: {
          limit: translatedLimit,
          nextCursor: translated.nextCursor,
        },
        english: english.pagination,
      },
      summary: {
        pretranslatedCount: translated.items.length,
        englishCount: english.items.length,
      },
      filters: {
        startDate,
        endDate,
      },
    });
  } catch (error) {
    console.error("Error fetching translation buckets:", error);
    return res.status(500).json({
      success: false,
      error: "Error fetching translation buckets",
      details: error.message,
    });
  }
};

module.exports = {
  getTranslationBuckets,
};
