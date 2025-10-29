// napphovol.js
// Minimal server to generate and log a GoTo access token using OAuth

const express = require("express"); // Express for HTTP server
const { getAuthUrl, getToken } = require("./gotoAuth"); // OAuth helpers
const path = require('path'); // For file paths
const fs = require('fs'); // For saving tokens
const axios = require("axios"); // For making API requests
const sqlite3 = require('sqlite3').verbose(); // persist phone numbers
require('dotenv').config(); // Load .env

// Ensure Express app and token helpers are defined
const app = express();
const SCOPE = "voice-admin.v1.read"; // scope used for OAuth and API access
let expectedState = null;
let latestAccessToken = null;
let latestRefreshToken = null;
const TOKEN_FILE = path.join(__dirname, 'tokens.json');

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}
function loadTokens() {
  if (fs.existsSync(TOKEN_FILE)) {
    try { return JSON.parse(fs.readFileSync(TOKEN_FILE)); } catch (e) { return {}; }
  }
  return {};
}
// Load any existing tokens at startup
({ accessToken: latestAccessToken, refreshToken: latestRefreshToken } = loadTokens());
let cachedAccountKey = process.env.ACCOUNTKEY || '';

// Initialize SQLite DB for persistent export of phone numbers
const DB_PATH = path.join(__dirname, 'phone_numbers.db');
const db = new sqlite3.Database(DB_PATH);
// Create table if not exists
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS phone_numbers (
    id TEXT PRIMARY KEY,
    accountKey TEXT,
    organizationId TEXT,
    number TEXT,
    name TEXT,
    callerIdName TEXT,
    status TEXT,
    fetched_at INTEGER
  )`);
  // Add indexes for faster queries and optional dedupe helpers
  db.run(`CREATE INDEX IF NOT EXISTS idx_phone_account ON phone_numbers(accountKey)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_phone_number ON phone_numbers(number)`);
});

// Helper to persist numbers to sqlite
function saveNumbersToDb(numbers, accountKey) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(numbers)) return resolve({ inserted: 0 });
    const ts = Date.now();
    db.serialize(() => {
      const stmt = db.prepare(`INSERT OR REPLACE INTO phone_numbers (id, accountKey, organizationId, number, name, callerIdName, status, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      let inserted = 0;
      for (const n of numbers) {
        try {
          stmt.run(n.id, accountKey || n.accountKey || null, n.organizationId || null, n.number || null, n.name || null, n.callerIdName || (n.callerId && n.callerId.name) || null, n.status || null, ts);
          inserted++;
        } catch (e) {
          console.error('DB insert error for', n.id, e && e.message);
        }
      }
      stmt.finalize(err => {
        if (err) return reject(err);
        resolve({ inserted });
      });
    });
  });
}

// Fetch numbers for an accountKey and persist to DB
async function fetchAndPersistNumbers(accountKey) {
  if (!accountKey) throw new Error('Missing accountKey');
  const accessToken = latestAccessToken;
  if (!accessToken) throw new Error('No access token');
  const url = `https://api.goto.com/voice-admin/v1/phone-numbers?accountKey=${accountKey}`;
  console.log('Scheduled fetch: calling', url);
  try {
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const numbers = resp.data.items || [];
    console.log(`Scheduled fetch: fetched ${numbers.length} numbers for ${accountKey}`);
    try {
      const dbRes = await saveNumbersToDb(numbers, accountKey);
      console.log(`Scheduled fetch: saved ${dbRes.inserted} numbers to DB for ${accountKey}`);
      return { fetched: numbers.length, saved: dbRes.inserted };
    } catch (dbErr) {
      console.error('Scheduled fetch: DB save error', dbErr && dbErr.message);
      return { fetched: numbers.length, saved: 0, dbError: dbErr.message };
    }
  } catch (err) {
    console.error('Scheduled fetch: API error', err && err.message, err.response?.data);
    throw err;
  }
}

// Setup optional auto-fetch scheduler (controlled by env vars)
(function setupAutoFetch() {
  const enabled = (process.env.AUTO_FETCH_ENABLED || 'false').toLowerCase() === 'true';
  const minutes = parseInt(process.env.AUTO_FETCH_INTERVAL_MINUTES || '60', 10) || 60;
  if (!enabled) return;
  const key = process.env.ACCOUNTKEY || '';
  if (!key) {
    console.warn('AUTO_FETCH_ENABLED is true but ACCOUNTKEY is not set; disabling auto-fetch');
    return;
  }
  // run immediately then schedule
  (async () => {
    try { await fetchAndPersistNumbers(key); } catch (e) { /* logged inside */ }
  })();
  setInterval(() => {
    fetchAndPersistNumbers(key).catch(() => {});
  }, minutes * 60 * 1000);
  console.log(`Auto-fetch enabled: accountKey=${key}, interval=${minutes}min`);
})();

