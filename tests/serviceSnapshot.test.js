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
      parent_service_category: "price-discovery",
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
      parent_service_category: "(unclassified)",
      parent_provider_endpoint: "/mh-vistaar/status",
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

test("uses the correlated parent category for a shared direct API", () => {
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
      service_category: "chc",
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
