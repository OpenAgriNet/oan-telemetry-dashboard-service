# Keycloak Authentication in Telemetry Query Service

This document provides information on how to set up and use Keycloak authentication with the Telemetry Query Service.

## Overview

The Telemetry Query Service uses Keycloak for authentication and authorization. It verifies JWT tokens issued by Keycloak and enforces role-based access control for API endpoints.

## Configuration

Authentication is configured through environment variables:

```
# Authentication Configuration
AUTH_ENABLED=true
KEYCLOAK_JWKS_URI=http://localhost:8080/auth/realms/master/protocol/openid-connect/certs
KEYCLOAK_ISSUER=http://localhost:8080/auth/realms/master
KEYCLOAK_CLIENT_ID=telemetry-client
REQUIRED_ROLE=telemetry-user
REQUIRED_SCOPE=telemetry-api
```

- `AUTH_ENABLED`: Set to `false` to disable authentication (for development/testing only)
- `KEYCLOAK_JWKS_URI`: URI to the Keycloak JSON Web Key Set (JWKS)
- `KEYCLOAK_ISSUER`: The issuer URI for your Keycloak realm
- `KEYCLOAK_CLIENT_ID`: The client ID registered in Keycloak
- `REQUIRED_ROLE`: (Optional) Role required to access protected resources
- `REQUIRED_SCOPE`: (Optional) Scope required to access protected resources

## Keycloak Setup

1. **Create a Realm**
   - Log in to the Keycloak Admin Console
   - Create a new realm (e.g., `telemetry`)

2. **Create a Client**
   - Go to "Clients" and click "Create"
   - Set the Client ID to `telemetry-client`
   - Enable "Authorization Enabled"
   - Set "Access Type" to "confidential"
   - Add Valid Redirect URIs (e.g., `http://localhost:3000/*`)
   - Save the client

3. **Create Roles**
   - Go to "Roles" and click "Add Role"
   - Create a role named `telemetry-user`
   - (Optional) Create additional roles like `telemetry-admin`

4. **Create Users**
   - Go to "Users" and create new users
   - Set passwords in the "Credentials" tab
   - Assign roles in the "Role Mappings" tab

## Authentication Flow

1. **Client Authentication**
   - The client (frontend application) authenticates with Keycloak
   - Keycloak issues a JWT token to the client

2. **API Requests**
   - The client includes the JWT token in the Authorization header
   - Format: `Authorization: Bearer <token>`

3. **Token Verification**
   - The service verifies the token using Keycloak's public key
   - Checks token expiration, signature, issuer, and audience

4. **Authorization**
   - The service checks the required role and scope in the token
   - Access is granted if the user has appropriate permissions

## Testing Authentication

You can test the authentication using curl:

```bash
# Obtain a token from Keycloak
TOKEN=$(curl -X POST \
  "http://localhost:8080/auth/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=telemetry-client" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "grant_type=password" \
  -d "username=testuser" \
  -d "password=testpassword" \
  | jq -r '.access_token')

# Use the token to access the API
curl -X GET "http://localhost:4000/api/users" \
  -H "Authorization: Bearer $TOKEN"
```

## Error Responses

Authentication errors return appropriate HTTP status codes and error messages:

- **401 Unauthorized**: Missing or invalid token
  ```json
  {
    "error": {
      "message": "Access denied. No token provided.",
      "code": "NO_TOKEN"
    }
  }
  ```

- **401 Unauthorized**: Expired token
  ```json
  {
    "error": {
      "message": "Token expired",
      "code": "TOKEN_EXPIRED"
    }
  }
  ```

- **403 Forbidden**: Insufficient permissions
  ```json
  {
    "error": {
      "message": "Access denied. Required role: telemetry-user",
      "code": "INSUFFICIENT_ROLE"
    }
  }
  ```

## Bypassing Authentication (Development Only)

For development or testing purposes, you can disable authentication by setting:

```
AUTH_ENABLED=false
```

**Note**: Never disable authentication in production environments.