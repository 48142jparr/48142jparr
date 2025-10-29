// Import the Express framework for creating a web server
const express = require("express"); // Express is used to create the HTTP server and define API routes
// Import the modular OAuth helper functions from gotoAuth.js
const { getAuthUrl, getToken } = require("./gotoAuth"); // Helper functions for OAuth flow
// Import Axios for making HTTP requests
const axios = require("axios"); // Used for proxying API requests to GoTo APIs
// Serve static files (including UReport.html) from the current directory
const path = require('path'); // Node.js path module for file paths
const fs = require('fs'); // Node.js file system module for reading/writing files
require('dotenv').config(); // Load environment variables from .env file

// Define the OAuth scope required for the token (change as needed)
const SCOPE = "cr.v1.read voicemail.v1.voicemails.read"; // Request both scopes for OAuth

// Create an Express application instance
const app = express(); // Main Express app
// Variable to store the expected OAuth state for CSRF protection
let expectedState = null; // Used to validate OAuth callback
// Store the latest access token in memory (for demo; use persistent storage in production)
let latestAccessToken = null; // Most recent access token
let latestRefreshToken = null; // Most recent refresh token

// --- Token persistence helpers ---
// Path to tokens.json file - this file is created automatically when OAuth authentication completes
// The file stores access and refresh tokens so they persist between server restarts
// Without this file, users would need to re-authenticate every time the server restarts
const TOKEN_FILE = path.join(__dirname, 'tokens.json'); // Location of token file

// Save tokens to disk for persistence between server restarts
// This function is called after successful OAuth authentication
// Creates tokens.json file with access and refresh tokens in JSON format
function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2)); // Write tokens to disk
}
// Load tokens from disk if available on server startup
// Checks if tokens.json exists and loads saved tokens into memory
// If file doesn't exist or is corrupted, returns empty object (no tokens)
// This allows the server to use previously saved tokens without re-authentication
function loadTokens() {
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(TOKEN_FILE)); // Read and parse token file
    } catch (e) { return {}; } // If error, return empty object
  }
  return {}; // If file doesn't exist, return empty object
}
// Load tokens into memory on startup - restores previous authentication state
// If tokens.json exists from previous session, loads them automatically
// If no tokens.json file exists, variables remain null (requiring new authentication)
({ accessToken: latestAccessToken, refreshToken: latestRefreshToken } = loadTokens()); // Restore tokens

// Serve static files (including UReport.html) from the current directory
app.use(express.static(path.join(__dirname))); // Serve HTML, JS, CSS, etc.

// Route to start the OAuth flow and display the authorization link
app.get("/auth", (req, res) => {
  // Generate the authorization URL and state
  const { url, state } = getAuthUrl(SCOPE); // Get OAuth URL and state
  // Store the state for later validation
  expectedState = state; // Save state for CSRF protection
  // Send an HTML link to the user for authorization
  res.send(`<a href="${url}">Authorize with GoTo</a>`); // Show link to user
  // Log the authorization URL to the terminal
  console.log("Open this URL in your browser to authorize:", url); // Log for user
});

/**
 * OAuth Flow Documentation
 *
 * When you run `node getTokenServer.js`, you will be presented with two important URLs:
 *
 * 1. Local OAuth Start URL (e.g., http://localhost:5000/auth)
 *    - Purpose: This is a route on your local Express server that starts the OAuth flow.
 *    - Requirement: You must visit this URL in your browser first. It triggers your backend to generate the correct GoTo OAuth authorization URL with all required parameters (client ID, scopes, redirect URI, etc.).
 *    - Importance: This step ensures your OAuth request is properly constructed and securely initiated from your backend.
 *
 * 2. GoTo Authorization URL (displayed as a hyperlink in your browser and logged in the terminal)
 *    - Purpose: This is the actual GoTo OAuth authorization link. You use it to authenticate and authorize your app with GoTo.
 *    - Requirement: After visiting the local URL, click the "Authorize with GoTo" link or copy the URL from your terminal and open it in your browser.
 *    - Importance: This step is required to log in, grant permissions, and obtain an authorization code. Your backend then exchanges this code for an access token, which is needed for authenticated API requests.
 *
 * Summary:
 * - The first URL (`/auth`) starts the OAuth process locally.
 * - The second URL (GoTo authorization link) completes the OAuth login and permission grant.
 * - Both are required for secure, successful authentication and API access.
 */

