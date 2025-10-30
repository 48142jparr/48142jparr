// Load environment variables from .env file
require("dotenv").config();
// Import AuthorizationCode class from simple-oauth2 for OAuth 2.0 flows
const { AuthorizationCode } = require("simple-oauth2");
// Import Node.js crypto module for secure random string generation
const crypto = require("crypto");

// OAuth client configuration using environment variables
const oauthConfig = {
  client: {
    // OAuth client ID from environment
    id: process.env.OAUTH_CLIENT_ID,
    // OAuth client secret from environment
    secret: process.env.OAUTH_CLIENT_SECRET
  },
  auth: {
    // OAuth token host URL from environment
    tokenHost: process.env.OAUTH_SERVICE_URL
  }
};

// Create an OAuth client instance
const oauthClient = new AuthorizationCode(oauthConfig);

// Generate a random state string for CSRF protection
function generateState() {
  return crypto.randomBytes(15).toString('hex');
}

// Generate the OAuth authorization URL for user login/consent
function getAuthUrl(scope) {
  // Generate a random state for this auth request
  const state = generateState();
  // Build the authorization URL with redirect URI, scope, and state
  const url = oauthClient.authorizeURL({
    redirect_uri: process.env.OAUTH_REDIRECT_URI,
    scope,
    state
  });
  // Return both the URL and the state
  return { url, state };
}

// Exchange an authorization code for an access token
async function getToken(authCode, scope) {
  // Prepare token request parameters
  const tokenParams = {
    code: authCode,
    redirect_uri: process.env.OAUTH_REDIRECT_URI,
    scope
  };
  try {
    // Request the access token from the OAuth server
    const tokenResponse = await oauthClient.getToken(tokenParams);
    // Return the token object
    return tokenResponse.token;
  } catch (error) {
    // Throw an error if token retrieval fails
    throw new Error('Access Token Error: ' + error.message);
  }
}

// Export the main functions for use in other modules
module.exports = { getAuthUrl, getToken };