// Helper to decode JWT payload (base64url)
function decodeJwtPayload(token) {
  try {
    if (!token) return null;
    const part = token.split('.')[1] || '';
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch (e) {
    return null;
  }
}

// Serve static frontend files
app.use(express.static(__dirname));

// Start OAuth flow
app.get("/auth", (req, res) => {
  const { url, state } = getAuthUrl(SCOPE);
  expectedState = state;
  res.send(`<a href=\"${url}\">Authorize with GoTo</a>`);
  console.log("Open this URL in your browser to authorize:", url);
});

// OAuth callback to exchange code for token
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

// Helper to get org ID from .env
function getOrgId() {
  return process.env.ORGANIZATIONALID;
}

// Endpoint to fetch and print all phone numbers and caller ID info from GoTo Admin API
app.get("/fetch-all-phone-numbers", async (req, res) => {
  const accessToken = latestAccessToken;
  if (!accessToken) {
    res.status(401).send("No access token. Please authenticate first.");
    return;
  }

  try {
    // Step 1: Get identity via SCIM to find accountKey(s)
    const scimUrl = 'https://api.getgo.com/identity/v1/Users/me';
    console.log('Calling SCIM /me:', scimUrl);
    const meResp = await axios.get(scimUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    // SCIM extension may contain accounts under urn:scim:schemas:extension:getgo:1.0
    const scimExt = meResp.data['urn:scim:schemas:extension:getgo:1.0'] || meResp.data['urn:scim:schemas:extension:getgo:1.0'];
    let accountsArr = scimExt?.accounts || meResp.data.accounts || [];

    if (!accountsArr || accountsArr.length === 0) {
      console.log('No accounts found in SCIM /me response, full payload:', JSON.stringify(meResp.data).slice(0,500));
      res.status(404).send('No accounts found for this user via SCIM /me');
      return;
    }

    // Prefer an accountKey whose entitlements include 'acctadmin'
    let chosen = accountsArr.find(a => Array.isArray(a.entitlements) && a.entitlements.includes('acctadmin')) || accountsArr[0];
    // Always prefer the environment variable ACCOUNTKEY if set; otherwise fall back to SCIM selection
    const envAccountKey = process.env.ACCOUNTKEY || '';
    // Validate envAccountKey is not the same as the JWT subject (user id)
    const decoded = decodeJwtPayload(accessToken || latestAccessToken || '');
    const tokenSub = decoded?.sub || decoded?.id || null;
    if (envAccountKey && tokenSub && envAccountKey === tokenSub) {
      console.log('ACCOUNTKEY env appears to equal JWT subject (user id) - refusing to use it');
      res.status(400).send('Invalid ACCOUNTKEY: equals user id. Remove or set a valid accountKey from SCIM accounts.');
      return;
    }
    const accountKey = envAccountKey || chosen?.value || chosen?.accountKey || chosen?.id;
    if (!accountKey) {
      console.log('Unable to determine accountKey from environment or SCIM /me accounts:', { envAccountKey, accounts: accountsArr });
      res.status(404).send('No accountKey found in environment or SCIM /me accounts');
      return;
    }

    console.log('Selected accountKey:', accountKey, envAccountKey ? '(from env ACCOUNTKEY)' : `from SCIM selection: ${chosen?.display || chosen?.value}`);

    // Step 2: Fetch all phone numbers using accountKey
    const numbersUrl = `https://api.goto.com/voice-admin/v1/phone-numbers?accountKey=${accountKey}`;
    console.log('Calling Voice Admin phone-numbers URL:', numbersUrl);
    const numbersResp = await axios.get(numbersUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const numbers = numbersResp.data.items || [];
    console.log('Fetched phone numbers count:', numbers.length);

    // Persist numbers to sqlite DB (async)
    try {
      const dbResult = await saveNumbersToDb(numbers, accountKey);
      console.log(`Saved ${dbResult.inserted} phone numbers to DB`);
    } catch (e) {
      console.error('Error saving phone numbers to DB', e && e.message);
    }
    // Print and return phone number and caller ID info
    numbers.forEach(num => {
      console.log(`Number: ${num.number}, Caller ID: ${num.callerIdName || num.callerId?.name || 'N/A'}`);
    });

    res.json({ phoneNumbers: numbers, accountKey });
  } catch (error) {
    console.error("Voice Admin API error:", error.message, error.response?.data);
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data });
  }
});

// Endpoint to fetch all phone numbers and caller ID from Voice Admin API, and call volume from Call Reports API
app.get("/phone-numbers-summary", async (req, res) => {
  const accessToken = latestAccessToken;
  if (!accessToken) return res.status(401).send("No access token. Please authenticate first.");

  const overrideAccountKey = req.query.accountKey || process.env.ACCOUNTKEY || '';
  const organizationId = getOrgId();

  try {
    // If explicit accountKey provided (query param or env), prefer that and call voice-admin by accountKey
    if (overrideAccountKey) {
      console.log('/phone-numbers-summary: using override accountKey', overrideAccountKey);
      const numbersUrl = `https://api.goto.com/voice-admin/v1/phone-numbers?accountKey=${overrideAccountKey}`;
      const numbersResp = await axios.get(numbersUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      const numbers = numbersResp.data.items || [];
      // persist in background
      saveNumbersToDb(numbers, overrideAccountKey).catch(e => console.error('DB save error:', e && e.message));
      const simple = (numbers || []).map(n => ({ phoneNumber: n.number || n.phoneNumber, callerId: n.callerIdName || n.callerId?.name || null }));
      return res.json({ source: 'accountKey', accountKey: overrideAccountKey, accountDisplay: null, phoneNumbers: simple });
    }

    // If org id available, try org-based path (may return different account) — prefer explicit selection but org path is useful
    if (organizationId) {
      try {
        const accountsUrl = `https://api.goto.com/voice-admin/v1/organizations/${organizationId}/accounts`;
        console.log('/phone-numbers-summary: attempting org-based accounts lookup', accountsUrl);
        const accountsResp = await axios.get(accountsUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        const accounts = accountsResp.data.accounts || [];
        if (accounts.length > 0) {
          const accountId = accounts[0].id;
          const numbersUrl = `https://api.goto.com/voice-admin/v1/accounts/${accountId}/phone-numbers`;
          const numbersResp = await axios.get(numbersUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
          const numbers = numbersResp.data.phoneNumbers || [];
          const acctDisplay = accounts[0].displayName || accounts[0].name || accounts[0].id || null;
          const simple = (numbers || []).map(n => ({ phoneNumber: n.phoneNumber || n.number, callerId: n.callerId?.name || n.callerIdName || null }));
          return res.json({ source: 'org', accountKey: accountId, accountDisplay: acctDisplay, phoneNumbers: simple });
        }
      } catch (orgErr) {
        console.warn('/phone-numbers-summary org-based path failed, will attempt SCIM fallback:', orgErr.message);
        // fall through to SCIM fallback
      }
    }

    // SCIM fallback: derive accountKey from /identity/v1/Users/me
    const scimUrl = 'https://api.getgo.com/identity/v1/Users/me';
    console.log('SCIM fallback: calling SCIM /me:', scimUrl);
    const meResp = await axios.get(scimUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const scimExt = meResp.data['urn:scim:schemas:extension:getgo:1.0'] || meResp.data['urn:scim:schemas:extension:getgo:1.0'];
    let accountsArr = scimExt?.accounts || meResp.data.accounts || [];
    if (!accountsArr || accountsArr.length === 0) {
      console.log('SCIM /me returned no accounts, payload:', JSON.stringify(meResp.data).slice(0,500));
      return res.status(404).send('No accounts found for this user via SCIM /me');
    }
    // Prefer account with acctadmin entitlement, else first
    const chosen = accountsArr.find(a => Array.isArray(a.entitlements) && a.entitlements.includes('acctadmin')) || accountsArr[0];
    const accountKey = chosen?.value || chosen?.accountKey || chosen?.id;
    const accountDisplay = chosen?.display || chosen?.displayName || null;
    if (!accountKey) {
      console.log('Unable to determine accountKey from SCIM accounts', accountsArr);
      return res.status(404).send('No accountKey found via SCIM accounts');
    }
    // Call voice-admin by accountKey
    const numbersUrl = `https://api.goto.com/voice-admin/v1/phone-numbers?accountKey=${accountKey}`;
    console.log('SCIM fallback: calling Voice Admin phone-numbers URL:', numbersUrl);
    const numbersResp = await axios.get(numbersUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const numbers = numbersResp.data.items || [];
    // Persist numbers async
    saveNumbersToDb(numbers, accountKey).catch(e => console.error('DB save error (phone-numbers-summary fallback):', e && e.message));
    const simple = (numbers || []).map(n => ({ phoneNumber: n.number || n.phoneNumber, callerId: n.callerIdName || n.callerId?.name || null }));
    return res.json({ source: 'scim', accountKey, accountDisplay, phoneNumbers: simple });
  } catch (error) {
    console.error("/phone-numbers-summary error:", error.message, error.response?.data);
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data });
  }
});

// Endpoint to fetch phone number activity with caller/callee info
app.get("/phone-number-activity-calls", async (req, res) => {
  const accessToken = latestAccessToken;
  const organizationId = getOrgId();
  if (!accessToken) {
    res.status(401).send("No access token. Please authenticate first.");
    return;
  }
  if (!organizationId) {
    res.status(400).send("No organization ID set in .env");
    return;
  }
  try {
    // Set date range to 3 years ago till today
    const now = new Date();
    const endTime = now.toISOString();
    const startTime = new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString();
    const url = "https://api.goto.com/call-reports/v1/reports/phone-number-activity";
    let allItems = [];
    let page = 1;
    const pageSize = 100;
    while (true) {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { organizationId, startTime, endTime, page, pageSize }
      });
      const items = response.data.items || [];
      allItems.push(...items);
      if (!response.data.items || items.length < pageSize) break;
      page++;
    }
    // Extract phone number, and any available caller/callee info
    const result = allItems.map(item => ({
      phoneNumber: item.phoneNumber,
      // These fields may or may not be present depending on API version and data
      callerId: item.callerId || null,
      calleeId: item.calleeId || null,
      callCount: item.callCount || null,
      inboundCallCount: item.inboundCallCount || null,
      outboundCallCount: item.outboundCallCount || null
    }));
    // Print and return
    console.log("Phone number activity with caller/callee info:");
    result.forEach(r => console.log(r));
    res.json(result);
  } catch (error) {
    console.error("Call Reports API error:", error.message, error.response?.data);
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data });
  }
});

