const { parseDateRange } = require("../utils/dateUtils");
const { getExtApiCallStats } = require("./becknExt.controller");
const {
  SERVICE_CHECKS,
  findServiceForApi,
  getApiLabel,
} = require("../utils/serviceCheckConfig");

const COUNT_KEYS = ["total", "success", "rejected", "error", "unknown"];

function emptyCounts() {
  return { total: 0, success: 0, rejected: 0, error: 0, unknown: 0 };
}

function withRates(counts) {
  return {
    ...counts,
    // "failed" = everything that did not complete (refused by upstream + system errors)
    failed: counts.rejected + counts.error,
    successRate:
      counts.total > 0 ? Math.round((counts.success / counts.total) * 100) : 0,
  };
}

/**
 * Group per-API call counts into services (see utils/serviceCheckConfig.js).
 * Configured services are always listed, even with zero calls in the range.
 */
function groupByService(apis, errorTypes) {
  const services = new Map();
  const ensure = (service) => {
    if (!services.has(service.id)) {
      services.set(service.id, {
        id: service.id,
        label: service.label,
        totals: emptyCounts(),
        apis: [],
      });
    }
    return services.get(service.id);
  };

  SERVICE_CHECKS.forEach(ensure);

  const errorTypesByApi = {};
  errorTypes.forEach(({ apiService, errorType, count }) => {
    (errorTypesByApi[apiService] ||= []).push({ errorType, count });
  });

  apis.forEach((api) => {
    const service = findServiceForApi(api.apiService);
    const entry = ensure(service);
    COUNT_KEYS.forEach((k) => {
      entry.totals[k] += api[k];
    });
    entry.apis.push({
      apiService: api.apiService,
      label: getApiLabel(service, api.apiService),
      ...withRates(COUNT_KEYS.reduce((o, k) => ({ ...o, [k]: api[k] }), {})),
      avgLatencyMs: api.avgLatencyMs,
      maxLatencyMs: api.maxLatencyMs,
      lastCallAt: api.lastCallAt,
      errorTypes: errorTypesByApi[api.apiService] || [],
    });
  });

  // Configured APIs with no calls in the range still show up, with zeros
  SERVICE_CHECKS.forEach((service) => {
    const entry = services.get(service.id);
    Object.entries(service.apis).forEach(([apiService, label]) => {
      if (!entry.apis.some((a) => a.apiService === apiService)) {
        entry.apis.push({
          apiService,
          label,
          ...withRates(emptyCounts()),
          avgLatencyMs: 0,
          maxLatencyMs: 0,
          lastCallAt: null,
          errorTypes: [],
        });
      }
    });
  });

  // Configured API order first, then anything new alphabetically
  return Array.from(services.values()).map((s) => {
    const configured = SERVICE_CHECKS.find((c) => c.id === s.id);
    const order = configured ? Object.keys(configured.apis) : [];
    const rank = (a) => {
      const i = order.indexOf(a.apiService);
      return i === -1 ? order.length : i;
    };
    return {
      ...s,
      totals: withRates(s.totals),
      apis: s.apis.sort(
        (a, b) => rank(a) - rank(b) || a.apiService.localeCompare(b.apiService),
      ),
    };
  });
}

/**
 * GET /v1/service-check
 * Query: startDate, endDate, service (service id, e.g. "pmkisan")
 */
const getServiceCheckHandler = async (req, res) => {
  try {
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
    const serviceId = req.query.service ? String(req.query.service).trim() : null;

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if (
      (startDate && startTimestamp === null) ||
      (endDate && endTimestamp === null)
    ) {
      return res.status(400).json({
        message:
          "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }
    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res
        .status(400)
        .json({ message: "Start date cannot be after end date" });
    }

    const stats = await getExtApiCallStats({
      startDate,
      endDate,
      telemetryState: req.telemetryState,
    });

    let services = groupByService(stats.apis, stats.errorTypes);
    if (serviceId) {
      services = services.filter((s) => s.id === serviceId);
    }

    return res.status(200).json({
      services,
      filters: {
        ...stats.filters,
        service: serviceId,
      },
    });
  } catch (error) {
    console.error("Error fetching service check:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

module.exports = {
  getServiceCheckHandler,
  // exported for tests / reuse
  groupByService,
};