// Route to get the latest access token (for UI auto-population)
app.get('/api/latest-access-token', (req, res) => {
  if (latestAccessToken) {
    res.json({ accessToken: latestAccessToken }); // Return token if available
  } else {
    res.status(404).json({ error: 'No access token available' }); // Error if not
  }
});

// Route to handle the OAuth redirect and exchange code for token
app.get("/login/oauth2/code/goto", async (req, res) => {
  // Validate the state to prevent CSRF attacks
  if (req.query.state !== expectedState) {
    res.status(403).send("Invalid state"); // State mismatch error
    return;
  }
  try {
    // Exchange the authorization code for an access token
    const token = await getToken(req.query.code, SCOPE); // Get token from code
    // Store tokens in memory for immediate use by the proxy endpoint
    latestAccessToken = token.access_token; // Store for proxy use
    latestRefreshToken = token.refresh_token; // Store refresh token
    // IMPORTANT: This line creates the tokens.json file automatically
    // The file is written to disk so tokens persist between server restarts
    // Without this file, users would need to re-authenticate every time
    saveTokens({ accessToken: latestAccessToken, refreshToken: latestRefreshToken }); // Persist tokens
    // Inform the user that the token was received
    res.send("Access token received. Check your terminal."); // Notify user
    // Print the access token to the terminal
    console.log("Access Token:", token.access_token); // Log token
    // Optionally, print refresh_token and expiry
    if (token.refresh_token) console.log("Refresh Token:", token.refresh_token); // Log refresh token
    if (token.expires_in) console.log("Expires in (seconds):", token.expires_in); // Log expiry
  } catch (err) {
    // Handle errors and inform the user
    res.status(500).send(err.message); // Error response
  }
});

// Endpoint to serve env vars for frontend prepopulation
app.get('/api/env-vars', (req, res) => {
  res.json({
    organizationalId: process.env.ORGANIZATIONALID || '', // Organization ID from .env
    extensionId: process.env.ExtensionID || '' // Extension ID from .env
  });
});

// Proxy endpoint for UReport.html to call
app.get('/api/user-activity', async (req, res) => {
  // Use accessToken from query if provided, otherwise fallback to latestAccessToken
  const accessToken = req.query.accessToken || latestAccessToken; // Get token
  if (!accessToken) {
    return res.status(401).json({ error: 'No access token. Please authenticate first.' }); // Error if missing
  }
  // Only forward the required params in the curl format
  const { accessToken: _discard, startTime, endTime, organizationId, page, pageSize, q, userIds, sort } = req.query; // Extract params
  // Build params for GoTo API
  const gotoParams = { startTime, endTime, organizationId }; // Required params
  if (page !== undefined) gotoParams.page = page; // Optional params
  if (pageSize !== undefined) gotoParams.pageSize = pageSize;
  if (q !== undefined) gotoParams.q = q;
  if (userIds !== undefined) gotoParams.userIds = userIds;
  if (sort !== undefined) gotoParams.sort = sort;
  const gotoUrl = 'https://api.goto.com/call-reports/v1/reports/user-activity'; // GoTo API endpoint
  try {
    // Debug: Log outgoing request params and token
    console.log('Proxying to GoTo API:', gotoUrl); // Log URL
    console.log('Params:', gotoParams); // Log params
    console.log('Authorization:', accessToken.slice(0, 20) + '...'); // Log token
    // Make request to GoTo API
    const response = await axios.get(gotoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }, // Auth header
      params: gotoParams // Query params
    });
    // Debug: Log GoTo API response
    console.log('GoTo API response:', JSON.stringify(response.data).slice(0, 500)); // Log response
    // Return API response to frontend
    res.json(response.data); // Send data to UI
  } catch (error) {
    // Log error and return error details to frontend
    console.error('GoTo API error:', error.message, error.response?.data); // Log error
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data }); // Error response
  }
});