// Endpoint to print and return the raw data fields from Call Reports API phone number activity endpoint
app.get("/debug-call-reports-fields", async (req, res) => {
  const accessToken = latestAccessToken;
  const organizationId = getOrgId();
  if (!accessToken) {
    res.status(401).send("No access token. Please authenticate first.");
    return;
  }
  if (!organizationId) {
    res.status(400).send("No organization ID set in .env");
    return;
  }
  try {
    // Set date range to 3 years ago till today
    const now = new Date();
    const endTime = now.toISOString();
    const startTime = new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString();
    const url = "https://api.goto.com/call-reports/v1/reports/phone-number-activity";
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { organizationId, startTime, endTime, page: 1, pageSize: 1 }
    });
    const items = response.data.items || [];
    if (items.length > 0) {
      console.log("First call reports item fields:", Object.keys(items[0]));
      res.json({ fields: Object.keys(items[0]), example: items[0] });
    } else {
      res.json({ fields: [], example: null });
    }
  } catch (error) {
    console.error("Call Reports API error:", error.message, error.response?.data);
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data });
  }
});

// Endpoint to generate a phone number activity report and dashboard for the last year
app.get("/phone-number-activity-report", async (req, res) => {
  const accessToken = latestAccessToken;
  const organizationId = getOrgId();
  if (!accessToken) {
    res.status(401).send("No access token. Please authenticate first.");
    return;
  }
  if (!organizationId) {
    res.status(400).send("No organization ID set in .env");
    return;
  }
  try {
    // Get all accounts for the org
    const accountsUrl = `https://api.goto.com/voice-admin/v1/organizations/${organizationId}/accounts`;
    const accountsResp = await axios.get(accountsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const accounts = accountsResp.data.accounts || [];
    if (accounts.length === 0) {
      res.status(404).send("No accounts found for this organization.");
      return;
    }
    const accountId = accounts[0].id;
    // Get all phone numbers for the account
    const numbersUrl = `https://api.goto.com/voice-admin/v1/accounts/${accountId}/phone-numbers`;
    const numbersResp = await axios.get(numbersUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const numbers = numbersResp.data.phoneNumbers || [];
    // Get call activity for all numbers (last year)
    const now = new Date();
    const endTime = now.toISOString();
    const startTime = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const callReportUrl = "https://api.goto.com/call-reports/v1/reports/phone-number-activity";
    let allCallData = [];
    let page = 1;
    const pageSize = 100;
    while (true) {
      const response = await axios.get(callReportUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { organizationId, startTime, endTime, page, pageSize }
      });
      const items = response.data.items || [];
      allCallData.push(...items);
      if (!response.data.items || items.length < pageSize) break;
      page++;
    }
    // Map call activity by phone number
    const callSummaryMap = {};
    allCallData.forEach(item => {
      callSummaryMap[item.phoneNumber] = item;
    });
    // Build report for all phone numbers
    let html = `<html><head><title>Phone Number Activity Report</title><style>body{font-family:sans-serif;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ccc;padding:8px;}th{background:#f0f0f0;}tr:nth-child(even){background:#fafafa;}</style></head><body>`;
    html += `<h1>Phone Number Activity Report (All Numbers)</h1>`;
    html += `<table><tr><th>Name</th><th>Number</th><th>Inbound Calls</th><th>Inbound Duration (s)</th><th>Outbound Calls</th><th>Outbound Duration (s)</th><th>Total Calls</th><th>Total Duration (s)</th></tr>`;
    numbers.forEach(num => {
      const summary = callSummaryMap[num.phoneNumber] || {};
      const dv = summary.dataValues || {};
      html += `<tr>`;
      html += `<td>${num.callerId?.name || num.phoneNumberName || ""}</td>`;
      html += `<td>${num.phoneNumber || ""}</td>`;
      html += `<td>${dv.inboundVolume || 0}</td>`;
      html += `<td>${Math.round((dv.inboundDuration || 0)/1000)}</td>`;
      html += `<td>${dv.outboundVolume || 0}</td>`;
      html += `<td>${Math.round((dv.outboundDuration || 0)/1000)}</td>`;
      html += `<td>${dv.volume || 0}</td>`;
      html += `<td>${Math.round((dv.totalDuration || 0)/1000)}</td>`;
      html += `</tr>`;
    });
    html += `</table></body></html>`;
    res.send(html);
  } catch (error) {
    console.error("Phone Number Activity Report error:", error.message, error.response?.data);
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data });
  }
});

