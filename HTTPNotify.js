/*
listener.js
Purpose: Node.js Express server to receive and log HTTP Notify POST requests from GoTo Connect dial plan nodes.

How it works:
- Listens on port 5000 (or process.env.PORT)
- Exposes POST /notify endpoint for GoTo Connect HTTP Notify node
- Logs incoming request headers and body for monitoring and debugging
- Stores call data in SQLite database (including State and Extension)
- Provides REST API endpoint /calls for frontend
- Uses WebSocket for real-time updates
*/

const express = require('express'); // Import Express framework
const sqlite3 = require('sqlite3').verbose(); // Import SQLite3 for database
const http = require('http'); // Import HTTP module
const { Server } = require('socket.io'); // Import Socket.IO for WebSocket
const app = express(); // Create Express app
const port = process.env.PORT || 5000; // Set server port
const path = require('path'); // Import path module

// Initialize SQLite DB and create calls table if not exists
const db = new sqlite3.Database('./calls.db');
db.run(`CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    PBX_ID TEXT,
    CALL_ID TEXT,
    DIALED_NUMBER TEXT,
    CALLER_ID_NUMBER TEXT,
    CALLER_ID_NAME TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    CALLER_AREA_CODE TEXT,
    State TEXT,
    Extension TEXT
)`);

app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(express.static(path.join(__dirname))); // Serve static files

// Create HTTP server and attach Socket.IO
const server = http.createServer(app);
const io = new Server(server);

// POST /notify endpoint for GoTo Connect HTTP Notify node
app.post('/notify', (req, res) => {
    // Extract call data from POST body
    const { PBX_ID, CALL_ID, DIALED_NUMBER, CALLER_ID_NUMBER, CALLER_ID_NAME } = req.body;
    let CALLER_AREA_CODE = '';
    // Extract area code from caller number
    if (CALLER_ID_NUMBER && CALLER_ID_NUMBER.length >= 10) {
        const digits = CALLER_ID_NUMBER.replace(/[^0-9]/g, '');
        CALLER_AREA_CODE = digits.substring(0, 3);
    }
    // Lookup State and Extension by area code
    getStateAndExtensionByAreaCode(CALLER_AREA_CODE, result => {
        // Build call object with all fields
        const debugBody = {
            PBX_ID,
            CALL_ID,
            DIALED_NUMBER,
            CALLER_ID_NUMBER,
            CALLER_ID_NAME,
            CALLER_AREA_CODE,
            State: result ? result.state : null,
            Extension: result ? result.extension : null
        };
        console.log('--- Incoming HTTP Notify POST ---'); // Log POST
        console.log('Headers:', req.headers); // Log headers
        console.log('Body:', debugBody); // Log body
        // Store call in database
        db.run(
            `INSERT INTO calls (PBX_ID, CALL_ID, DIALED_NUMBER, CALLER_ID_NUMBER, CALLER_ID_NAME, CALLER_AREA_CODE, State, Extension) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [PBX_ID, CALL_ID, DIALED_NUMBER, CALLER_ID_NUMBER, CALLER_ID_NAME, CALLER_AREA_CODE, debugBody.State, debugBody.Extension]
        );
        // Emit call to frontend via WebSocket
        io.emit('new_call', debugBody);
        res.status(200).send('Received'); // Respond to POST
    });
});

// REST API endpoint to fetch all calls
app.get('/calls', (req, res) => {
    db.all('SELECT * FROM calls ORDER BY timestamp DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message }); // Handle DB error
        res.json(rows); // Return all calls
    });
});

// Health check endpoint
app.get('/', (req, res) => {
    res.send('GoTo Connect HTTP Notify listener is running.'); // Health check response
});

// Lookup state and extension by area code from statescodes.db
function getStateAndExtensionByAreaCode(areaCode, callback) {
    const lookupDb = new sqlite3.Database('./statescodes.db'); // Open lookup DB
    lookupDb.all('SELECT State, AreaCodes, Extension FROM state_area_codes', (err, rows) => {
        if (err) {
            console.error('Error querying database:', err); // Log error
            return callback(null);
        }
        let found = false;
        for (const row of rows) {
            if (!row.AreaCodes) {
                console.log(`Skipping row with missing AreaCodes: State=${row.State}, Extension=${row.Extension}`);
                continue;
            }
            const codes = row.AreaCodes.split(',').map(code => code.trim()); // Split area codes
            console.log(`Checking row: State=${row.State}, Extension=${row.Extension}, AreaCodes=${row.AreaCodes}`);
            for (const code of codes) {
                console.log(`Comparing extracted areaCode '${areaCode}' to code '${code}'`);
                if (code === areaCode) {
                    console.log(`Match found! State: ${row.State}, Extension: ${row.Extension}`);
                    found = true;
                    lookupDb.close(); // Close DB
                    return callback({ state: row.State, extension: row.Extension }); // Return match
                }
            }
        }
        if (!found) {
            console.log('No match found for area code:', areaCode); // No match found
        }
        lookupDb.close(); // Close DB
        callback(null); // Return null if not found
    });
}

// Start the server and log endpoint info
server.listen(port, () => {
    console.log(`HTTP Notify listener running on port ${port}`); // Log server start
    console.log(`POST endpoint: http://localhost:${port}/notify`); // Log POST endpoint
    console.log(`REST API endpoint: http://localhost:${port}/calls`); // Log REST endpoint
    console.log(`WebSocket running on port ${port}`); // Log WebSocket
});
