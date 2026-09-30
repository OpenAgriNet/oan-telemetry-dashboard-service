const test = require("node:test");
const assert = require("node:assert/strict");
const { buildServiceSnapshot } = require("../services/serviceSnapshot");

test("builds an MH Vistaar service row with its direct API child", () => {
  const providers = buildServiceSnapshot(
    [{
      source_service: "mh-provider-backend",
      service_category: "price-discovery",
      service_requests: "10",
      successful_requests: "9",
      failed_requests: "1",
      p90_latency_ms: "45",
      max_latency_ms: "90",
    }],
    [{
      source_service: "mh-provider-backend",
      method: "POST",
      endpoint_path: "/webservices/fetch_apmc_market_price",
      api_requests: "12",
      successful_requests: "11",
      failed_requests: "1",
      p90_latency_ms: "30",
      max_latency_ms: "75",
    }]
  );

  assert.equal(providers.length, 1);
  assert.equal(providers[0].name, "MH Vistaar");
  assert.equal(providers[0].services[0].name, "Mandi");
  assert.equal(providers[0].services[0].metrics.requests, 10);
  assert.equal(providers[0].services[0].apiRequests, 12);
  assert.equal(providers[0].services[0].apis[0].name, "Fetch APMC market price");
});

test("uses the actual provider operation endpoint when a service has no direct API span", () => {
  const providers = buildServiceSnapshot(
    [{
      source_service: "mh-provider-backend",
      service_category: "chc",
      provider_endpoints: ["/mh-vistaar/select"],
      provider_methods: ["POST"],
      service_requests: "2",
      successful_requests: "2",
      failed_requests: "0",
      p90_latency_ms: "30",
      max_latency_ms: "31",
    }],
    []
  );

  const service = providers[0].services[0];
  assert.equal(service.name, "CHC");
  assert.equal(service.apis[0].kind, "fallback");
  assert.equal(service.apis[0].endpoint, "/mh-vistaar/select");
  assert.equal(service.apis[0].name, "Provider operation");
  assert.equal(service.apiRequests, 2);
});

test("classifies an unclassified DBT status request from its linked upstream API", () => {
  const providers = buildServiceSnapshot(
    [{
      source_service: "mh-pocradbt-provider-backend",
      service_category: "(unclassified)",
      provider_endpoints: ["/mh-vistaar/status"],
      provider_methods: ["POST"],
      linked_api_endpoints: ["/api/ApplicationStatus/application-list"],
      service_requests: "9",
      successful_requests: "9",
      failed_requests: "0",
      p90_latency_ms: "410",
      max_latency_ms: "1100",
    }],
    [{
      source_service: "mh-pocradbt-provider-backend",
      method: "POST",
      endpoint_path: "/api/ApplicationStatus/application-list",
      api_requests: "9",
      successful_requests: "9",
      failed_requests: "0",
      p90_latency_ms: "410",
      max_latency_ms: "1100",
    }]
  );

  const service = providers[0].services[0];
  assert.equal(service.name, "DBT application status");
  assert.equal(service.metrics.requests, 9);
  assert.equal(service.apis[0].name, "Get DBT application status");
  assert.equal(service.apis[0].endpoint, "/api/ApplicationStatus/application-list");
});

test("keeps an unclassified request visible with its real endpoint", () => {
  const providers = buildServiceSnapshot(
    [{
      source_service: "mh-pocradbt-provider-backend",
      service_category: "(unclassified)",
      provider_endpoints: ["/mh-vistaar/unknown"],
      provider_methods: ["POST"],
      service_requests: "1",
      successful_requests: "0",
      failed_requests: "1",
      p90_latency_ms: "20",
      max_latency_ms: "20",
    }],
    []
  );

  const service = providers[0].services[0];
  assert.equal(service.name, "Unclassified: /mh-vistaar/unknown");
  assert.equal(service.apis[0].endpoint, "/mh-vistaar/unknown");
});

test("keeps an uncaptured HTTP method empty instead of assuming POST", () => {
  const providers = buildServiceSnapshot(
    [{
      source_service: "mh-provider-backend",
      service_category: "price-discovery",
      service_requests: "1",
      successful_requests: "1",
      failed_requests: "0",
      p90_latency_ms: "20",
      max_latency_ms: "20",
    }],
    [{
      source_service: "mh-provider-backend",
      method: null,
      endpoint_path: "/webservices/fetch_apmc_market_price",
      api_requests: "1",
      successful_requests: "1",
      failed_requests: "0",
      p90_latency_ms: "10",
      max_latency_ms: "10",
    }]
  );

  assert.equal(providers[0].services[0].apis[0].method, null);
});

test("shows a captured unmapped API under its known parent service", () => {
  const providers = buildServiceSnapshot(
    [{
      source_service: "mh-provider-backend",
      service_category: "price-discovery",
      provider_endpoints: ["/mh-vistaar/search"],
      service_requests: "1",
      successful_requests: "1",
      failed_requests: "0",
      p90_latency_ms: "20",
      max_latency_ms: "20",
    }],
    [{
      source_service: "mh-provider-backend",
      parent_service_categories: ["price-discovery"],
      method: "GET",
      endpoint_path: "/webservices/new-market-endpoint",
      api_requests: "1",
      successful_requests: "1",
      failed_requests: "0",
      p90_latency_ms: "10",
      max_latency_ms: "10",
    }]
  );

  const service = providers[0].services[0];
  assert.equal(service.name, "Mandi");
  assert.equal(service.apis[0].name, "/webservices/new-market-endpoint");
  assert.equal(service.apis[0].endpoint, "/webservices/new-market-endpoint");
});

