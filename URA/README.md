# GoTo Connect User Activity Summary - Project Overview

This project provides a complete solution for fetching, displaying, and exporting GoTo Connect user activity reports using Node.js and a web UI.

## Components

### 1. getTokenServer.js
- **Purpose:** Backend Node.js server that handles OAuth authentication, token management, and acts as a proxy for GoTo Connect API requests.
- **Key Features:**
  - Serves static files (including `UReport.html` and `image.png`).
  - Manages OAuth flow and securely stores access tokens.
  - Provides endpoints for the UI to fetch the latest access token and proxy user activity report requests to the GoTo API.
  - Handles all required and optional query parameters, forwarding them to the GoTo API and returning the results to the frontend.

### 2. UReport.html
- **Purpose:** Modern, interactive web UI for querying and displaying user activity reports from GoTo Connect.
- **Key Features:**
  - Automatically populates required fields (access token, organization ID, date range) and allows users to set advanced query parameters (page, pageSize, q, userIds, sort).
  - Fetches report data from the backend proxy and displays it in a detailed, sortable table with summary statistics.
  - Includes export to CSV functionality, troubleshooting tips, and request details for debugging.
  - Provides a user-friendly interface for exploring GoTo Connect user activity data.

### 3. image.png
- **Purpose:** Visual branding/logo displayed in the UI header next to the report title.
- **How it works:**
  - Served as a static file by the backend.
  - Displayed in the header of `UReport.html` for a professional look and easy identification.

## How They Work Together
- The backend (`getTokenServer.js`) serves the UI (`UReport.html`) and the logo (`image.png`) as static files.
- The UI (`UReport.html`) interacts with the backend to:
  - Fetch the latest OAuth access token.
  - Send user activity report requests with all required and optional parameters.
- The backend proxies these requests to the GoTo Connect API, handles authentication, and returns the results to the UI.
- The UI displays the results, allows export, and provides troubleshooting and request details for transparency and debugging.

## Usage
1. **Start the backend server:**
   ```sh
   node getTokenServer.js
   ```
2. **Open the UI:**
   - Visit `http://localhost:5000/UReport.html` in your browser.
3. **Authenticate and fetch reports:**
   - Follow the OAuth flow to obtain an access token.
   - Use the UI to query, view, and export user activity data.

## Requirements
- Node.js
- GoTo Connect API credentials

## License
This project is for demonstration and internal use. Please ensure you comply with GoTo Connect API terms of service.