// Dedicated endpoint to check if any call activity data exists for the last year and show the first item
app.get("/call-activity-exists", async (req, res) => {
  const accessToken = latestAccessToken;
  const organizationId = getOrgId();
  if (!accessToken) {
    res.status(401).send("No access token. Please authenticate first.");
    return;
  }
  if (!organizationId) {
    res.status(400).send("No organization ID set in .env");
    return;
  }
  try {
    // Set date range to 1 year ago till today
    const now = new Date();
    const endTime = now.toISOString();
    const startTime = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const url = "https://api.goto.com/call-reports/v1/reports/phone-number-activity";
    // Only fetch 1 item to check for existence and show fields
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { organizationId, startTime, endTime, page: 1, pageSize: 1 }
    });
    const items = response.data.items || [];
    let count = 0;
    if (response.data.totalCount !== undefined) {
      count = response.data.totalCount;
    } else if (response.data.count !== undefined) {
      count = response.data.count;
    } else {
      count = items.length;
    }
    // Log all fields and data to terminal
    if (items.length > 0) {
      console.log("First call activity data item:", items[0]);
      console.log("All fields:", Object.keys(items[0]));
    } else {
      console.log("No call activity data found for the last year.");
    }
    res.json({ exists: items.length > 0, count, data: items[0] || null, fields: items[0] ? Object.keys(items[0]) : [] });
  } catch (error) {
    console.error("Call Reports API error:", error.message, error.response?.data);
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data });
  }
});

