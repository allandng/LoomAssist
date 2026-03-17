// This tells the app where your Python brain is living
const API_URL = "http://127.0.0.1:8000";

async function fetchCalendars() {
  const listElement = document.getElementById("calendar-list");
  
  try {
    // 1. Ask the Python backend for the data
    const response = await fetch(`${API_URL}/calendars/`);
    const calendars = await response.json();

    // 2. Clear the "Loading..." text
    listElement.innerHTML = "";

    // 3. Loop through the data and put it on the screen
    if (calendars.length === 0) {
      listElement.innerHTML = "<p>No timelines found. Create one in the API!</p>";
      return;
    }

    calendars.forEach(calendar => {
      const item = document.createElement("div");
      item.className = "calendar-card";
      item.innerHTML = `
        <h3>${calendar.name}</h3>
        <p>${calendar.description || "No description"}</p>
      `;
      listElement.appendChild(item);
    });

  } catch (error) {
    console.error("Failed to fetch:", error);
    listElement.innerHTML = "<p style='color: red;'>Error connecting to backend. Is the Python server running?</p>";
  }
}

// When the window loads, fetch the data
window.addEventListener("DOMContentLoaded", () => {
  fetchCalendars();
  
  // Make the refresh button work
  document.getElementById("refresh-btn").addEventListener("click", fetchCalendars);
});