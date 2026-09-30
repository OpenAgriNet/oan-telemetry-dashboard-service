const PROVIDERS = {
  "mh-provider-backend": "MH Vistaar",
  "mh-pocradbt-provider-backend": "POCRA",
};

const SERVICE_CATEGORIES = {
  "mh-provider-backend": {
    "price-discovery": { key: "mandi", name: "Mandi", description: "APMC market-price information" },
    "schemes-agri": { key: "scheme-information", name: "Scheme information", description: "Agricultural scheme information" },
    "dbt-application-status": { key: "dbt-application-status", name: "DBT application status", description: "DBT application-status information" },
    "agristack_farmer_info": { key: "farmer-agristack", name: "Farmer / Agristack", description: "Farmer and land information" },
    "Weather-Forecast": { key: "weather-forecast", name: "Weather – Forecast", description: "IMD weather forecast for a location and date range" },
    "Weather-Historical": { key: "weather-historical", name: "Weather – Historical", description: "Historical and daily weather for a location and date range" },
    warehouse: { key: "warehouse", name: "Warehouse", description: "Nearby warehouses and warehouse details" },
    chc: { key: "chc", name: "CHC", description: "Custom Hiring Centre information" },
    rent: { key: "chc", name: "CHC", description: "Custom Hiring Centre information" },
    kvk: { key: "kvk", name: "KVK", description: "Krishi Vigyan Kendra information" },
    soil_lab: { key: "soil-lab", name: "Soil Lab", description: "Soil testing laboratory information" },
    "village-information": { key: "location-information", name: "Location information", description: "Administrative information for a location" },
    officer: { key: "officer-information", name: "Officer information", description: "Officer information for a village" },
    "service-locations": { key: "service-locations", name: "Service locations", description: "Nearby common service locations" },
  },
  "mh-pocradbt-provider-backend": {
    "farmer-master-data": { key: "farmer-master-data", name: "Farmer master data", description: "POCRA DBT farmer-master lookup" },
    "activity-list-note": { key: "activity-notes", name: "Activity notes", description: "POCRA DBT activity notes" },
    "district-list": { key: "district-master-data", name: "District master data", description: "POCRA DBT district list" },
    "taluka-list": { key: "taluka-master-data", name: "Taluka master data", description: "POCRA DBT taluka list" },
    "village-list": { key: "village-master-data", name: "Village master data", description: "POCRA DBT village list" },
    "activity-list": { key: "activity-group-list", name: "Activity group list", description: "POCRA DBT activity groups" },
    "dbt-consent": { key: "dbt-consent", name: "DBT consent", description: "POCRA DBT consent and undertaking details" },
    "land-validation": { key: "land-validation", name: "Land validation", description: "POCRA DBT land validation" },
    "dbt-application-submit": { key: "dbt-application-submission", name: "DBT application submission", description: "POCRA DBT application submission" },
    "personal-profile-update": { key: "profile-update", name: "Profile update", description: "POCRA DBT personal-profile update" },
    "land-resources-update": { key: "profile-update", name: "Profile update", description: "POCRA DBT land-resources update" },
    "address-profile-update": { key: "profile-update", name: "Profile update", description: "POCRA DBT address update" },
    "pocra-dbt-status": { key: "dbt-application-status", name: "DBT application status", description: "POCRA DBT application status" },
  },
};