// Endpoint to set access token (for demo/testing)
app.get('/api/set-access-token', (req, res) => {
  latestAccessToken = req.query.accessToken;
  res.json({ success: true });
});

// Voicemail Box Report Endpoint
app.get('/api/voicemails', async (req, res) => {
  const accessToken = req.query.accessToken || latestAccessToken;
  const { organizationId, accountKey, extensionNumber, pageMarker, pageSize } = req.query;
  if (!organizationId) {
    return res.status(400).json({ error: 'Missing required parameter: organizationId' });
  }
  const voicemailParams = { organizationId };
  if (accountKey) voicemailParams.accountKey = accountKey;
  if (extensionNumber) voicemailParams.extensionNumber = extensionNumber;
  if (pageMarker) voicemailParams.pageMarker = pageMarker;
  if (pageSize) voicemailParams.pageSize = pageSize;
  const voicemailUrl = 'https://api.goto.com/voicemail/v1/voicemailboxes';
  try {
    console.log('Proxying to GoTo Voicemail API:', voicemailUrl);
    console.log('Params:', voicemailParams);
    console.log('Authorization:', accessToken ? accessToken.slice(0, 20) + '...' : 'None');
    const response = await axios.get(voicemailUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: voicemailParams
    });
    console.log('GoTo Voicemail API response:', JSON.stringify(response.data).slice(0, 500));
    res.json(response.data);
  } catch (error) {
    console.error('GoTo Voicemail API error:', error.message, error.response?.data);
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data });
  }
});