// Proxy endpoint for Voicemail API
app.get('/api/voicemails', async (req, res) => {
  // Use accessToken from query if provided, otherwise fallback to latestAccessToken
  const accessToken = req.query.accessToken || latestAccessToken; // Get token
  const { organizationId, accountKey, extensionNumber, pageMarker, pageSize } = req.query; // Extract params
  // Validate organizationId
  if (!organizationId) {
    return res.status(400).json({ error: 'Missing required parameter: organizationId' });
  }
  // Build params for GoTo Voicemail API
  const voicemailParams = { organizationId };
  if (accountKey) voicemailParams.accountKey = accountKey; // Optional param
  if (extensionNumber) voicemailParams.extensionNumber = extensionNumber; // Optional param
  if (pageMarker) voicemailParams.pageMarker = pageMarker; // Optional param
  if (pageSize) voicemailParams.pageSize = pageSize; // Optional param
  const voicemailUrl = 'https://api.goto.com/voicemail/v1/voicemailboxes'; // GoTo Voicemail API endpoint
  try {
    // Debug: Log outgoing request params and token
    console.log('Proxying to GoTo Voicemail API:', voicemailUrl); // Log URL
    console.log('Params:', voicemailParams); // Log params
    console.log('Authorization:', accessToken.slice(0, 20) + '...'); // Log token
    // Make request to GoTo Voicemail API
    const response = await axios.get(voicemailUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }, // Auth header
      params: voicemailParams // Query params
    });
    // Debug: Log GoTo Voicemail API response
    console.log('GoTo Voicemail API response:', JSON.stringify(response.data).slice(0, 500)); // Log response
    // Return API response to frontend
    res.json(response.data); // Send data to UI
  } catch (error) {
    // Log error and return error details to frontend
    console.error('GoTo Voicemail API error:', error.message, error.response?.data); // Log error
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data }); // Error response
  }
});

// Proxy endpoint for Voicemail Messages API
app.get('/api/voicemail-messages', async (req, res) => {
  const accessToken = req.query.accessToken || latestAccessToken; // Get token
  const voicemailboxId = req.query.voicemailboxId; // Get voicemailbox ID
  console.log('[DEBUG] /api/voicemail-messages called with voicemailboxId:', voicemailboxId); // Log ID
  if (!accessToken) {
    return res.status(401).json({ error: 'No access token. Please authenticate first.' }); // Error if missing
  }
  if (!voicemailboxId) {
    return res.status(400).json({ error: 'Missing voicemailboxId parameter.' }); // Error if missing
  }
  // Optional query params for filtering
  const { page, pageSize, status, sort } = req.query; // Extract params
  const params = {};
  if (page !== undefined) params.page = page; // Optional param
  if (pageSize !== undefined) params.pageSize = pageSize; // Optional param
  if (status !== undefined) params.status = status; // Optional param
  if (sort !== undefined) params.sort = sort; // Optional param
  const url = `https://api.goto.com/voicemail/v1/voicemailboxes/${voicemailboxId}/voicemails`; // GoTo Voicemail Messages API endpoint
  console.log('[DEBUG] Proxying request to:', url); // Log URL
  try {
    console.log('Proxying to GoTo Voicemail Messages API:', url); // Log URL
    console.log('Params:', params); // Log params
    console.log('Authorization:', accessToken.slice(0, 20) + '...'); // Log token
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` }, // Auth header
      params // Query params
    });
    console.log('GoTo Voicemail Messages API response:', JSON.stringify(response.data).slice(0, 500)); // Log response
    res.json(response.data); // Send data to UI
  } catch (error) {
    console.error('GoTo Voicemail Messages API error:', error.message, error.response?.data); // Log error
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data }); // Error response
  }
});

// Endpoint to get valid extensions with accountKeys
app.get('/api/extensions-list', async (req, res) => {
  const accessToken = req.query.accessToken || latestAccessToken;
  const organizationId = req.query.organizationId || process.env.ORGANIZATIONALID;
  if (!accessToken || !organizationId) {
    return res.status(400).json({ error: 'Missing access token or organization ID.' });
  }
  try {
    const response = await axios.get('https://api.goto.com/voicemail/v1/voicemailboxes', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { organizationId, pageSize: 100 }
    });
    const voicemailboxes = response.data.items || [];
    const validExtensions = [];
    for (const box of voicemailboxes) {
      try {
        const msgResp = await axios.get(`https://api.goto.com/voicemail/v1/voicemailboxes/${box.voicemailboxId}/voicemails`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { pageSize: 1 }
        });
        const message = (msgResp.data.items || [])[0];
        if (message && message.accountKey) {
          validExtensions.push({
            extensionNumber: box.extensionNumber,
            voicemailboxId: box.voicemailboxId,
            accountKey: message.accountKey,
            extensionName: box.extensionName || box.name || ''
          });
        }
      } catch (err) {
        // Ignore errors for individual boxes
      }
    }
    res.json({ extensions: validExtensions });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data });
  }
});

// Start the Express server on port 5000
app.listen(5000, () => {
  // Log the startup message and OAuth start URL
  console.log("Visit http://localhost:5000/auth to start the OAuth flow."); // Startup log
});