const DIRECT_APIS = {
  "mh-provider-backend": {
    "/webservices/get_apmc_market_price": { serviceKey: "mandi", name: "Get APMC market price", description: "Mandi market-price lookup" },
    "/webservices/get_daily_weather": { serviceKey: "weather-historical", name: "Get daily weather", description: "Daily historical weather lookup" },
    "/webservices/get_hourly_weather": { serviceKey: "weather-historical", name: "Get hourly weather", description: "Hourly historical weather lookup" },
    "/webservices/get_weather_forecast_for_location_date_range": { serviceKey: "weather-forecast", name: "Get weather forecast", description: "Weather forecast lookup" },
    "/webservices/fetch_apmc_market_price": { serviceKey: "mandi", name: "Fetch APMC market price", description: "Mandi market-price lookup" },
    "/webservices/fetch_farmer_info_by_farmer_id": { serviceKey: "farmer-agristack", name: "Fetch farmer information", description: "Farmer and land information lookup" },
    "/webservices/fetch_dbt_activity_info": { serviceKey: "scheme-information", name: "Fetch DBT activity information", description: "DBT activity lookup" },
    "/webservices/fetch_dbt_scheme_code_info": { serviceKey: "scheme-information", name: "Fetch DBT scheme information", description: "Agricultural scheme lookup" },
    "/webservices/fetch_dbt_application_status": { serviceKey: "dbt-application-status", name: "Fetch DBT application status", description: "DBT application-status lookup" },
    "/webservices/get_nearest_chc_centers": { serviceKey: "chc", name: "Get nearby CHC centres", description: "Nearby Custom Hiring Centre lookup" },
    "/webservices/get_chc_center_info": { serviceKey: "chc", name: "Get CHC centre information", description: "Custom Hiring Centre details" },
    "/webservices/get_nearest_warehouses": { serviceKey: "warehouse", name: "Get nearby warehouses", description: "Nearby warehouse lookup" },
    "/webservices/nearest_warehouses": { serviceKey: "warehouse", name: "Get nearby warehouses", description: "Nearby warehouse lookup" },
    "/webservices/warehouse_center_info": { serviceKey: "warehouse", name: "Get warehouse information", description: "Warehouse details" },
    "/webservices/get_districts": { serviceKey: "location-information", name: "Get districts", description: "Administrative district lookup" },
    "/webservices/get_talukas": { serviceKey: "location-information", name: "Get talukas", description: "Administrative taluka lookup" },
    "/webservices/fetch_administrative_information_for_location": { serviceKey: "location-information", name: "Fetch administrative information", description: "Administrative location lookup" },
    "/webservices/fetch_common_data_by_category": { serviceKey: "service-locations", name: "Fetch common data by category", description: "Category-specific common-data lookup" },
    "/webservices/fetch_nearest_five_common_data_by_location_and_category": { serviceKey: "service-locations", name: "Fetch nearby service locations", description: "Nearby common service locations" },
    "/webservices/fetch_officer_information_for_village_code": { serviceKey: "officer-information", name: "Fetch officer information", description: "Village officer lookup" },
  },
  "mh-pocradbt-provider-backend": {
    "/api/FarmerLogin/get-farmer-master-data": { serviceKey: "farmer-master-data", name: "Get farmer master data", description: "POCRA DBT farmer-master lookup" },
    "/gateway/Activity/GetActivityNotes": { serviceKey: "activity-notes", name: "Get activity notes", description: "POCRA DBT activity notes" },
    "/gateway/masterdata/GetAllDistrict": { serviceKey: "district-master-data", name: "Get districts", description: "POCRA DBT district list" },
    "/gateway/masterdata/GetTalukaByDistrict": { serviceKey: "taluka-master-data", name: "Get talukas", description: "POCRA DBT taluka list" },
    "/gateway/masterdata/GetVillageByTaluka": { serviceKey: "village-master-data", name: "Get villages", description: "POCRA DBT village list" },
    "/api/dbt-application-process/wrapper/FarmerApplication/GetActivitiesByGroup": { serviceKey: "activity-group-list", name: "Get activity groups", description: "POCRA DBT activity groups" },
    "/api/dbt-application-process/wrapper/FarmerApplication/GetUndertakingInfo": { serviceKey: "dbt-consent", name: "Get undertaking information", description: "POCRA DBT consent and undertaking details" },
    "/api/dbt-application-process/wrapper/FarmerApplication/GetLandValidationInfo": { serviceKey: "land-validation", name: "Get land validation information", description: "POCRA DBT land validation" },
    "/api/dbt-application-process/wrapper/FarmerApplication/SubmitApplication": { serviceKey: "dbt-application-submission", name: "Submit DBT application", description: "POCRA DBT application submission" },
    "/api/ApplicationStatus/application-list": { serviceKey: "dbt-application-status", name: "Get DBT application status", description: "POCRA DBT application status" },
  },
};

function toNumber(value) {
  return Number(value || 0);
}

function toMetrics(row, requestField) {
  const requests = toNumber(row[requestField]);
  const successfulRequests = toNumber(row.successful_requests);
  const failedRequests = toNumber(row.failed_requests);

  return {
    requests,
    successfulRequests,
    failedRequests,
    successPercentage: requests ? Number(((successfulRequests / requests) * 100).toFixed(2)) : 0,
    failurePercentage: requests ? Number(((failedRequests / requests) * 100).toFixed(2)) : 0,
    p90LatencyMs: row.p90_latency_ms === null ? null : toNumber(row.p90_latency_ms),
    maxLatencyMs: row.max_latency_ms === null ? null : toNumber(row.max_latency_ms),
  };
}