// Endpoint to return latest access token
app.get('/api/latest-access-token', (req, res) => {
  res.json({ accessToken: latestAccessToken });
});

// Dynamically fetch accountKey for the organization from the Voicemail API
async function fetchAccountKey(accessToken, organizationId) {
  try {
    const voicemailResp = await axios.get('https://api.goto.com/voicemail/v1/voicemailboxes', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { organizationId, pageSize: 10 }
    });
    const voicemailboxes = voicemailResp.data.items || [];
    for (const box of voicemailboxes) {
      const msgResp = await axios.get(`https://api.goto.com/voicemail/v1/voicemailboxes/${box.voicemailboxId}/voicemails`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { pageSize: 5 }
      });
      const messages = msgResp.data.items || [];
      for (const message of messages) {
        if (message.accountKey) {
          return message.accountKey;
        }
      }
    }
  } catch (err) {
    // Ignore errors, return null if not found
  }
  return null;
}

// Endpoint to return organization ID and accountKey from .env only (static)
app.get('/api/env-vars', (req, res) => {
  res.json({
    organizationId: process.env.ORGANIZATIONALID || '',
    accountKey: process.env.ACCOUNTKEY || ''
  });
});

// Endpoint to set accountKey in memory (for demo/testing)
app.get('/api/set-accountkey', (req, res) => {
  if (req.query.accountKey) {
    cachedAccountKey = req.query.accountKey;
    res.json({ success: true, accountKey: cachedAccountKey });
  } else {
    res.status(400).json({ error: 'Missing accountKey parameter.' });
  }
});

// Test endpoint to compare accountKey from Voicemail API and Voice Admin API
app.get('/api/test-accountkey-compare', async (req, res) => {
  // Use accessToken and organizationId from query or fallback to latest/token/env
  const accessToken = req.query.accessToken || latestAccessToken;
  const organizationId = req.query.organizationId || process.env.ORGANIZATIONALID;
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing access token. Please authenticate first.' });
  }
  if (!organizationId) {
    return res.status(400).json({ error: 'Missing organization ID. Please set ORGANIZATIONALID in .env or provide as query param.' });
  }
  try {
    // Step 1: Get voicemailboxes
    const voicemailResp = await axios.get('https://api.goto.com/voicemail/v1/voicemailboxes', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { organizationId, pageSize: 1 }
    });
    const voicemailboxes = voicemailResp.data.items || [];
    if (voicemailboxes.length === 0) {
      return res.status(404).json({ error: 'No voicemailboxes found for this organization.' });
    }
    // Step 2: Get first voicemail for first box
    const box = voicemailboxes[0];
    let voicemailAccountKey = null;
    try {
      const msgResp = await axios.get(`https://api.goto.com/voicemail/v1/voicemailboxes/${box.voicemailboxId}/voicemails`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { pageSize: 1 }
      });
      const message = (msgResp.data.items || [])[0];
      voicemailAccountKey = message ? message.accountKey : null;
    } catch (msgErr) {
      voicemailAccountKey = null;
    }
    if (!voicemailAccountKey) {
      return res.status(404).json({ error: 'No accountKey found in first voicemail message.' });
    }
    // Step 3: Query Voice Admin API with this accountKey
    let voiceAdminResult = null;
    try {
      const vaResp = await axios.get('https://api.goto.com/voice-admin/v1/phone-number', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { accountkey: voicemailAccountKey }
      });
      voiceAdminResult = vaResp.data;
    } catch (vaErr) {
      voiceAdminResult = { error: vaErr.message, details: vaErr.response?.data };
    }
    res.json({
      voicemailAccountKey,
      voiceAdminResult
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data });
  }
});

