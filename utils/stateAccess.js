const STATE_CONFIG = {
  "bharat-vistaar": {
    id: "bharat-vistaar",
    label: "Bharat Vistaar",
    adminRole: "admin-bharat",
    exactChannels: ["BharatVistaar"],
    prefixChannels: ["BharatVistaar-"],
    capabilities: {
      unifiedMetrics: true,
      chatTelemetryTabs: [
        "dashboard",
        "users",
        "sessions",
        "questions",
        "feedback",
        "langfuse-questions",
        "errors",
        "asr",
        "tts",
      ],
    },
  },
  "bihar-krishi": {
    id: "bihar-krishi",
    label: "Bihar Krishi",
    adminRole: "admin-bihar",
    exactChannels: ["BiharKrishi"],
    prefixChannels: ["BiharKrishi-"],
    capabilities: {
      unifiedMetrics: false,
      chatTelemetryTabs: [
        "dashboard",
        "users",
        "sessions",
        "questions",
        "feedback",
        "errors",
      ],
    },
  },
};

const STATE_ALIASES = {
  bharat: "bharat-vistaar",
  bharatvistaar: "bharat-vistaar",
  "bharat-vistaar": "bharat-vistaar",
  bihar: "bihar-krishi",
  biharkrishi: "bihar-krishi",
  "bihar-krishi": "bihar-krishi",
};

function getRealmRoles(user) {
  return Array.isArray(user?.realm_access?.roles)
    ? user.realm_access.roles
    : [];
}

function isSuperAdmin(user) {
  return getRealmRoles(user).includes("super-admin");
}

function normalizeStateId(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  return STATE_ALIASES[value.trim().toLowerCase()] || null;
}

function getAllowedStateIds(user) {
  const roles = getRealmRoles(user);

  if (roles.includes("super-admin")) {
    return Object.keys(STATE_CONFIG);
  }

  return Object.values(STATE_CONFIG)
    .filter((state) => roles.includes(state.adminRole))
    .map((state) => state.id);
}

function getRequestedStateId(req) {
  const headerState = req.headers["x-telemetry-state"];
  const queryState = req.query?.state;

  const requestedValue = Array.isArray(headerState)
    ? headerState[0]
    : headerState || queryState;

  return normalizeStateId(requestedValue);
}

function requireStateAccess(req, res, next) {
  const requestedStateId = getRequestedStateId(req);

  if (!requestedStateId) {
    return res.status(400).json({
      status: "error",
      message: "State is required",
    });
  }

  const allowedStateIds = getAllowedStateIds(req.user);
  if (!allowedStateIds.includes(requestedStateId)) {
    return res.status(403).json({
      status: "error",
      message: "Forbidden for requested state",
    });
  }

  req.telemetryState = STATE_CONFIG[requestedStateId];
  next();
}

function buildChannelFilterClause(columnExpr, telemetryState, queryParams, paramIndex) {
  const exactChannels = telemetryState?.exactChannels || [];
  const prefixChannels = telemetryState?.prefixChannels || [];
  const conditions = [];
  let nextParamIndex = paramIndex;

  if (exactChannels.length > 0) {
    nextParamIndex += 1;
    queryParams.push(exactChannels);
    conditions.push(`${columnExpr} = ANY($${nextParamIndex})`);
  }

  for (const prefix of prefixChannels) {
    nextParamIndex += 1;
    queryParams.push(`${prefix}%`);
    conditions.push(`${columnExpr} ILIKE $${nextParamIndex}`);
  }

  if (conditions.length === 0) {
    return {
      clause: "1=1",
      paramIndex: nextParamIndex,
    };
  }

  return {
    clause: `(${conditions.join(" OR ")})`,
    paramIndex: nextParamIndex,
  };
}

function appendChannelFilter(baseSql, joiner, columnExpr, telemetryState, queryParams, paramIndex) {
  const { clause, paramIndex: nextParamIndex } = buildChannelFilterClause(
    columnExpr,
    telemetryState,
    queryParams,
    paramIndex,
  );

  return {
    sql: `${baseSql} ${joiner} ${clause}`,
    paramIndex: nextParamIndex,
  };
}

module.exports = {
  STATE_CONFIG,
  getRealmRoles,
  isSuperAdmin,
  normalizeStateId,
  getAllowedStateIds,
  getRequestedStateId,
  requireStateAccess,
  buildChannelFilterClause,
  appendChannelFilter,
};
