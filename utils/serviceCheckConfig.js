/**
 * Service Check registry: groups ext_api_calls.api_service values into services.
 *
 * To add a service, add an entry here and have the provider send
 * networkApiDetails.apiService values starting with its prefix.
 * Unlisted api_service values are still shown, grouped by the text before
 * their first "_" (e.g. "pmfby_policy_status" -> service "pmfby").
 */
const SERVICE_CHECKS = [
  {
    id: "pmkisan",
    label: "PM-KISAN",
    apiPrefix: "pmkisan_",
    apis: {
      pmkisan_send_otp: "Send OTP",
      pmkisan_verify_otp: "Verify OTP",
      pmkisan_user_details: "User Details",
      pmkisan_beneficiary_status: "Beneficiary Status",
      pmkisan_grievance_aadhaar_token: "Grievance Aadhaar Token",
      pmkisan_grievance_status: "Grievance Status",
      pmkisan_grievance_lodge: "Grievance Lodge",
    },
  },
];

function findServiceForApi(apiService) {
  const api = String(apiService || "");
  const configured = SERVICE_CHECKS.find((s) => api.startsWith(s.apiPrefix));
  if (configured) return configured;

  const id = api.includes("_") ? api.slice(0, api.indexOf("_")) : api || "unknown";
  return { id, label: id.toUpperCase(), apiPrefix: `${id}_`, apis: {} };
}

function getApiLabel(service, apiService) {
  if (service.apis[apiService]) return service.apis[apiService];
  const rest = apiService.startsWith(service.apiPrefix)
    ? apiService.slice(service.apiPrefix.length)
    : apiService;
  return rest
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || apiService;
}

module.exports = { SERVICE_CHECKS, findServiceForApi, getApiLabel };
