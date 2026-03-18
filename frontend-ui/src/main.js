const API_URL = "http://127.0.0.1:8000";

async function fetchCalendars() {
  const listElement = document.getElementById("calendar-list");
  
  try {
    const response = await fetch(`${API_URL}/calendars/`);
    const calendars = await response.json();

    listElement.innerHTML = "";

    if (calendars.length === 0) {
      listElement.innerHTML = "<p>No timelines found. Create one in the API!</p>";
      return;
    }

    calendars.forEach(calendar => {
      const item = document.createElement("div");
      item.className = "calendar-card";
      
      let eventsHtml = "<ul class='event-list'>";
      if (calendar.events && calendar.events.length > 0) {
          calendar.events.forEach(event => {
              const startDate = new Date(event.start_time).toLocaleString();
              eventsHtml += `<li><strong>${event.title}</strong> <br><small>${startDate}</small></li>`;
          });
      } else {
          eventsHtml += "<li><small>No events scheduled.</small></li>";
      }
      eventsHtml += "</ul>";

      item.innerHTML = `
        <div class="card-header">
            <h3>${calendar.name}</h3>
            <button class="delete-btn" onclick="deleteCalendar(${calendar.id})">Delete</button>
        </div>
        <p class="description">${calendar.description || "No description"}</p>
        <div class="events-container">
            ${eventsHtml}
        </div>
      `;
      listElement.appendChild(item);
    });

  } catch (error) {
    console.error("Failed to fetch:", error);
    listElement.innerHTML = "<p style='color: red;'>Error connecting to backend. Is the Python server running?</p>";
  }
}

window.deleteCalendar = async function(id) {
    if (!confirm("Are you sure you want to delete this timeline and all its events?")) return;
    
    try {
        const response = await fetch(`${API_URL}/calendars/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            fetchCalendars(); 
        } else {
            alert("Failed to delete timeline.");
        }
    } catch (error) {
        console.error("Error deleting:", error);
        alert("Could not connect to the server to delete.");
    }
};

window.addEventListener("DOMContentLoaded", () => {
  fetchCalendars();
  document.getElementById("refresh-btn").addEventListener("click", fetchCalendars);
});