function fallbackService(category) {
  return {
    key: `unmapped-${String(category || "service").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: category || "Unmapped service",
    description: "Service classification awaiting dashboard mapping",
  };
}

function getServiceDefinition(sourceService, category) {
  return SERVICE_CATEGORIES[sourceService]?.[category] || fallbackService(category);
}

function getServiceDefinitionByKey(sourceService, serviceKey) {
  const definitions = Object.values(SERVICE_CATEGORIES[sourceService] || {});
  return definitions.find((definition) => definition.key === serviceKey) || fallbackService("Unmapped service");
}

function getApiDefinition(sourceService, endpointPath) {
  return DIRECT_APIS[sourceService]?.[endpointPath] || null;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function getRequestServiceDefinition(row) {
  const categoryDefinition = SERVICE_CATEGORIES[row.source_service]?.[row.service_category];
  if (categoryDefinition) return categoryDefinition;

  // Some provider operations (notably /status) do not include a business
  // category in their request payload. Their linked downstream API is still
  // enough to identify the business service.
  const linkedDefinition = asArray(row.linked_api_endpoints)
    .map((endpoint) => getApiDefinition(row.source_service, endpoint))
    .find(Boolean);
  if (linkedDefinition) {
    return getServiceDefinitionByKey(row.source_service, linkedDefinition.serviceKey);
  }

  const providerEndpoint = asArray(row.provider_endpoints)[0];
  if (row.service_category === "(unclassified)" && providerEndpoint) {
    return fallbackService(`Unclassified: ${providerEndpoint}`);
  }

  return fallbackService(row.service_category);
}

function buildServiceSnapshot(serviceRows, apiRows) {
  const providers = new Map();

  const ensureService = (providerName, definition) => {
    if (!providers.has(providerName)) {
      providers.set(providerName, { name: providerName, services: new Map() });
    }

    const services = providers.get(providerName).services;
    if (!services.has(definition.key)) {
      services.set(definition.key, {
        ...definition,
        metrics: null,
        apis: [],
        serviceCategories: [],
        providerEndpoints: [],
        providerMethods: [],
      });
    }
    return services.get(definition.key);
  };

  for (const row of serviceRows) {
    const providerName = PROVIDERS[row.source_service];
    if (!providerName) continue;

    const service = ensureService(providerName, getRequestServiceDefinition(row));
    service.metrics = toMetrics(row, "service_requests");
    service.serviceCategories.push(row.service_category);
    service.providerEndpoints.push(...asArray(row.provider_endpoints));
    service.providerMethods.push(...asArray(row.provider_methods));
  }

  for (const row of apiRows) {
    const providerName = PROVIDERS[row.source_service];
    if (!providerName) continue;

    const definition = getApiDefinition(row.source_service, row.endpoint_path);
    const serviceCategories = asArray(
      row.service_categories || row.service_category || row.parent_service_categories || row.parent_service_category
    );
    const categoryDefinitions = serviceCategories
      .map((category) => SERVICE_CATEGORIES[row.source_service]?.[category])
      .filter(Boolean);
    const distinctCategoryDefinitions = [...new Map(
      categoryDefinitions.map((categoryDefinition) => [categoryDefinition.key, categoryDefinition])
    ).values()];
    const categoryDefinition = distinctCategoryDefinitions.length === 1 ? distinctCategoryDefinitions[0] : null;
    const parentProviderEndpoint = asArray(
      row.parent_provider_endpoints || row.parent_provider_endpoint
    )[0];
    // Shared common-data APIs describe their business service in their own
    // outbound payload. That is more specific than a trace, which may contain
    // several provider operations.
    const serviceDefinition = definition?.serviceKey === "service-locations" && categoryDefinition
      ? categoryDefinition
      : definition
        ? getServiceDefinitionByKey(row.source_service, definition.serviceKey)
        : categoryDefinition
          || (
            serviceCategories.includes("(unclassified)") && parentProviderEndpoint
              ? fallbackService(`Unclassified: ${parentProviderEndpoint}`)
              : fallbackService("Unmapped service")
          );
    const service = ensureService(
      providerName,
      serviceDefinition
    );

    service.apis.push({
      key: `${row.method || ""}-${row.endpoint_path}`,
      name: definition?.name || row.endpoint_path,
      description: definition?.description || "Observed direct provider API",
      sourceService: row.source_service,
      scopeCategories: (definition?.serviceKey === "service-locations" || !definition)
        ? serviceCategories.filter(Boolean)
        : [],
      method: row.method || null,
      endpoint: row.endpoint_path,
      kind: "direct",
      metrics: toMetrics(row, "api_requests"),
    });
  }

  const snapshot = Array.from(providers.values())
    .map((provider) => ({
      name: provider.name,
      services: Array.from(provider.services.values())
        .map((service) => {
          if (!service.metrics) return null;

          if (!service.apis.length) {
            service.apis.push({
              key: `provider-operation-${service.providerEndpoints[0] || "unknown"}`,
              name: "Provider operation",
              description: "No direct downstream provider API was linked to this request",
              sourceService: Object.entries(PROVIDERS).find(([, name]) => name === provider.name)?.[0] || null,
              scopeCategories: [...new Set(service.serviceCategories.filter(Boolean))],
              method: service.providerMethods[0] || null,
              endpoint: service.providerEndpoints[0] || null,
              kind: "fallback",
              metrics: service.metrics,
            });
          }

          const { providerEndpoints, providerMethods, serviceCategories, ...serviceData } = service;
          return {
            ...serviceData,
            apiRequests: serviceData.apis.reduce((total, api) => total + api.metrics.requests, 0),
          };
        })
        .filter(Boolean)
        .sort((left, right) => right.metrics.requests - left.metrics.requests),
    }))
    .filter((provider) => provider.services.length)
    .sort((left, right) => left.name.localeCompare(right.name));

  return snapshot;
}

module.exports = {
  buildServiceSnapshot,
  getApiDefinition,
  getServiceDefinition,
};