test("shows a captured unmapped API under the real unclassified provider route", () => {
  const providers = buildServiceSnapshot(
    [{
      source_service: "mh-pocradbt-provider-backend",
      service_category: "(unclassified)",
      provider_endpoints: ["/mh-vistaar/status"],
      service_requests: "1",
      successful_requests: "0",
      failed_requests: "1",
      p90_latency_ms: "20",
      max_latency_ms: "20",
    }],
    [{
      source_service: "mh-pocradbt-provider-backend",
      parent_service_categories: ["(unclassified)"],
      parent_provider_endpoints: ["/mh-vistaar/status"],
      method: null,
      endpoint_path: "/api/new-status-endpoint",
      api_requests: "1",
      successful_requests: "0",
      failed_requests: "1",
      p90_latency_ms: "10",
      max_latency_ms: "10",
    }]
  );

  const service = providers[0].services[0];
  assert.equal(service.name, "Unclassified: /mh-vistaar/status");
  assert.equal(service.apis[0].endpoint, "/api/new-status-endpoint");
  assert.equal(service.apis[0].method, null);
});

test("does not duplicate a fixed-mapped API when its parent categories differ", () => {
  const providers = buildServiceSnapshot(
    [{
      source_service: "mh-provider-backend",
      service_category: "agristack_farmer_info",
      service_requests: "10",
      successful_requests: "10",
      failed_requests: "0",
      p90_latency_ms: "20",
      max_latency_ms: "20",
    }],
    [{
      source_service: "mh-provider-backend",
      parent_service_categories: ["agristack_farmer_info", "farmer-details-info"],
      method: "POST",
      endpoint_path: "/webservices/fetch_farmer_info_by_farmer_id",
      api_requests: "10",
      successful_requests: "10",
      failed_requests: "0",
      p90_latency_ms: "10",
      max_latency_ms: "10",
    }]
  );

  const service = providers[0].services[0];
  assert.equal(service.apis.length, 1);
  assert.equal(service.apis[0].name, "Fetch farmer information");
});

test("uses a shared direct API's own category for service attribution", () => {
  const providers = buildServiceSnapshot(
    [{
      source_service: "mh-provider-backend",
      service_category: "chc",
      service_requests: "2",
      successful_requests: "2",
      failed_requests: "0",
      p90_latency_ms: "30",
      max_latency_ms: "31",
    }],
    [{
      source_service: "mh-provider-backend",
      service_categories: ["chc"],
      method: "POST",
      endpoint_path: "/webservices/fetch_nearest_five_common_data_by_location_and_category",
      api_requests: "2",
      successful_requests: "2",
      failed_requests: "0",
      p90_latency_ms: "30",
      max_latency_ms: "31",
    }]
  );

  const service = providers[0].services[0];
  assert.equal(service.name, "CHC");
  assert.equal(service.apis[0].name, "Fetch nearby service locations");
});

test("maps every provider Swagger route to a dashboard service", () => {
  const expectedMappings = {
    "/webservices/get_apmc_market_price": "mandi",
    "/webservices/fetch_apmc_market_price": "mandi",
    "/webservices/get_districts": "location-information",
    "/webservices/get_talukas": "location-information",
    "/webservices/fetch_administrative_information_for_location": "location-information",
    "/webservices/get_nearest_chc_centers": "chc",
    "/webservices/get_chc_center_info": "chc",
    "/webservices/fetch_common_data_by_category": "service-locations",
    "/webservices/fetch_nearest_five_common_data_by_location_and_category": "service-locations",
    "/webservices/fetch_dbt_activity_info": "scheme-information",
    "/webservices/fetch_dbt_scheme_code_info": "scheme-information",
    "/webservices/fetch_dbt_application_status": "dbt-application-status",
    "/webservices/fetch_farmer_info_by_farmer_id": "farmer-agristack",
    "/webservices/fetch_officer_information_for_village_code": "officer-information",
    "/webservices/get_nearest_warehouses": "warehouse",
    "/webservices/nearest_warehouses": "warehouse",
    "/webservices/warehouse_center_info": "warehouse",
    "/webservices/get_hourly_weather": "weather-historical",
    "/webservices/get_daily_weather": "weather-historical",
    "/webservices/get_weather_forecast_for_location_date_range": "weather-forecast",
  };

  const { getApiDefinition } = require("../services/serviceSnapshot");
  for (const [endpoint, serviceKey] of Object.entries(expectedMappings)) {
    assert.equal(getApiDefinition("mh-provider-backend", endpoint)?.serviceKey, serviceKey, endpoint);
  }
});

test("uses an endpoint's fixed service mapping before the correlated category", () => {
  const providers = buildServiceSnapshot(
    [{
      source_service: "mh-provider-backend",
      service_category: "soil_lab",
      service_requests: "1",
      successful_requests: "1",
      failed_requests: "0",
      p90_latency_ms: "20",
      max_latency_ms: "20",
    }, {
      source_service: "mh-provider-backend",
      service_category: "warehouse",
      service_requests: "1",
      successful_requests: "1",
      failed_requests: "0",
      p90_latency_ms: "20",
      max_latency_ms: "20",
    }],
    [{
      source_service: "mh-provider-backend",
      service_category: "soil_lab",
      method: "POST",
      endpoint_path: "/webservices/nearest_warehouses",
      api_requests: "1",
      successful_requests: "1",
      failed_requests: "0",
      p90_latency_ms: "10",
      max_latency_ms: "10",
    }]
  );

  const warehouse = providers[0].services.find((service) => service.key === "warehouse");
  assert.equal(warehouse.apis[0].name, "Get nearby warehouses");
});