// Enhanced test endpoint: search up to 100 voicemail boxes and 20 messages each, log raw message data
app.get('/api/test-accountkey-compare', async (req, res) => {
  const accessToken = req.query.accessToken || latestAccessToken;
  const organizationId = req.query.organizationId || process.env.ORGANIZATIONALID;
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing access token. Please authenticate first.' });
  }
  if (!organizationId) {
    return res.status(400).json({ error: 'Missing organization ID. Please set ORGANIZATIONALID in .env or provide as query param.' });
  }
  try {
    // Step 1: Get up to 100 voicemailboxes
    const voicemailResp = await axios.get('https://api.goto.com/voicemail/v1/voicemailboxes', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { organizationId, pageSize: 100 }
    });
    const voicemailboxes = voicemailResp.data.items || [];
    let foundAccountKey = null;
    let foundBox = null;
    let foundMessage = null;
    let debugMessages = [];
    // Step 2: Search each box for a message with accountKey, log all messages
    for (const box of voicemailboxes) {
      try {
        const msgResp = await axios.get(`https://api.goto.com/voicemail/v1/voicemailboxes/${box.voicemailboxId}/voicemails`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { pageSize: 20 }
        });
        const messages = msgResp.data.items || [];
        debugMessages.push({ boxId: box.voicemailboxId, messages });
        for (const message of messages) {
          if (message.accountKey) {
            foundAccountKey = message.accountKey;
            foundBox = box;
            foundMessage = message;
            break;
          }
        }
        if (foundAccountKey) break;
      } catch (msgErr) {
        // Ignore errors for individual boxes
      }
    }
    if (!foundAccountKey) {
      return res.status(404).json({ error: 'No accountKey found in any of the first 100 voicemail boxes/messages.', debugMessages });
    }
    // Step 3: Query Voice Admin API with this accountKey
    let voiceAdminResult = null;
    try {
      const vaResp = await axios.get('https://api.goto.com/voice-admin/v1/phone-number', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { accountkey: foundAccountKey }
      });
      voiceAdminResult = vaResp.data;
    } catch (vaErr) {
      voiceAdminResult = { error: vaErr.message, details: vaErr.response?.data };
    }
    res.json({
      voicemailAccountKey: foundAccountKey,
      voicemailBox: foundBox,
      voicemailMessage: foundMessage,
      voiceAdminResult,
      debugMessages
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message, details: error.response?.data });
  }
});

