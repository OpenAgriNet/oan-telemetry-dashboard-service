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

test("uses the provider operation when a service has no direct API span", () => {
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
    []
  );

  const service = providers[0].services[0];
  assert.equal(service.name, "CHC");
  assert.equal(service.apis[0].kind, "fallback");
  assert.equal(service.apis[0].endpoint, "/mh-vistaar/search");
  assert.equal(service.apiRequests, 2);
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
