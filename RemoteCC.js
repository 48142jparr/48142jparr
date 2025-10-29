/*
RemoteCC.js
Purpose: Node.js Express server for GoTo Connect Remote Call Control node integration.
- Receives POST requests from GoTo Connect dial plan Remote Call Control node
- Captures caller info (CALL_ID, CALLER_ID_NAME, CALLER_ID_NUMBER, DIALED_NUMBER, PBX_ID)
- Extracts area code from CALLER_ID_NUMBER
- Looks up area code in statescodes.db to find matching extension
- Returns extension number as plain text response (for call rerouting)
- Logs all requests and responses
- Stores events in remotecc_events.db for monitoring
- Uses WebSocket for real-time updates
*/

const express = require('express'); // Import Express framework
const sqlite3 = require('sqlite3').verbose(); // Import SQLite3 for database
const http = require('http'); // Import HTTP module
const { Server } = require('socket.io'); // Import Socket.IO for WebSocket
const app = express(); // Create Express app
const port = process.env.PORT || 5000; // Set server port to 5000
const path = require('path'); // Import path module

// Initialize SQLite DB and create events table if not exists
const db = new sqlite3.Database('./remotecc_events.db');
db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    PBX_ID TEXT,
    CALL_ID TEXT,
    CALLER_ID_NAME TEXT,
    CALLER_ID_NUMBER TEXT,
    DIALED_NUMBER TEXT,
    AREA_CODE TEXT,
    MATCHED_STATE TEXT,
    MATCHED_EXTENSION TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(express.static(path.join(__dirname))); // Serve static files

// Create HTTP server and attach Socket.IO
const server = http.createServer(app);
const io = new Server(server);

// POST /remotecc endpoint for GoTo Connect Remote Call Control node
app.post('/remotecc', (req, res) => {
    console.log('Received POST /remotecc'); // Debug: log entry into handler
    // Extract call data from POST body
    const { PBX_ID, CALL_ID, CALLER_ID_NAME, CALLER_ID_NUMBER, DIALED_NUMBER } = req.body;
    let AREA_CODE = '';
    // Extract area code from caller number
    if (CALLER_ID_NUMBER && CALLER_ID_NUMBER.length >= 10) {
        const digits = CALLER_ID_NUMBER.replace(/[^0-9]/g, '');
        AREA_CODE = digits.substring(0, 3);
    }
    // Lookup extension by area code
    getExtensionByAreaCode(AREA_CODE, (result) => {
        const eventObj = {
            PBX_ID,
            CALL_ID,
            CALLER_ID_NAME,
            CALLER_ID_NUMBER,
            DIALED_NUMBER,
            AREA_CODE,
            MATCHED_STATE: result ? result.state : null,
            MATCHED_EXTENSION: result ? result.extension : null
        };
        // Log request and lookup result
        console.log('--- Incoming RemoteCC POST ---'); // Log POST
        console.log('Headers:', req.headers); // Log headers
        console.log('Body:', eventObj); // Log body
        // Store event in database
        db.run(
            `INSERT INTO events (PBX_ID, CALL_ID, CALLER_ID_NAME, CALLER_ID_NUMBER, DIALED_NUMBER, AREA_CODE, MATCHED_STATE, MATCHED_EXTENSION) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [PBX_ID, CALL_ID, CALLER_ID_NAME, CALLER_ID_NUMBER, DIALED_NUMBER, AREA_CODE, eventObj.MATCHED_STATE, eventObj.MATCHED_EXTENSION]
        );
        // Emit event to frontend via WebSocket
        io.emit('new_event', eventObj);
        // Respond with extension number (plain text, no quotes)
        if (result && result.extension) {
            res.status(200).send(result.extension); // Return extension for call routing
        } else {
            res.status(200).send(''); // No match, empty response triggers failover
        }
    });
});

// REST API endpoint to fetch all events
app.get('/events', (req, res) => {
    db.all('SELECT * FROM events ORDER BY timestamp DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message }); // Handle DB error
        res.json(rows); // Return all events
    });
});

// Health check endpoint
app.get('/', (req, res) => {
    res.send('GoTo Connect Remote Call Control listener is running.'); // Health check response
});

// Lookup extension by area code from statescodes.db
function getExtensionByAreaCode(areaCode, callback) {
    const lookupDb = new sqlite3.Database('./statescodes.db'); // Open lookup DB
    lookupDb.all('SELECT State, AreaCodes, Extension FROM state_area_codes', (err, rows) => {
        if (err) {
            console.error('Error querying database:', err); // Log error
            return callback(null);
        }
        for (const row of rows) {
            if (!row.AreaCodes) {
                console.log(`Skipping row with missing AreaCodes: State=${row.State}, Extension=${row.Extension}`); // Log missing area codes
                continue;
            }
            const codes = row.AreaCodes.split(',').map(code => code.trim()); // Split area codes
            console.log(`Checking row: State=${row.State}, Extension=${row.Extension}, AreaCodes=${row.AreaCodes}`); // Log row being checked
            for (const code of codes) {
                console.log(`Comparing extracted areaCode '${areaCode}' to code '${code}'`); // Log comparison
                if (code === areaCode) {
                    console.log(`Match found! State: ${row.State}, Extension: ${row.Extension}`); // Log match
                    lookupDb.close(); // Close DB
                    return callback({ state: row.State, extension: row.Extension }); // Return match
                }
            }
        }
        console.log('No match found for area code:', areaCode); // No match found
        lookupDb.close(); // Close DB
        callback(null); // Return null if not found
    });
}

// Start the server and log endpoint info
server.listen(port, () => {
    console.log(`Remote Call Control listener running on port ${port}`); // Log server start
    console.log(`POST endpoint: http://localhost:${port}/remotecc`); // Log POST endpoint
    console.log(`REST API endpoint: http://localhost:${port}/events`); // Log REST endpoint
    console.log(`WebSocket running on port ${port}`); // Log WebSocket
});