// Debug endpoint: decode current access token and call /admin/v1/me
app.get('/debug-token', async (req, res) => {
  const accessToken = latestAccessToken;
  if (!accessToken) return res.status(401).json({ error: 'No access token. Authenticate first.' });

  // Decode JWT payload (if token is a JWT)
  let decoded = null;
  try {
    const parts = accessToken.split('.');
    if (parts.length >= 2) {
      const payload = parts[1];
      // Add padding if needed
      const pad = payload.length % 4;
      const padded = pad ? payload + '='.repeat(4 - pad) : payload;
      decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } else {
      decoded = { message: 'Token does not appear to be a JWT' };
    }
  } catch (err) {
    decoded = { error: 'Failed to decode token payload', message: err.message };
  }

  // Call /admin/v1/me to verify token and get accountKey
  let meData = null;
  try {
    const meResp = await axios.get('https://api.goto.com/admin/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    meData = meResp.data;
  } catch (err) {
    meData = { error: 'me call failed', message: err.message, details: err.response?.data };
  }

  res.json({ decodedToken: decoded, me: meData });
});

// Extended debug endpoint: try SCIM /me and admin /me on both hosts
app.get('/debug-token-extended', async (req, res) => {
  const accessToken = latestAccessToken;
  if (!accessToken) return res.status(401).json({ error: 'No access token. Authenticate first.' });

  // Helper to call a URL and capture result
  async function callUrl(url) {
    try {
      const r = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      return { ok: true, status: r.status, data: r.data };
    } catch (err) {
      return { ok: false, message: err.message, status: err.response?.status, details: err.response?.data };
    }
  }

  // Decode JWT payload (if token is a JWT)
  let decoded = null;
  try {
    const parts = accessToken.split('.');
    if (parts.length >= 2) {
      const payload = parts[1];
      const pad = payload.length % 4;
      const padded = pad ? payload + '='.repeat(4 - pad) : payload;
      decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } else {
      decoded = { message: 'Token does not appear to be a JWT' };
    }
  } catch (err) {
    decoded = { error: 'Failed to decode token payload', message: err.message };
  }

  // Try endpoints
  const results = {};
  results.scim_me = await callUrl('https://api.getgo.com/identity/v1/Users/me');
  results.admin_me_goto = await callUrl('https://api.goto.com/admin/v1/me');
  results.admin_me_getgo = await callUrl('https://api.getgo.com/admin/v1/me');

  res.json({ decodedToken: decoded, results });
});

// Endpoint: list SCIM accounts available to the authenticated user
app.get('/list-scim-accounts', async (req, res) => {
  const accessToken = latestAccessToken;
  if (!accessToken) return res.status(401).json({ error: 'No access token. Authenticate first.' });
  try {
    const scimUrl = 'https://api.getgo.com/identity/v1/Users/me';
    const meResp = await axios.get(scimUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const ext = meResp.data['urn:scim:schemas:extension:getgo:1.0'] || meResp.data['urn:scim:schemas:extension:getgo:1.0'];
    const accounts = (ext?.accounts || meResp.data.accounts || []).map(a => ({ value: a.value || a.accountKey || a.id, display: a.display || null, entitlements: a.entitlements || [] }));
    res.json({ accounts });
  } catch (err) {
    console.error('/list-scim-accounts error', err.message, err.response?.data);
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

// Endpoint to read persisted phone numbers from DB
app.get('/db/phone-numbers', (req, res) => {
  const qAccount = req.query.accountKey || req.query.account || null;
  const params = [];
  let sql = 'SELECT * FROM phone_numbers';
  if (qAccount) { sql += ' WHERE accountKey = ?'; params.push(qAccount); }
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ count: rows.length, rows });
  });
});

// Endpoint to export phone numbers as CSV (streams attachment)
app.get('/export-phone-numbers', (req, res) => {
  const accountKey = req.query.accountKey || process.env.ACCOUNTKEY || '';
  const params = accountKey ? [accountKey] : [];
  const sql = accountKey ? 'SELECT number, name, status FROM phone_numbers WHERE accountKey = ? ORDER BY number' : 'SELECT number, name, status FROM phone_numbers ORDER BY accountKey, number';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const filename = `phone-numbers-${accountKey || 'all'}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // write header
    res.write('number,name,status\n');
    for (const r of rows) {
      const num = (r.number || '').replace(/"/g, '""');
      const name = (r.name || '').replace(/"/g, '""');
      const status = (r.status || '').replace(/"/g, '""');
      res.write(`"${num}","${name}","${status}"\n`);
    }
    res.end();
  });
});

// Cleanup/retention: delete rows older than RETENTION_DAYS (default 90)
function cleanOldRows(retentionDays) {
  return new Promise((resolve, reject) => {
    const days = parseInt(retentionDays || process.env.RETENTION_DAYS || '90', 10) || 90;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    db.run('DELETE FROM phone_numbers WHERE fetched_at < ?', [cutoff], function(err) {
      if (err) return reject(err);
      resolve({ deleted: this.changes || 0 });
    });
  });
}

// Endpoint to trigger cleanup manually
app.post('/db/cleanup', async (req, res) => {
  const days = req.query.days || process.env.RETENTION_DAYS || 90;
  try {
    const result = await cleanOldRows(days);
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Optional auto-cleanup scheduler controlled by env var AUTO_CLEANUP_ENABLED (true/false) and AUTO_CLEANUP_INTERVAL_HOURS
(function setupAutoCleanup() {
  const enabled = (process.env.AUTO_CLEANUP_ENABLED || 'false').toLowerCase() === 'true';
  const hours = parseInt(process.env.AUTO_CLEANUP_INTERVAL_HOURS || '24', 10) || 24;
  if (!enabled) return;
  const days = parseInt(process.env.RETENTION_DAYS || '90', 10) || 90;
  // run immediately then schedule
  (async () => {
    try {
      const r = await cleanOldRows(days);
      console.log(`Auto-clean: removed ${r.deleted} rows older than ${days} days`);
    } catch (e) {
      console.error('Auto-clean error', e && e.message);
    }
  })();
  setInterval(() => {
    cleanOldRows(days).then(r => console.log(`Auto-clean: removed ${r.deleted} rows`)).catch(e => console.error('Auto-clean error', e && e.message));
  }, hours * 60 * 60 * 1000);
  console.log(`Auto-clean enabled: interval=${hours}h, retention=${days}d`);
})();

// Debug: return the currently stored expected OAuth state (useful to compare with callback state)
app.get('/debug/expected-state', (req, res) => {
  try {
    res.json({ expectedState: expectedState || null, note: 'This is the in-memory state your server expects when handling the OAuth callback' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug: return decoded access token payload and basic token info
app.get('/debug/token-info', (req, res) => {
  try {
    const token = latestAccessToken;
    if (!token) return res.json({ hasToken: false });
    const decoded = decodeJwtPayload(token);
    res.json({ hasToken: true, decodedPayload: decoded || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug: clear the in-memory expected state (useful if you want to force a fresh /auth generation)
app.post('/debug/clear-state', (req, res) => {
  try {
    expectedState = null;
    res.json({ cleared: true, expectedState: expectedState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(5000, () => {
  console.log("Visit http://localhost:5000/auth to start the OAuth flow.");
});
