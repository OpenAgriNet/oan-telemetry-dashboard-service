# oan-telemetry-dashboard-service — Routing Reference

## Auth (JWT via Keycloak JWKS)

JWT verification uses Keycloak's JWKS endpoint. Set one of:

- **Option A:** `KEYCLOAK_JWKS_URI` = full URL, e.g. `https://auth.example.com/realms/amul/protocol/openid-connect/certs`
- **Option B:** `KEYCLOAK_URL` + `KEYCLOAK_REALM`, e.g. `KEYCLOAK_URL=https://auth.example.com` and `KEYCLOAK_REALM=amul`

---

## Base Path

**All API routes use the `/v1` prefix** (except `/health` and leaderboard).

| Path | Auth | Description |
|------|------|-------------|
| `GET /health` | None | Health check |
| `/v1/*` | JWT (authController) | All main API routes |
| `/v1/leaderboard/*` | JWT (leaderboardAuthController) | Leaderboard endpoints |

---

## Full Route Map

### Questions (`/v1` + questionRoutes)
| Method | Path | Handler |
|--------|------|---------|
| GET | `/v1/questions` | getQuestions |
| GET | `/v1/questions/stats` | getQuestionStats |
| GET | `/v1/questions/graph` | getQuestionsGraph |
| GET | `/v1/questions/:id` | getQuestionById |
| GET | `/v1/questions/session/:sessionId` | getQuestionsBySessionId |
| GET | `/v1/questions/count` | getTotalQuestionsCount |
| GET | `/v1/questions/fetch` | fetchQuestionsFromDB |
| GET | `/v1/questions/format` | formatQuestionData |
| GET | `/v1/users/:userId/questions` | getQuestionsByUserId |

### Users (`/v1` + userRoutes)
| Method | Path |
|--------|------|
| GET | `/v1/users` |
| GET | `/v1/users/stats` |
| GET | `/v1/users/name/:username` |
| GET | `/v1/users/count` |
| GET | `/v1/users/fetch` |
| GET | `/v1/users/format` |
| GET | `/v1/userss/graph-user` |

### Sessions (`/v1` + sessionRoutes)
| Method | Path |
|--------|------|
| GET | `/v1/sessions` |
| GET | `/v1/sessions/stats` |
| GET | `/v1/sessions/graph` |
| GET | `/v1/sessions/:sessionId` |
| GET | `/v1/users/:userId/sessions` |
| GET | `/v1/sessions/count` |
| GET | `/v1/sessions/fetch` |
| GET | `/v1/sessions/format` |

### Feedback (`/v1` + feedbackRoutes)
| Method | Path |
|--------|------|
| GET | `/v1/feedback` |
| GET | `/v1/feedback/stats` |
| GET | `/v1/feedback/graph` |
| GET | `/v1/feedback/id/:id` |
| GET | `/v1/feedback/session/:sessionId` |
| GET | `/v1/feedback/count` |
| GET | `/v1/feedback/fetch` |
| GET | `/v1/feedback/format` |

### Errors (`/v1` + errorRoutes)
| Method | Path |
|--------|------|
| GET | `/v1/errors` |
| GET | `/v1/errors/stats` |
| GET | `/v1/errors/graph` |
| GET | `/v1/errors/id/:id` |
| GET | `/v1/errors/session/:sessionId` |

### Dashboard (`/v1` + dashboardRoutes)
| Method | Path |
|--------|------|
| GET | `/v1/dashboard/stats` |
| GET | `/v1/dashboard/user-analytics` |
| GET | `/v1/dashboard/user-graph` |

### Villages (`/v1/api/villages` + villageRoutes)
| Method | Path |
|--------|------|
| GET | `/v1/api/villages/taluka` |
| GET | `/v1/api/villages/taluka/codes` |
| POST | `/v1/api/villages/taluka` |
| GET | `/v1/api/villages/taluka/:village_code` |

### Leaderboard (`/v1/leaderboard` + leaderboardRoutes)
| Method | Path |
|--------|------|
| GET | `/v1/leaderboard/top10/state` |
| GET | `/v1/leaderboard/top10/district` |
| GET | `/v1/leaderboard/top10/taluka` |
| GET | `/v1/leaderboard/top10/month` |
| GET | `/v1/leaderboard/district` |
| GET | `/v1/leaderboard/taluka` |
| GET | `/v1/leaderboard/village` |
| GET | `/v1/leaderboard/reports/active-farmers` |

---

## Why `/questions` Returns 404

The **frontend** calls:
```
{SERVER_URL}/questions   → e.g. https://feedback-dashboard-api.prod.amulai.in/questions
```

The **backend** serves questions at:
```
/v1/questions           → e.g. https://feedback-dashboard-api.prod.amulai.in/v1/questions
```

**Fix:** Set `VITE_SERVER_URL` to include the `/v1` base path:
```
VITE_SERVER_URL=https://feedback-dashboard-api.prod.amulai.in/v1
```

Then the frontend will call `https://feedback-dashboard-api.prod.amulai.in/v1/questions`, which matches the backend.
