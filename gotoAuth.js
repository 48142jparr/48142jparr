/**
 * gotoAuth.js
 *
 * This module provides helper functions for handling OAuth 2.0 authentication with GoTo APIs.
 * It generates authorization URLs for user login/consent and exchanges authorization codes for access tokens.
 *
 * Main Functions:
 * - getAuthUrl(scope): Generates the OAuth authorization URL and CSRF state for user login.
 * - getToken(authCode, scope): Exchanges an authorization code for an access token and refresh token.
 *
 * Usage:
 * This module is used by backend files such as Extensions.js and getTokenServer.js to manage authentication flows.
 * It is not used directly by any frontend code.
 *
 * Dependencies:
 * - simple-oauth2: For OAuth 2.0 logic
 * - crypto: For secure random state generation
 * - dotenv: For loading environment variables
 */

// Load environment variables from .env file
require("dotenv").config(); // Loads .env file into process.env
// Import AuthorizationCode class from simple-oauth2 for OAuth 2.0 flows
const { AuthorizationCode } = require("simple-oauth2"); // Handles OAuth 2.0 logic
// Import Node.js crypto module for secure random string generation
const crypto = require("crypto"); // Used for generating random state

const OAUTH_HOST = 'https://authentication.logmeininc.com/oauth';
// OAuth client configuration using environment variables
const oauthConfig = {
  client: {
    // OAuth client ID from environment
    id: process.env.OAUTH_CLIENT_ID, // Client ID for OAuth
    // OAuth client secret from environment
    secret: process.env.OAUTH_CLIENT_SECRET // Client secret for OAuth
  },
  auth: {
    // OAuth token host URL from environment
    tokenHost: OAUTH_HOST // OAuth server base URL
  }
};

// Create an OAuth client instance
const oauthClient = new AuthorizationCode(oauthConfig); // Main OAuth client

// Generate a random state string for CSRF protection
function generateState() {
  return crypto.randomBytes(15).toString('hex'); // 30-char random hex string
}

// Generate the OAuth authorization URL for user login/consent
function getAuthUrl(scope) {
  // Generate a random state for this auth request
  const state = generateState(); // CSRF protection
  // Build the authorization URL with redirect URI, scope, and state
  const url = oauthClient.authorizeURL({
    redirect_uri: process.env.OAUTH_REDIRECT_URI, // Where to redirect after login
    scope, // Requested scopes
    state // CSRF state
  });
  // Return both the URL and the state
  return { url, state }; // Used by server to start OAuth flow
}

// Exchange an authorization code for an access token
async function getToken(authCode, scope) {
  // Prepare token request parameters
  const tokenParams = {
    code: authCode, // Code received from OAuth server
    redirect_uri: process.env.OAUTH_REDIRECT_URI, // Must match registered URI
    scope // Requested scopes
  };
  try {
    // Request the access token from the OAuth server
    const tokenResponse = await oauthClient.getToken(tokenParams); // Exchange code for token
    // Only expect: access_token, refresh_token, expires_in, scope, principal in token response
    // Remove any logic for deprecated fields
    // Return the token object
    return tokenResponse.token; // Contains access_token, refresh_token, etc.
  } catch (error) {
    // Throw an error if token retrieval fails
    throw new Error('Access Token Error: ' + error.message); // Error handling
  }
}

// Export the main functions for use in other modules
module.exports = { getAuthUrl, getToken }; // Used by getTokenServer.js
