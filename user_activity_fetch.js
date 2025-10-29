// user_activity_fetch.js
// Example template for fetching user activity from GoTo Connect API
// This file is empty, so here is a commented template for reference:

// Import Axios for HTTP requests
const axios = require('axios'); // Used to call GoTo API

// Function to fetch user activity
async function fetchUserActivity({ accessToken, startDate, endDate, organizationId }) {
  // Build request parameters
  const params = {
    startDate, // ISO 8601 start date
    endDate,   // ISO 8601 end date
    organizationId // Organization ID
  };
  try {
    // Make GET request to GoTo Connect User Activity API
    const response = await axios.get('https://api.goto.com/call-reports/v1/reports/user-activity', {
      headers: { Authorization: `Bearer ${accessToken}` }, // Auth header
      params // Query params
    });
    // Return the API response data
    return response.data;
  } catch (error) {
    // Log and rethrow error for caller to handle
    console.error('User Activity API error:', error.message, error.response?.data);
    throw error;
  }
}

// Export the function for use in other modules
module.exports = { fetchUserActivity };
