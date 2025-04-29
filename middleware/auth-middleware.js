/**
 * Authentication Middleware for Keycloak Token Verification
 */

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const logger = require('../logger');

// Initialize JWKS client (JSON Web Key Set)
const jwksClientInstance = jwksClient({
  jwksUri: process.env.KEYCLOAK_JWKS_URI || 'http://localhost:8080/auth/realms/master/protocol/openid-connect/certs',
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 5,
  requestHeaders: {}, // Optional
  timeout: 30000 // 30 seconds
});

/**
 * Get signing key from Keycloak
 */
function getSigningKey(header, callback) {
  jwksClientInstance.getSigningKey(header.kid, (err, key) => {
    if (err) {
      logger.error(`Error getting signing key: ${err.message}`);
      return callback(err);
    }
    
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

/**
 * Verify JWT token from Authorization header
 */
function verifyToken(req, res, next) {
  // Skip authentication if disabled
  if (process.env.AUTH_ENABLED === 'false') {
    return next();
  }

  // Get auth header
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    logger.warn('Missing authorization header');
    return res.status(401).json({
      error: {
        message: 'Access denied. No token provided.',
        code: 'NO_TOKEN'
      }
    });
  }
  
  // Check Bearer token format
  const tokenParts = authHeader.split(' ');
  if (tokenParts.length !== 2 || tokenParts[0] !== 'Bearer') {
    logger.warn('Invalid token format');
    return res.status(401).json({
      error: {
        message: 'Invalid token format. Use Bearer {token}',
        code: 'INVALID_TOKEN_FORMAT'
      }
    });
  }
  
  const token = tokenParts[1];
  
  // Decode token without verification to get the header with kid
  let decodedToken;
  try {
    decodedToken = jwt.decode(token, { complete: true });
    if (!decodedToken || !decodedToken.header || !decodedToken.header.kid) {
      logger.warn('Invalid token structure');
      return res.status(401).json({
        error: {
          message: 'Invalid token structure',
          code: 'INVALID_TOKEN'
        }
      });
    }
  } catch (err) {
    logger.error(`Error decoding token: ${err.message}`);
    return res.status(401).json({
      error: {
        message: 'Invalid token',
        code: 'INVALID_TOKEN'
      }
    });
  }
  
  // Get the signing key matching the KID from the token header
  getSigningKey(decodedToken.header, (err, signingKey) => {
    if (err) {
      logger.error(`Error getting signing key: ${err.message}`);
      return res.status(500).json({
        error: {
          message: 'Error validating token',
          code: 'TOKEN_VALIDATION_ERROR'
        }
      });
    }
    
    // Verify the token with the correct signing key
    jwt.verify(token, signingKey, {
      algorithms: ['RS256'],
      audience: process.env.KEYCLOAK_CLIENT_ID || 'telemetry-client',
      issuer: process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/auth/realms/master'
    }, (err, decoded) => {
      if (err) {
        let message = 'Invalid token';
        let code = 'INVALID_TOKEN';
        
        if (err.name === 'TokenExpiredError') {
          message = 'Token expired';
          code = 'TOKEN_EXPIRED';
        } else if (err.name === 'JsonWebTokenError') {
          message = `JWT Error: ${err.message}`;
          code = 'JWT_ERROR';
        }
        
        logger.warn(`Token verification failed: ${err.message}`);
        return res.status(401).json({
          error: {
            message,
            code
          }
        });
      }
      
      // Add the decoded token to the request
      req.user = decoded;
      
      // Check required scopes if configured
      if (process.env.REQUIRED_SCOPE) {
        const requiredScope = process.env.REQUIRED_SCOPE;
        const scopes = decoded.scope ? decoded.scope.split(' ') : [];
        
        if (!scopes.includes(requiredScope)) {
          logger.warn(`Missing required scope: ${requiredScope}`);
          return res.status(403).json({
            error: {
              message: `Access denied. Required scope: ${requiredScope}`,
              code: 'INSUFFICIENT_SCOPE'
            }
          });
        }
      }
      
      // Check required roles if configured
      if (process.env.REQUIRED_ROLE) {
        const requiredRole = process.env.REQUIRED_ROLE;
        const roles = decoded.realm_access?.roles || [];
        
        if (!roles.includes(requiredRole)) {
          logger.warn(`Missing required role: ${requiredRole}`);
          return res.status(403).json({
            error: {
              message: `Access denied. Required role: ${requiredRole}`,
              code: 'INSUFFICIENT_ROLE'
            }
          });
        }
      }
      
      logger.debug(`Authentication successful for user: ${decoded.preferred_username || decoded.sub}`);
      next();
    });
  });
}

/**
 * Check if user has required role
 */
function hasRole(role) {
  return (req, res, next) => {
    // Skip role check if authentication is disabled
    if (process.env.AUTH_ENABLED === 'false') {
      return next();
    }
    
    if (!req.user) {
      logger.warn('Role check attempted without authenticated user');
      return res.status(401).json({
        error: {
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        }
      });
    }
    
    const roles = req.user.realm_access?.roles || [];
    
    if (!roles.includes(role)) {
      logger.warn(`Access denied: user lacks required role ${role}`);
      return res.status(403).json({
        error: {
          message: `Access denied. Required role: ${role}`,
          code: 'INSUFFICIENT_ROLE'
        }
      });
    }
    
    next();
  };
}

module.exports = {
  verifyToken,
  hasRole
};
