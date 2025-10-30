// Import the Express framework for creating a web server
const express = require("express");
// Import the modular OAuth helper functions from gotoAuth.js
const { getAuthUrl, getToken } = require("./gotoAuth");
// Import Axios for making HTTP requests
const axios = require("axios");
// Serve static files (including UReport.html) from the current directory
const path = require('path');
const fs = require('fs');

// Define the OAuth scope required for the token (change as needed)
const SCOPE = "cr.v1.read"; // Change to your required scope

// Create an Express application instance
const app = express();
// Variable to store the expected OAuth state for CSRF protection
let expectedState = null;
// Store the latest access token in memory (for demo; use persistent storage in production)
let latestAccessToken = null;
let latestRefreshToken = null;

// --- Token persistence helpers ---
// Path to tokens.json file - this file is created automatically when OAuth authentication completes
// The file stores access and refresh tokens so they persist between server restarts
// Without this file, users would need to re-authenticate every time the server restarts
const TOKEN_FILE = path.join(__dirname, 'tokens.json');

// Save tokens to disk for persistence between server restarts
// This function is called after successful OAuth authentication
// Creates tokens.json file with access and refresh tokens in JSON format
function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}
// Load tokens from disk if available on server startup
// Checks if tokens.json exists and loads saved tokens into memory
// If file doesn't exist or is corrupted, returns empty object (no tokens)
// This allows the server to use previously saved tokens without re-authentication
function loadTokens() {
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(TOKEN_FILE));
    } catch (e) { return {}; }
  }
  return {};
}
// Load tokens into memory on startup - restores previous authentication state
// If tokens.json exists from previous session, loads them automatically
// If no tokens.json file exists, variables remain null (requiring new authentication)
({ accessToken: latestAccessToken, refreshToken: latestRefreshToken } = loadTokens());

// Serve static files (including UReport.html) from the current directory
app.use(express.static(path.join(__dirname)));

// Route to start the OAuth flow and display the authorization link
app.get("/auth", (req, res) => {
  // Generate the authorization URL and state
  const { url, state } = getAuthUrl(SCOPE);
  // Store the state for later validation
  expectedState = state;
  // Send an HTML link to the user for authorization
  res.send(`<a href="${url}">Authorize with GoTo</a>`);
  // Log the authorization URL to the terminal
  console.log("Open this URL in your browser to authorize:", url);
});

// Route to get the latest access token (for UI auto-population)
app.get('/api/latest-access-token', (req, res) => {
  if (latestAccessToken) {
    res.json({ accessToken: latestAccessToken });
  } else {
    res.status(404).json({ error: 'No access token available' });
  }
});

// Route to handle the OAuth redirect and exchange code for token
app.get("/login/oauth2/code/goto", async (req, res) => {
  // Validate the state to prevent CSRF attacks
  if (req.query.state !== expectedState) {
    res.status(403).send("Invalid state");
    return;
  }
  try {
    // Exchange the authorization code for an access token
    const token = await getToken(req.query.code, SCOPE);
    // Store tokens in memory for immediate use by the proxy endpoint
    latestAccessToken = token.access_token; // Store for proxy use
    latestRefreshToken = token.refresh_token;
    // IMPORTANT: This line creates the tokens.json file automatically
    // The file is written to disk so tokens persist between server restarts
    // Without this file, users would need to re-authenticate every time
    saveTokens({ accessToken: latestAccessToken, refreshToken: latestRefreshToken });
    // Inform the user that the token was received
    res.send("Access token received. Check your terminal.");
    // Print the access token to the terminal
    console.log("Access Token:", token.access_token);
    // Optionally, print refresh_token and expiry
    if (token.refresh_token) console.log("Refresh Token:", token.refresh_token);
    if (token.expires_in) console.log("Expires in (seconds):", token.expires_in);
  } catch (err) {
    // Handle errors and inform the user
    res.status(500).send(err.message);
  }
});

// Proxy endpoint for UReport.html to call
app.get('/api/user-activity', async (req, res) => {
  // Use accessToken from query if provided, otherwise fallback to latestAccessToken
  const accessToken = req.query.accessToken || latestAccessToken;
  if (!accessToken) {
    return res.status(401).json({ error: 'No access token. Please authenticate first.' });
  }
  // Only forward the required params in the curl format
  const { accessToken: _discard, startTime, endTime, organizationId, page, pageSize, q, userIds, sort } = req.query;
  // Build params for GoTo API
  const gotoParams = { startTime, endTime, organizationId };
  if (page !== undefined) gotoParams.page = page;
  if (pageSize !== undefined) gotoParams.pageSize = pageSize;
  if (q !== undefined) gotoParams.q = q;
  if (userIds !== undefined) gotoParams.userIds = userIds;
  if (sort !== undefined) gotoParams.sort = sort;
  const gotoUrl = 'https://api.goto.com/call-reports/v1/reports/user-activity';
  try {
    // Debug: Log outgoing request params and token
    console.log('Proxying to GoTo API:', gotoUrl);
    console.log('Params:', gotoParams);
    console.log('Authorization:', accessToken.slice(0, 20) + '...');
    // Make request to GoTo API
    const response = await axios.get(gotoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: gotoParams
    });
    // Debug: Log GoTo API response
    console.log('GoTo API response:', JSON.stringify(response.data).slice(0, 500));
    // Return API response to frontend
    res.json(response.data);
  } catch (error) {
    // Log error and return error details to frontend
    console.error('GoTo API error:', error.message, error.response?.data);
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data });
  }
});

// Start the Express server on port 5000
app.listen(5000, () => {
  // Log the startup message and OAuth start URL
  console.log("Visit http://localhost:5000/auth to start the OAuth flow.");
});