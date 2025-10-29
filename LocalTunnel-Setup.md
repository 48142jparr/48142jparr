# GoTo Connect HTTP Notify Listener Setup

This guide explains how to run the Node.js listener server, expose it to the internet using LocalTunnel, and log in to your GoTo account for dial plan integration.

## 1. Prerequisites
- Node.js installed (v22.x or later)
- Express installed (`npm install express`)
- LocalTunnel installed globally (`npm install -g localtunnel`)

## 2. Running the Listener Server
1. Open a terminal and navigate to your project directory:
   ```sh
   cd /Users/parrish/Library/CloudStorage/OneDrive-GoToTechnologiesUSALLC/GoTo/API/User Activity Summary
   ```
2. Start the server:
   ```sh
   node listener.js
   ```
   You should see:
   ```
   HTTP Notify listener running on port 5000
   POST endpoint: http://localhost:5000/notify
   ```

## 3. Exposing Your Server with LocalTunnel
1. In a new terminal window, run:
   ```sh
   lt --port 5000
   ```
2. Copy the public URL shown (e.g., `https://eight-oranges-turn.loca.lt`).
3. **Important:** Each time you restart LocalTunnel, a new public URL is generated. You must update this URL in GoTo Connect's HTTP Notify node configuration every time you restart LocalTunnel to ensure requests reach your server.

## 4. Logging in to Your GoTo Account
1. Go to [GoTo Admin Portal](https://admin.goto.com/).
2. Log in with your GoTo Connect credentials.
3. Navigate to the dial plan editor and add an HTTP Notify node.
4. Paste your current LocalTunnel public URL in the node's configuration.

## 5. Testing
- Send a test call through the dial plan.
- Check your terminal for incoming POST request logs.
- Open the dashboard (`calls-dashboard.html`) to view call events.

## Troubleshooting
- If the server does not start, ensure no other process is using port 5000 (`lsof -i :5000 | grep LISTEN | awk '{print $2}' | xargs kill -9`).
- If LocalTunnel fails, try restarting it or use a different port.
- Always update the GoTo Connect dial plan with the latest LocalTunnel URL after restarting LocalTunnel.

---
For further help, contact your GoTo Connect admin or refer to the project documentation.
