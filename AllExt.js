// AllExt.js
// Standalone Node.js server to fetch all extensions with valid accountKeys using GoTo APIs and OAuth
// Usage: node AllExt.js

const express = require("express");
const { getAuthUrl, getToken } = require("./gotoAuth");
const axios = require("axios");
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const SCOPE = "cr.v1.read voicemail.v1.voicemails.read";
const app = express();
let expectedState = null;
let latestAccessToken = null;
let latestRefreshToken = null;
let tokenExpiry = null; // Track token expiry time
const TOKEN_FILE = path.join(__dirname, 'tokens.json');

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  if (tokens.expires_in) {
    tokenExpiry = Date.now() + tokens.expires_in * 1000;
  }
}
function loadTokens() {
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE));
      if (data.expires_in && data.accessToken) {
        tokenExpiry = Date.now() + data.expires_in * 1000;
      }
      return data;
    } catch (e) { return {}; }
  }
  return {};
}
({ accessToken: latestAccessToken, refreshToken: latestRefreshToken } = loadTokens());

app.use(express.static(path.join(__dirname)));

app.get("/auth", (req, res) => {
  const { url, state } = getAuthUrl(SCOPE);
  expectedState = state;
  res.send(`<a href="${url}">Authorize with GoTo</a>`);
  console.log("Open this URL in your browser to authorize:", url);
});

app.get('/api/latest-access-token', (req, res) => {
  if (latestAccessToken) {
    res.json({ accessToken: latestAccessToken });
  } else {
    res.status(404).json({ error: 'No access token available' });
  }
});

app.get("/login/oauth2/code/goto", async (req, res) => {
  if (req.query.state !== expectedState) {
    res.status(403).send("Invalid state");
    return;
  }
  try {
    const token = await getToken(req.query.code, SCOPE);
    latestAccessToken = token.access_token;
    latestRefreshToken = token.refresh_token;
    saveTokens({ accessToken: latestAccessToken, refreshToken: latestRefreshToken });
    res.send("Access token received. Check your terminal.");
    console.log("Access Token:", token.access_token);
    if (token.refresh_token) console.log("Refresh Token:", token.refresh_token);
    if (token.expires_in) console.log("Expires in (seconds):", token.expires_in);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/env-vars', (req, res) => {
  res.json({
    organizationalId: process.env.ORGANIZATIONALID || '',
    extensionId: process.env.ExtensionID || ''
  });
});

// Endpoint to fetch all extensions with valid accountKeys
app.get('/api/extensions-list', async (req, res) => {
  let accessToken = req.query.accessToken || latestAccessToken;
  const organizationId = req.query.organizationId || process.env.ORGANIZATIONALID;
  accessToken = await getValidAccessToken();
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
            extensionName: box.extensionName || message.extensionName || ''
          });
        }
      } catch (err) {
        // Ignore errors for individual boxes
      }
    }
    console.log('[DEBUG] Extensions fetched (with valid accountKey):', validExtensions.map(e => e.extensionNumber).join(', '));
    res.json({ extensions: validExtensions });
  } catch (error) {
    console.error('[DEBUG] Error fetching extensions:', error.message, error.response?.data);
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data });
  }
});

async function refreshAccessToken() {
  if (!latestRefreshToken) return null;
  try {
    const simpleOauth2 = require('simple-oauth2');
    const oauthConfig = {
      client: {
        id: process.env.OAUTH_CLIENT_ID,
        secret: process.env.OAUTH_CLIENT_SECRET
      },
      auth: {
        tokenHost: process.env.OAUTH_SERVICE_URL
      }
    };
    const client = new simpleOauth2.AuthorizationCode(oauthConfig);
    const tokenObj = client.createToken({ refresh_token: latestRefreshToken });
    const params = { scope: SCOPE };
    const refreshed = await tokenObj.refresh(params);
    latestAccessToken = refreshed.token.access_token;
    latestRefreshToken = refreshed.token.refresh_token;
    tokenExpiry = Date.now() + refreshed.token.expires_in * 1000;
    saveTokens({ accessToken: latestAccessToken, refreshToken: latestRefreshToken, expires_in: refreshed.token.expires_in });
    console.log('[DEBUG] Access token expired, using refresh token to obtain a new access token.');
    return latestAccessToken;
  } catch (err) {
    console.error('[DEBUG] Failed to refresh access token:', err.message);
    return null;
  }
}

async function getValidAccessToken() {
  if (!latestAccessToken) return null;
  if (tokenExpiry && Date.now() > tokenExpiry - 60000) { // Refresh 1 min before expiry
    console.log('[DEBUG] Access token is expired or about to expire. Attempting refresh...');
    return await refreshAccessToken();
  }
  console.log('[DEBUG] Access token is valid, using existing token.');
  return latestAccessToken;
}

// Start the Express server on port 5000
app.listen(5000, () => {
  console.log("Visit http://localhost:5000/auth to start the OAuth flow.");
});
