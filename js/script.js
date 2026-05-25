
// The gibberish below is just your Google Sheet URL encoded in Base64
const SHEET_URL = atob("aHR0cHM6Ly9kb2NzLmdvb2dsZS5jb20vc3ByZWFkc2hlZXRzL2QvMWw2T18zbG1mc1lzcmlDZG93M21RZ3dNdmJMUVBDSVNmdVJNR1VLWEtaSEkvZ3Zpei90cT90cXg9b3V0Ompzb24=");

let tasks = [];
let agents = new Set();
let sbsSet = new Set();
let currentPage = 1;
let lastTaskCount = 0;  
let newTaskCount = 0;      
let lastScrollPosition = 0; 

// Filter & Sort State
let selectedStatuses = new Set(['all']);
let currentSort = "newest";

const tasksPerPage = 20;

// Unique Statuses Updated
const uniqueStatuses = [
    "assigned to upload", "complete", "uploading on amazon/tg/wmt", 
    "cancelled", "waiting s.cox’s feedback", "team edits", "in progress", 
    "assigned to listings", "ongoing upload", "ongoing", "to do", 
    "pending", "assigned", "queued",
    "ongoing analysis", "ongoing ff creation", "awaiting additional assets",
    "for audit", "uploading ff", "waiting to reflect", "case sent",
    "awaiting details", "on hold"
];

document.addEventListener("DOMContentLoaded", () => {
    initApp();
    initDarkMode();
    
    document.getElementById("searchBar").addEventListener("input", () => { currentPage = 1; filterTasks(); });
    document.getElementById("logoutBtn").addEventListener("click", logout);
    document.getElementById("aboutBtn").addEventListener("click", showAbout);
    
    document.getElementById("sortSelect").addEventListener("change", (e) => {
        currentSort = e.target.value;
        currentPage = 1;
        filterTasks();
    });

    setInterval(() => { fetchTasks().then(() => filterTasks(true)); }, 30000);
});

function toProperCase(str) {
    if (!str) return "N/A";
    return str.toString().toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
}

function sanitizeStatusClass(status) {
    if (!status) return "status-na";
    return "status-" + status.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function initDarkMode() {
    const darkModeBtn = document.getElementById("darkModeToggle");
    const savedTheme = localStorage.getItem("exclusiveTM_theme") || "light";
    
    function applyTheme(isDark) {
        document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
        darkModeBtn.innerHTML = isDark ? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon"></i>';
        localStorage.setItem("exclusiveTM_theme", isDark ? "dark" : "light");
    }
    
    applyTheme(savedTheme === "dark");

    darkModeBtn.addEventListener("click", () => {
        const isCurrentlyDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
        applyTheme(!isCurrentlyDark);
    });
}

function showAbout() {
    document.getElementById("taskList").style.display = "none";
    document.getElementById("pagination").style.display = "none";
    document.getElementById("filterBar").style.display = "none";
    document.getElementById("taskDetail").style.display = "none";
    document.getElementById("aboutSection").style.display = "block";
    window.scrollTo(0, 0); 
}

function showHome() {
    document.getElementById("taskList").style.display = "grid";
    document.getElementById("pagination").style.display = "flex";
    document.getElementById("filterBar").style.display = "flex";
    document.getElementById("taskDetail").style.display = "none";
    document.getElementById("aboutSection").style.display = "none";
}

async function initApp() {
    await fetchTasks();
    setupLogin();
    setupStatusFilters();
    filterTasks();
    requestNotificationPermission();
    setTimeout(notifyDailyOngoingTasks, 2000); 
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function getOngoingTasks() {
  const loginName = localStorage.getItem("exclusiveTM_agent");
  if (!loginName) return [];
  return tasks.filter(t => t["Assignees"] === loginName && 
                          (t["Status"]||"").toLowerCase().includes("ongoing"));
}

function notifyDailyOngoingTasks() {
  const ongoing = getOngoingTasks();
  if (ongoing.length === 0) return;

  const today = new Date().toDateString();
  if (localStorage.getItem("exclusiveTM_lastOngoingNotify") === today) return;

  const listHtml = ongoing.map(t => {
    let linkHtml = t["Click Up Link"] !== "#" 
      ? `<a href="${t["Click Up Link"]}" target="_blank">(ClickUp)</a>` 
      : "";
    return `<li>${t["Task Name"]} ${linkHtml}</li>`;
  }).join("");

  if ("Notification" in window && Notification.permission === "granted") {
    const message = ongoing.map(t => `- ${t["Task Name"]}`).join("\n");
    new Notification("Ongoing Tasks Reminder", {
      body: message,
      icon: "https://cdn-icons-png.flaticon.com/512/4436/4436481.png"
    });
  }

  const container = document.createElement("div");
  container.className = "daily-reminder";
  container.innerHTML = `
    <strong>🔔 Daily Reminder</strong>
    <div>You have <b>${ongoing.length}</b> ongoing tasks:</div>
    <ul>${listHtml}</ul>
    <button class="btn btn-sm btn-outline-secondary mt-2">Dismiss</button>
  `;
  document.body.appendChild(container);
  container.querySelector("button").onclick = () => container.remove();

  localStorage.setItem("exclusiveTM_lastOngoingNotify", today);
}

function parseSheetDate(value) {
    if (!value || value === "N/A") return null;
    
    // Handle Google's weird internal string format: Date(2026,4,11)
    if (typeof value === 'string') {
        const match = value.match(/Date\((\d+),(\d+),(\d+)\)/);
        if (match) {
            return new Date(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
        }
    }
    
    // Handle standard string dates
    const parsedStrDate = new Date(value);
    if (!isNaN(parsedStrDate.getTime())) return parsedStrDate;

    // Handle raw excel epoch numbers
    if (!isNaN(value)) {
        const epoch = new Date(1899, 11, 30);
        return new Date(epoch.getTime() + Number(value) * 24 * 60 * 60 * 1000);
    }

    return null; 
}

function formatDate(date) {
    // Gracefully handle null or broken dates
    if (!date || isNaN(date.getTime())) return "N/A";
    
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2,'0'); 
    const d = String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
}

async function fetchTasks() {
    try {
        const res = await fetch(SHEET_URL);
        const text = await res.text();
        const json = JSON.parse(text.substr(47).slice(0, -2));
        
        agents.clear(); 

        tasks = json.table.rows.flatMap((row, i) => {
            let obj = {};
            
            json.table.cols.forEach((col, j) => { 
                const rawName = col && col.label ? col.label : `Col${j}`;
                const colName = rawName.trim();
                let cellValue = "";
                
                if (row.c && row.c[j]) {
                    cellValue = row.c[j].f ? row.c[j].f : row.c[j].v;
                }
                
                obj[colName] = cellValue; 
                const safeKey = colName.toLowerCase().replace(/[^a-z0-9]/g, '');
                obj[`_safe_${safeKey}`] = cellValue;
            });
            
            obj["_id"] = i;
            
            obj._safeGet = function(keys) {
                for(let k of keys) {
                    let sk = "_safe_" + k.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if(this[sk] !== undefined && this[sk] !== "") return this[sk];
                }
                return "";
            };

            const rawDate = obj._safeGet(["DateCreated", "CreatedDate", "Date", "DateAssigned", "DueDate", "Start"]);
            obj._dateParsed = parseSheetDate(rawDate);
            
            // Allow tracking Date Completed silently
            const rawCompletedDate = obj._safeGet(["DateCompleted", "CompletedDate", "Completed"]);
            obj._completedDateParsed = parseSheetDate(rawCompletedDate);
            
            const rawAssignees = obj._safeGet(["Assignees", "Assignee", "Agent", "Agents", "AssignedTo"]);
            let agentsAssigned = rawAssignees.split(",").map(a => a.trim()).filter(a => a);
            
            if (agentsAssigned.length === 0) agentsAssigned = ["Unassigned"];

            // *** FIX: ADDED MISSING 'BRAND NAME' & 'TASK URL' ALIASES ***
            obj["Task Name"] = obj._safeGet(["TaskName", "Task", "Name"]) || "Untitled Task";
            obj["Folder Name"] = obj._safeGet(["BrandName", "Brand", "FolderName", "Folder"]) || "No Brand";
            obj["List Name"] = obj._safeGet(["ListName", "List", "SubTask"]) || "No List";
            obj["Status"] = obj._safeGet(["Status", "TaskStatus", "State"]) || "No Status";
            obj["Tags"] = obj._safeGet(["Tags", "Tag", "Label"]) || "None";
            obj["Click Up Link"] = obj._safeGet(["TaskURL", "URL", "Link", "ClickUpLink", "ClickUp"]) || "#";

            return agentsAssigned.map(agent => {
                const copy = {...obj};
                copy["Assignees"] = agent;
                if(agent && agent !== "Unassigned") agents.add(agent); 
                return copy;
            });
        });

        tasks.sort((a,b) => b._id - a._id); 

        const loginName = localStorage.getItem("exclusiveTM_agent");
        if (loginName) {
            const currentCount = tasks.filter(t => t["Assignees"] === loginName).length;
            if (lastTaskCount > 0 && currentCount > lastTaskCount) {
                newTaskCount += (currentCount - lastTaskCount);
                updateFavicon(newTaskCount);
            }
            lastTaskCount = currentCount;
        }

        updateLastUpdated();
        updateStatusSummary();
    } catch(err) { 
        console.error("Error fetching tasks. Check sharing permissions and column names.", err); 
    }
}

function setupLogin() {
    const loginName = localStorage.getItem("exclusiveTM_agent");
    if(loginName){
        document.getElementById("logoutBtn").style.display="inline-block";
        document.getElementById("loginDropdownContainer").innerHTML = `<span class="fw-bold text-primary text-nowrap">${loginName}</span>`;
    } else {
        let dropdownHTML = `<select class="form-select form-select-sm" id="loginDropdown"><option selected disabled>Login as...</option>`;
        
        const sortedAgents = Array.from(agents).sort();
        sortedAgents.forEach(agent => { 
            dropdownHTML += `<option value="${agent}">${agent}</option>`; 
        });
        
        dropdownHTML += `</select>`;
        document.getElementById("loginDropdownContainer").innerHTML = dropdownHTML;

        document.getElementById("loginDropdown").addEventListener("change", (e) => {
            localStorage.setItem("exclusiveTM_agent", e.target.value);
            location.reload();
        });
    }
}

function setupStatusFilters(){
    const container = document.getElementById("statusFilters");
    
    let html = `
        <div class="filter-btn active" data-value="all" onclick="toggleFilter('all')">
             All Status
        </div>
    `;

    uniqueStatuses.forEach(opt => {
        html += `
            <div class="filter-btn" 
                 data-value="${opt}" 
                 onclick="toggleFilter('${opt}')">
                 ${toProperCase(opt)}
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function toggleFilter(val) {
    if (val === 'all') {
        selectedStatuses.clear();
        selectedStatuses.add('all');
    } else {
        selectedStatuses.delete('all');
        if (selectedStatuses.has(val)) {
            selectedStatuses.delete(val);
        } else {
            selectedStatuses.add(val);
        }
        
        if (selectedStatuses.size === 0) {
            selectedStatuses.add('all');
        }
    }
    
    updateFilterUI();
    currentPage = 1; 
    filterTasks();
}

function updateFilterUI() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        const val = btn.getAttribute('data-value');
        if (selectedStatuses.has(val)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function filterTasks(isRefresh=false){
    const loginName = localStorage.getItem("exclusiveTM_agent");
    if(!loginName) return;

    fetchTasks().then(() => { 
        const search = document.getElementById("searchBar").value.toLowerCase();
        
        let filtered = tasks.filter(t => t["Assignees"]===loginName);
        
        if (!selectedStatuses.has('all')) {
            filtered = filtered.filter(t => {
                const s = (t["Status"]||"").toLowerCase();
                return selectedStatuses.has(s);
            });
        }
        
        filtered = filtered.filter(t => Object.values(t).some(val => String(val).toLowerCase().includes(search)));
        
        if (currentSort === "newest") {
            filtered.sort((a,b) => b._id - a._id);
        } else if (currentSort === "oldest") {
            filtered.sort((a,b) => a._id - b._id);
        } else if (currentSort === "brand") {
            filtered.sort((a,b) => (a["Folder Name"]||"").localeCompare(b["Folder Name"]||""));
        } else if (currentSort === "status") {
            filtered.sort((a,b) => (a["Status"]||"").localeCompare(b["Status"]||""));
        }
        
        updateFilterStats(filtered);
        renderTasks(filtered, isRefresh);
        updateStatusSummary(); 
    });
}

function updateFilterStats(filteredTasks) {
    const statsEl = document.getElementById("filterStats");
    if (selectedStatuses.has('all')) {
        statsEl.innerHTML = `Showing: All Tasks (${filteredTasks.length})`;
        statsEl.classList.remove("d-none");
        return;
    }

    const counts = {};
    filteredTasks.forEach(t => {
        const s = (t["Status"] || "").toLowerCase();
        counts[s] = (counts[s] || 0) + 1;
    });

    const parts = [];
    selectedStatuses.forEach(status => {
        const count = counts[status] || 0;
        parts.push(`${toProperCase(status)} - ${count}`);
    });

    if (parts.length > 0) {
        statsEl.innerHTML = "Showing: " + parts.join(" / ");
        statsEl.classList.remove("d-none");
    } else {
        statsEl.classList.add("d-none");
    }
}

function updateStatusSummary() {
    const summaryEl = document.getElementById("statusSummary");
    const loginName = localStorage.getItem("exclusiveTM_agent");
    if(!loginName) return;

    const data = tasks.filter(t => t["Assignees"] === loginName);
    const counts = {};
    
    data.forEach(t => {
        let s = (t["Status"]||"").toLowerCase();
        if (s && s !== "no status") {
            counts[s] = (counts[s] || 0) + 1;
        }
    });

    let html = `<div class="status-badge bg-secondary text-white">Total: ${data.length}</div>`;
    
    Object.keys(counts).sort().forEach(s => {
        const cssClass = sanitizeStatusClass(s);
        html += `<div class="status-badge ${cssClass}">${toProperCase(s)}: ${counts[s]}</div>`;
    });

    summaryEl.innerHTML = html;
}

function updateFavicon(count) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");

  ctx.font = "54px Segoe UI Emoji";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("⭐", 26, 38); 

  if (count > 0) {
    ctx.beginPath();
    ctx.arc(46, 18, 22, 0, 2 * Math.PI); 
    ctx.fillStyle = "#ff0000"; 
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff"; 
    ctx.stroke();

    ctx.fillStyle = "white";
    ctx.font = "bold 28px Arial"; 
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(count > 99 ? "99+" : count, 46, 19); 
  }

  const link = document.querySelector("link[rel='icon']") || document.createElement("link");
  link.rel = "icon";
  link.href = canvas.toDataURL("image/png");
  document.head.appendChild(link);
}

function renderTasks(taskArray){
    const taskList = document.getElementById("taskList");
    taskList.innerHTML = ""; 

    const totalPages = Math.ceil(taskArray.length/tasksPerPage);
    const start = (currentPage-1)*tasksPerPage;
    const paginated = taskArray.slice(start,start+tasksPerPage);

    const todayStr = new Date().toISOString().split("T")[0];
    const logs = JSON.parse(localStorage.getItem("exclusiveTM_taskLogs") || "[]");

    paginated.forEach(t => {
        const status = (t["Status"]||"").toLowerCase();
        const clickUpLink = t["Click Up Link"];
        // Keeping internal map naming consistent but utilizing the updated data stream
        const folderName = t["Folder Name"];
        
        const checkFolder = folderName.toLowerCase();
        const checkTitle = t["Task Name"];
        const isWorking = logs.some(l => l.date === todayStr && l.task === checkTitle && l.folder === checkFolder);

        const card = document.createElement("div");
        card.className = `task-card ${isWorking ? 'task-working' : ''}`;
        
        let badgeClass = sanitizeStatusClass(status);
        
        card.innerHTML = `
                ${isWorking ? `<div class="working-indicator"><div class="pulse-dot"></div> Logged</div>` : ''}
                
                <div class="task-title">${t["Task Name"]}</div>

                <div class="task-info">
                    <i class="bi bi-folder text-primary"></i>
                    <span class="label-badge label-brand-text">${folderName}</span>
                  </div>

                  <div class="task-info">
                    <i class="bi bi-tags text-warning"></i>
                    <span class="label-badge label-task-text">${toProperCase(t["Tags"])}</span>
                  </div>

                  <div class="task-info">
                    <i class="bi bi-list-ul text-success"></i>
                    <span class="label-badge label-subtask-text">${t["List Name"]}</span>
                  </div>

                  <div class="task-info">
                      <i class="bi bi-flag text-info"></i>
                      <span class="status-badge ${badgeClass}">
                        ${toProperCase(t["Status"])}
                      </span>
                    </div>

                  <div class="task-info">
                    <i class="bi bi-calendar-event text-primary"></i>
                    ${formatDate(t._dateParsed)}
                  </div>
                </div>

                <a href="${clickUpLink}" target="clickup_tab" class="clickup-btn">
                  <i class="bi bi-link-45deg"></i> ClickUp Link
                </a>

            ${getBackgroundIcon(status)}
        `;
        card.addEventListener("click", (e)=>{
            if (!e.target.closest(".clickup-btn")) showDetail(t);
        });
        taskList.appendChild(card);
    });

    renderPagination(totalPages);
}

function getBackgroundIcon(status) {
  if(status.includes("ongoing") || status.includes("progress") || status.includes("audit")) return `<i class="bi bi-hourglass-split task-bg-icon text-primary"></i>`;
  if(status.includes("pending") || status.includes("waiting") || status.includes("awaiting") || status.includes("hold")) return `<i class="bi bi-hourglass task-bg-icon text-warning"></i>`;
  if(status === "complete") return `<i class="bi bi-check2-circle task-bg-icon text-success"></i>`;
  if(status === "cancelled") return `<i class="bi bi-slash-circle task-bg-icon text-danger"></i>`;
  if(status.includes("assigned") || status.includes("queued")) return `<i class="bi bi-person-workspace task-bg-icon text-secondary"></i>`;
  if(status.includes("uploading") || status.includes("sent")) return `<i class="bi bi-cloud-arrow-up task-bg-icon text-info"></i>`;
  
  return ``;
}

function showDetail(task) {
    lastScrollPosition = window.scrollY;

    const taskListEl = document.getElementById("taskList");
    const paginationEl = document.getElementById("pagination");
    const filterBarEl = document.getElementById("filterBar");
    const detailEl = document.getElementById("taskDetail");
    const aboutEl = document.getElementById("aboutSection");

    taskListEl.style.display = "none";
    paginationEl.style.display = "none";
    filterBarEl.style.display = "none";
    aboutEl.style.display = "none";
    detailEl.style.display = "block";

    window.scrollTo({ top: 0, behavior: 'smooth' });

    const cardTitle = task["Task Name"];
    const folderName = task["Folder Name"].toLowerCase();
    
    const status = task["Status"].toLowerCase();
    const dateAssigned = formatDate(task._dateParsed);
    const sbsNote = task["TM's Note"] || "";
    const clickUpLink = task["Click Up Link"];
    
    const categories = { 
        "Validation": [ "[brand]-validating-data for new supplier", "[brand]-validating-upc list source" ], 
        "Analysis": [ "[brand]-analyzing-task prioritization", "[brand]-analyzing-new supplier source", "[brand]-analyzing-existing supplier source", "[brand]-analyzing-bulk order source", "[brand]-analyzing-prebook order source", "[brand]-analyzing-inventory for deletion", "[brand]-analyzing-listing loader request", "[brand]-analyzing-shopify source", "analyzing-manage experiment", "[brand]-analyzing-shopkeep source" ], 
        "Gathering Data": [ "[brand]-gathering-new supplier data", "[brand]-gathering-existing supplier data", "[brand]-gathering-bulk/preebook data", "[brand]-gathering-enhancement data", "[brand]-gathering-flat file data", "[brand]-gathering-pre existing asins", "[brand]-gathering-skus for deletion", "[brand]-gathering-brand store data", "[brand]-gathering-shopify data", "[brand]-gathering-shopkeep data", "[brand]-gathering-skus for deletion", "[brand]-gathering-SIPV", "[brand]-gathering-manage experiment", "all brands-gathering-voice of the customer", "all brands-gathering-suppressed listings", "all brands-gathering-stranded listings", "all brands-gathering-standalone listings" ], 
        "Creation": [ "[brand]-creating-new supplier masterlist", "[brand]-creating-existing supplier masterlist", "[brand]-creating- bulk/prebook masterlist", "[brand]-creating-new supplier listing loader file", "[brand]-creating-existing supplier listing loader file", "[brand]-creating-bulk/prebook listing loader file", "[brand]-creating-new supplier ilf", "[brand]-creating-existing supplier ilf", "[brand]-creating-bulk/prebook ilf", "[brand]-creating-new supplier cost sheet", "[brand]-creating-new supplier sku upc list", "[brand]-creating-existing supplier cost sheet", "[brand]-creating-existing supplier sku upc list", "[brand]-creating-bulk/prebook cost sheet", "[brand]-creating-bulk/prebook sku upc list", "[brand]-creating-existing supplier advertising campaign list", "[brand]-creating-flat file enhancement", "[brand]-creating-flat file listing concern", "creating-manage experiment", "[brand]-creating-ebc enhancement" ], 
        "Verification / Image Update": [ "[brand]-verifying-upc match manual", "[brand]-verifying-data central result", "[brand]-verifying-listing loader request", "[brand]-verifying-image urls", "[brand]-enhancing-images for enhancement", "[brand]-updating-sas flat file", "[brand]-updating-listing in amazon", "[brand]-updating-edit page manually enhancement" ], 
        "Review / Upload": [ "[brand]-reviewing-all files", "[brand]-reviewing-newly uploaded listings","[brand]-reviewing-newly uploaded listings enhancement", "[brand]-uploading-ilf", "[brand]-uploading-flat file", "[brand]-uploading-shipping plan", "[brand]-uploading-weights and dimensions", "[brand]-uploading-video", "[brand]-uploading-images", "[brand]-attaching-files in bc", "[brand]-reviewing-all files enhancement", "[brand]-attaching-files in bc enhancement", "[brand]-uploading-flat file enhancement", "[brand]-uploading-video enhancement" ], 
        "Investigation / Fixing / Correction": [ "[brand]-investigating-listing issue", "[brand]-fixing-suppressed/quality alerts", "[brand]-fixing-stranded inventory", "[brand]-fixing-standalone", "[brand]-correcting-masterlist file", "[brand]-correcting-ilf", "[brand]-correcting-cost sheet", "[brand]-correcting-sku-upc list", "[brand]-correcting-flatfile error", "[brand]-investigating-pesticide marking", "[brand]-fixing-listing issue", "[brand]-investigating-listing enhancement", "[brand]-correcting-flatfile error enhancement", "[brand]-investigating-SIP", "[brand]-investigating-policy warning", "[brand]-investigating-inaccurate condition complaint" ], 
        "Update / Send & Monitor Case": [ "[brand]-updating-trackers", "[brand]-updating-ebc", "[brand]-updating-search terms", "[brand]-sending-amazon case", "[brand]-sending-sas email", "[brand]-checking-amazon case & ff ups", "[brand]-checking-sas response", "[brand]-sending-sas ops", "[brand]-sending-amazon case enhancement", "[brand]-checking-amazon case & ff ups enhancement", "[brand]-updating-ebc enhancement", "[brand]-updating-search terms enhancement", "[brand]-sending-appeal" ], 
        "Monitoring": [ "none-checking-skype concerns", "none-checking-email concerns", "none-checking-basecamp notifications", "none-prioritizing tasks", "none-addressing-concerns-via skype", "none-addressing-concerns-via email", "none-addressing-concerns-via basecamp", "[brand]-logging-in 2P account", "[brand]-logging-in 1P account" ], 
        "Admin": [ "admin-break", "admin-training:[task]-{person}", "admin-feedbacking-[name of person/group]", "admin-assisting-[task] [name of person/group]", "admin-meeting-{name of person/group}", "admin-coaching-{name of person/group}", "sbs-certifying-[task name]-[name of agent]", "admin-observing:[task]-[name of person]", "admin-meeting-team-listing ex", "admin-1on1-[name]", "[brand]-creating-flat file", "[brand]-updating-listing in amazon (manual)", "[brand]-creating-listing in amazon (manual)", "[brand]-creating-deletion file", "[brand]-gathering-images for EBC", "[brand]-creating-ebc enhancement", "[brand]-updating-ebc enhancement", "[brand]-certify-" ] 
    };

    let rendered = "";
    for (const [header, items] of Object.entries(categories)) {
        const processed = items.map(t => {
            const lower = t.toLowerCase();
            if (lower.startsWith("admin") || lower.startsWith("none")) return t;
            if (t.includes("[brand]")) {
                return t.replace(/\[brand\]/g, folderName) + ` (${cardTitle})`;
            }
            return t;
        });

        rendered += `
        <h6 class="mt-3 mb-2 fw-bold text-primary">${header}</h6>
        <div class="row">
            ${processed.map(item => `
                <div class="col-md-6 mb-2">
                    <div class="task-item d-flex align-items-center border rounded px-2 py-1 small bg-light text-truncate" title="Click to copy">
                        <span class="flex-grow-1 me-2">${item}</span>
                    </div>
                </div>
            `).join("")}
        </div>
        `;
    }

    detailEl.innerHTML = `
    <div class="detail-header d-flex justify-content-between align-items-center mb-3">
        <div class="d-flex align-items-center gap-3">
          <button class="btn btn-sm btn-outline-secondary" id="backBtn">
            <i class="bi bi-arrow-left"></i> Back to Tasks
          </button>
          <label class="toggle-switch">
            <input type="checkbox" id="logToggle" onchange="toggleLog(this)">
            <span class="slider"></span>
          </label>
          <span class="fw-bold text-secondary">Working?</span>
        </div>

        ${
          folderName === "vertx"
            ? `<div class="d-flex align-items-center gap-2">
                 <span class="fw-bold text-secondary">Tool:</span>
                 <a href="https://donz567.github.io/whiteeditor/" target="_blank" 
                    class="btn btn-outline-primary rounded-pill px-2 py-1">Image Editor</a>
               </div>`
            : ""
        }
    </div>
    
    <h5 class="mb-2" id="detailTitle">${cardTitle}</h5>
    <div class="mb-3 d-flex flex-wrap gap-1 align-items-center" style="font-size: 0.8rem;">
        <span class="badge bg-primary" id="detailFolder">${folderName}</span>
        <span class="badge bg-warning text-dark">${toProperCase(task["Tags"])}</span>
        <span class="badge bg-success label-subtask-text">${task["List Name"]}</span>
        <span class="badge ${sanitizeStatusClass(status)}">${toProperCase(status)}</span>
        ${sbsNote ? `<span class="badge bg-secondary text-white">${sbsNote}</span>` : ""}
        <span class="text-muted"><i class="bi bi-calendar-event"></i> ${dateAssigned}</span>
        
        ${clickUpLink !== "#" 
            ? `<a href="${clickUpLink}" target="clickup_tab" class="badge bg-info text-dark text-decoration-none ms-2 px-2 border border-info rounded-pill"><i class="bi bi-link-45deg"></i> Open ClickUp</a>` 
            : `<span class="badge bg-light text-muted ms-2 px-2 border rounded-pill"><i class="bi bi-link-45deg"></i> No Link Found</span>`
        }
    </div>

    <div class="d-flex flex-wrap gap-2 mb-2" id="bubbleContainer"></div>

    <input type="text" class="form-control form-control-sm mb-3" id="templateSearch" autocomplete="off" placeholder="Type to search... (Auto-saves after 2 seconds)">
    
    <div id="templateList">${rendered}</div>
    `;

    const searchInput = document.getElementById("templateSearch");
    let debounceTimer; 
    
    function refreshBubbles() {
        let recentSearches = JSON.parse(localStorage.getItem("exclusiveTM_recentSearches") || "[]");
        
        recentSearches = recentSearches.filter((item, index, self) =>
            index === self.findIndex((t) => (t.toLowerCase() === item.toLowerCase()))
        );

        if (recentSearches.length > 15) {
            recentSearches = recentSearches.slice(0, 15);
            localStorage.setItem("exclusiveTM_recentSearches", JSON.stringify(recentSearches));
        }

        if (recentSearches.length === 0) {
            recentSearches = ["Validating", "Analyzing", "Gathering", "Creation", "Admin"];
        }

        const bubblesHtml = recentSearches.map(term => 
            `<button type="button" class="btn btn-sm btn-outline-primary rounded-pill search-bubble mb-1" style="font-size: 0.75rem;">${term}</button>`
        ).join(" ");

        const container = document.getElementById("bubbleContainer");
        container.innerHTML = bubblesHtml;

        container.querySelectorAll(".search-bubble").forEach(btn => {
            btn.addEventListener("click", () => {
                const val = btn.textContent;
                searchInput.value = val;
                performSearch(val);
            });
        });
    }

    function performSearch(term) {
        const lowerTerm = term.toLowerCase();
        document.querySelectorAll("#templateList h6").forEach(header => {
            const section = header.nextElementSibling;
            let anyVisible = false;
            section.querySelectorAll(".col-md-6").forEach(div => {
                const match = div.innerText.toLowerCase().includes(lowerTerm);
                div.style.display = match ? "" : "none";
                if (match) anyVisible = true;
            });
            header.style.display = anyVisible ? "" : "none";
            section.style.display = anyVisible ? "" : "none";
        });
    }

    searchInput.addEventListener("input", (e) => {
        const val = e.target.value;
        
        performSearch(val);

        clearTimeout(debounceTimer);

        debounceTimer = setTimeout(() => {
            const trimmedVal = val.trim();
            if (trimmedVal.length > 2) {
                let history = JSON.parse(localStorage.getItem("exclusiveTM_recentSearches") || "[]");
                history = history.filter(h => h.toLowerCase() !== trimmedVal.toLowerCase());
                history.unshift(trimmedVal);
                
                if (history.length > 15) history = history.slice(0, 15);
                
                localStorage.setItem("exclusiveTM_recentSearches", JSON.stringify(history));
                
                refreshBubbles();
            }
        }, 2000); 
    });

    refreshBubbles();

    const titleEl = detailEl.querySelector("#detailTitle");
    titleEl.addEventListener("click", () => {
        navigator.clipboard.writeText(titleEl.textContent.trim()).then(() => showCopied(titleEl));
    });

    detailEl.querySelectorAll(".task-item").forEach(item => {
        item.addEventListener("click", e => {
            e.stopPropagation();
            navigator.clipboard.writeText(item.querySelector("span").innerText).then(() => showCopied(item));
        });
    });

    function showCopied(element) {
        const old = element.querySelector(".copied-indicator");
        if (old) old.remove();
        const indicator = document.createElement("span");
        indicator.className = "copied-indicator";
        indicator.innerText = "✅ Copied!";
        indicator.style.marginLeft = "8px"; 
        indicator.style.color = "#28a745";
        element.appendChild(indicator);
        setTimeout(() => indicator.remove(), 1000);
    }

    document.getElementById("backBtn").addEventListener("click", () => {
        taskListEl.style.display = "grid";
        paginationEl.style.display = "flex";
        filterBarEl.style.display = "flex";
        detailEl.style.display = "none";
        aboutEl.style.display = "none";
        filterTasks();
        window.scrollTo({ top: lastScrollPosition, behavior: 'auto' });
    });

    checkLogToggle();
}

function toggleLog(toggleEl) {
  const taskTitle = document.getElementById("detailTitle")?.textContent?.trim() || "Unknown Task";
  const folderName = document.getElementById("detailFolder")?.textContent?.trim() || "Unknown Folder";
  const listName = document.querySelector("#taskDetail .label-subtask-text")?.textContent?.trim() || "N/A";

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  let logs = JSON.parse(localStorage.getItem("exclusiveTM_taskLogs") || "[]");

  if (toggleEl.checked) {
    const already = logs.some(l => l.date === dateStr && l.task === taskTitle && l.folder === folderName);
    if (!already) {
      logs.push({
        date: dateStr,
        task: taskTitle,
        folder: folderName,
        listname: listName,
        timestamp: now.toISOString(),
      });
      localStorage.setItem("exclusiveTM_taskLogs", JSON.stringify(logs));
      showBanner(`Logged "${taskTitle}"`, "info");
    }
  } else {
    logs = logs.filter(l => !(l.date === dateStr && l.task === taskTitle && l.folder === folderName));
    localStorage.setItem("exclusiveTM_taskLogs", JSON.stringify(logs));
    showBanner(`Removed "${taskTitle}"`, "secondary");
  }
}

function checkLogToggle() {
  const toggle = document.getElementById("logToggle");
  if (!toggle) return;

  const taskTitle = document.getElementById("detailTitle")?.textContent?.trim() || "";
  const folderName = document.getElementById("detailFolder")?.textContent?.trim() || "";

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  const logs = JSON.parse(localStorage.getItem("exclusiveTM_taskLogs") || "[]");
  const already = logs.some(l => l.date === dateStr && l.task === taskTitle && l.folder === folderName);

  toggle.checked = already;
  const label = document.querySelector('.fw-bold.text-secondary');
  
  if (toggle.checked) {
    label.style.color = '#0d6efd';
    label.style.textShadow = '0 0 8px rgba(13,110,253,0.6)';
  } else {
    label.style.color = '#6c757d';
    label.style.textShadow = 'none';
  }
  toggle.disabled = false; 
}

(function cleanOldLogs() {
  const now = new Date();
  const hour = now.getHours();
  
  if (hour >= 13) {
    let logs = JSON.parse(localStorage.getItem("exclusiveTM_taskLogs") || "[]");
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    
    logs = logs.filter(l => l.date === todayStr);
    localStorage.setItem("exclusiveTM_taskLogs", JSON.stringify(logs));
  }
})();

document.getElementById("viewLogsBtn")?.addEventListener("click", showLogs);

function showLogs() {
  const logsTableContainer = document.getElementById("logsTableContainer");
  const logStatsContainer = document.getElementById("logStatsContainer");
  const logs = JSON.parse(localStorage.getItem("exclusiveTM_taskLogs") || "[]");

  if (!Array.isArray(logs) || logs.length === 0) {
    logStatsContainer.innerHTML = "";
    logsTableContainer.innerHTML = `<p class="text-center text-muted mb-0">No logs recorded yet.</p>`;
    return;
  }

  // --- LOG STATISTICS DASHBOARD ---
  let totalLogs = logs.length;
  let completedLogs = logs.filter(l => l.status === "Complete" || l.status === "Completed").length;
  let ongoingLogs = logs.filter(l => (l.status || "").toLowerCase().includes("ongoing")).length;
  
  let folderCounts = {};
  let topFolder = "N/A", topCount = 0;
  logs.forEach(l => {
      if(l.folder) {
          folderCounts[l.folder] = (folderCounts[l.folder] || 0) + 1;
          if(folderCounts[l.folder] > topCount) {
              topCount = folderCounts[l.folder];
              topFolder = l.folder;
          }
      }
  });

  logStatsContainer.innerHTML = `
      <div class="col-md-3 mb-2">
          <div class="p-2 bg-primary bg-opacity-10 border border-primary border-opacity-25 rounded shadow-sm">
              <h5 class="text-primary mb-0 fw-bold">${totalLogs}</h5>
              <span class="text-muted fw-bold" style="font-size: 0.75rem;">Total Logged</span>
          </div>
      </div>
      <div class="col-md-3 mb-2">
          <div class="p-2 bg-success bg-opacity-10 border border-success border-opacity-25 rounded shadow-sm">
              <h5 class="text-success mb-0 fw-bold">${completedLogs}</h5>
              <span class="text-muted fw-bold" style="font-size: 0.75rem;">Completed</span>
          </div>
      </div>
      <div class="col-md-3 mb-2">
          <div class="p-2 bg-warning bg-opacity-10 border border-warning border-opacity-25 rounded shadow-sm">
              <h5 class="text-warning mb-0 fw-bold">${ongoingLogs}</h5>
              <span class="text-muted fw-bold" style="font-size: 0.75rem;">Ongoing</span>
          </div>
      </div>
      <div class="col-md-3 mb-2">
          <div class="p-2 bg-info bg-opacity-10 border border-info border-opacity-25 rounded shadow-sm">
              <h5 class="text-info mb-0 fw-bold text-truncate" title="${topFolder}">${topFolder}</h5>
              <span class="text-muted fw-bold" style="font-size: 0.75rem;">Top Brand</span>
          </div>
      </div>
  `;

  let html = `
    <table class="table table-striped align-middle">
      <thead class="table-light">
        <tr>
          <th>Date</th>
          <th>Brand Name</th>
          <th>List Name</th> <th>Task Name</th> <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
  `;

  logs.forEach((log, index) => {
    const currentStatus = log.status || "";
    const isCustom =
      currentStatus &&
      !["Complete", "Ongoing"].includes(currentStatus);

    html += `
      <tr>
        <td>${log.date || "N/A"}</td>
        <td><span class="badge bg-secondary">${log.folder || "N/A"}</span></td>
        <td>${log.listname || "N/A"}</td>
        <td>${log.task || "N/A"}</td>
        <td><span class="badge ${currentStatus === 'Complete' ? 'bg-success' : currentStatus === 'Ongoing' ? 'bg-warning text-dark' : 'bg-info'}">${log.status || "N/A"}</span></td>
        <td>
          <div class="d-flex flex-wrap gap-2 align-items-center">
            <button type="button" class="btn btn-sm btn-success" onclick="updateLogStatus(${index}, 'Complete')">Complete</button>
            <button type="button" class="btn btn-sm btn-warning" onclick="updateLogStatus(${index}, 'Ongoing')">Ongoing</button>
            <div class="d-flex align-items-center flex-grow-1">
              <input 
                type="text" 
                class="form-control form-control-sm me-2" 
                id="customInput-${index}" 
                placeholder="Custom status..."
                value="${isCustom ? currentStatus : ''}"
                oninput="toggleSubmitButton(${index})"
              >
              <button 
                id="submitBtn-${index}" 
                class="btn btn-sm btn-primary" 
                style="display:${isCustom ? 'inline-block' : 'none'}"
                onclick="submitCustomStatus(${index})"
              >
                Submit
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
  });

  html += "</tbody></table>";
  logsTableContainer.innerHTML = html;
}

function toggleSubmitButton(index) {
  const input = document.getElementById(`customInput-${index}`);
  const btn = document.getElementById(`submitBtn-${index}`);
  btn.style.display = input.value.trim() ? "inline-block" : "none";
}

function submitCustomStatus(index) {
  const input = document.getElementById(`customInput-${index}`);
  const logs = JSON.parse(localStorage.getItem("exclusiveTM_taskLogs") || "[]");

  if (!logs[index]) return;
  logs[index].status = input.value.trim();
  localStorage.setItem("exclusiveTM_taskLogs", JSON.stringify(logs));

  showBanner("Custom status saved!", "success");
  showLogs();
}

function updateLogStatus(index, newStatus) {
  const logs = JSON.parse(localStorage.getItem("exclusiveTM_taskLogs") || "[]");
  if (!logs[index]) return;

  logs[index].status = newStatus;
  localStorage.setItem("exclusiveTM_taskLogs", JSON.stringify(logs));

  showBanner(`Marked as ${newStatus}!`, newStatus === "Complete" ? "success" : "warning");
  showLogs();
}

document.getElementById("viewLogsBtn").addEventListener("click", () => {
  showLogs();
  const modal = new bootstrap.Modal(document.getElementById("logsModal"));
  modal.show();
});

function renderPagination(totalPages){
    const pagination = document.getElementById("pagination");
    pagination.innerHTML="";
    if(totalPages<=1) return;
    pagination.innerHTML += `<li class="page-item ${currentPage===1?'disabled':''}"><a class="page-link" href="#" data-page="${currentPage-1}">Prev</a></li>`;
    let startPage = Math.max(1,currentPage-2);
    let endPage = Math.min(totalPages,currentPage+2);
    if(currentPage<=3) endPage=Math.min(5,totalPages);
    if(currentPage>=totalPages-2) startPage=Math.max(totalPages-4,1);
    for(let i=startPage;i<=endPage;i++){
        pagination.innerHTML += `<li class="page-item ${i===currentPage?'active':''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
    }
    pagination.innerHTML += `<li class="page-item ${currentPage===totalPages?'disabled':''}"><a class="page-link" href="#" data-page="${currentPage+1}">Next</a></li>`;
    document.querySelectorAll("#pagination .page-link").forEach(link=>{
        link.addEventListener("click",(e)=>{
            e.preventDefault();
            const page=parseInt(link.getAttribute("data-page"));
            if(page>=1 && page<=totalPages){ currentPage=page; filterTasks(); }
        });
    });
}

function showBanner(message, type="success") {
    const toastContainer = document.getElementById("toastContainer");
    
    let bgClass = "bg-success text-white";
    let closeBtnClass = "btn-close-white";
    
    if(type === "info") { bgClass = "bg-primary text-white"; }
    if(type === "warning") { bgClass = "bg-warning text-dark"; closeBtnClass = ""; }
    if(type === "secondary") { bgClass = "bg-secondary text-white"; }

    const toastEl = document.createElement("div");
    toastEl.className = `toast align-items-center border-0 ${bgClass} shadow-lg mb-2`;
    toastEl.setAttribute("role", "alert");
    toastEl.setAttribute("aria-live", "assertive");
    toastEl.setAttribute("aria-atomic", "true");
    
    toastEl.innerHTML = `
      <div class="d-flex">
        <div class="toast-body fw-bold">
          ${message}
        </div>
        <button type="button" class="btn-close ${closeBtnClass} me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    `;
    
    toastContainer.appendChild(toastEl);
    const toast = new bootstrap.Toast(toastEl, { delay: 3500 });
    toast.show();
    
    toastEl.addEventListener('hidden.bs.toast', () => {
        toastEl.remove();
    });
}

function generateWorkLog() {
  const logs = JSON.parse(localStorage.getItem("exclusiveTM_taskLogs") || "[]");
  if (logs.length === 0) {
    showBanner("No logs to generate.", "warning");
    return;
  }

  const reportDate = logs[0].date || new Date().toISOString().split("T")[0];

  const headers = ["Brand Name", "List Name", "Task Name", "Status"];

  const rows = logs.map(l => {
    const folder = toProperCase(l.folder || "");
    const listCategory = l.listname || ""; 
    const taskTitle = l.task || "";        
    const status = l.status || "";

    const escape = (txt) => `"${txt.replace(/"/g, '""')}"`;

    return `${escape(folder)},${escape(listCategory)},${escape(taskTitle)},${escape(status)}`;
  });

  const csvContent = `Date: ${reportDate}\n` + [headers.join(","), ...rows].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);

  const estDate = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" }).replace(/\//g, "-");
  link.setAttribute("download", `DailyReport_${estDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  localStorage.removeItem("exclusiveTM_taskLogs");
  showBanner("Work log generated and cleared!", "success");

  checkLogToggle(); 
  
  const modalEl = document.getElementById("logsModal");
  const modalObj = bootstrap.Modal.getInstance(modalEl);
  if(modalObj) modalObj.hide();
  filterTasks();
}

document.getElementById("generateLogBtn")?.addEventListener("click", generateWorkLog);

function updateLastUpdated(){
    const now=new Date();
    document.getElementById("lastUpdated").innerText=`Updated: ${now.toLocaleTimeString()}`;
}

function logout(){ localStorage.removeItem("exclusiveTM_agent"); location.reload(); }

document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        newTaskCount = 0;
        updateFavicon(0);
    }
});

// ==========================================
// --- GAME MENU HUB ---
// ==========================================
function openGameMenu() {
    document.getElementById("gameMenuContainer").style.display = "flex";
}

function closeGameMenu() {
    document.getElementById("gameMenuContainer").style.display = "none";
}

const allMazeMaps = [
    [ // Map 1: The Snake
        "11111111111111111111",
        "12000000110000000001",
        "11111100110011111101",
        "10000000110011000001",
        "10111111110011001111",
        "10110000000000000001",
        "10110011111111111101",
        "10000011000000001101",
        "11111111001111000031",
        "11111111111111111111"
    ],
    [ // Map 2: The Spiral (Corrected to have a continuous path)
        "11111111111111111111",
        "12000000000000000001",
        "10111111111111111101",
        "10000000000000000101",
        "10111111111111110101",
        "10100300000000010101",
        "10101111111111110101",
        "10100000000000000101",
        "10000000000000000001",
        "11111111111111111111"
    ],
    [ // Map 3: Split Path
        "11111111111111111111",
        "12000110000000111111",
        "11110110111110111111",
        "11110000111110111111",
        "11111111111110111111",
        "11111110000000111111",
        "11111110111111111111",
        "11111110111111110031",
        "11111110000000000011",
        "11111111111111111111"
    ],
    [ // Map 4: Choke Points
        "11111111111111111111",
        "12011111111111111111",
        "11011111111111111111",
        "11000111111000000111",
        "11110111111011110111",
        "11110000000011110111",
        "11111111111111110111",
        "11111111111111110031",
        "11111111111111111111",
        "11111111111111111111"
    ],
    [ // Map 5: Checkerboard
        "11111111111111111111",
        "12001100110011001101",
        "11101101110111011101",
        "10000000000000000001",
        "10111011101110111011",
        "10111011101110111011",
        "10000000000000000001",
        "11011101110111011101",
        "11001100110011001131",
        "11111111111111111111"
    ],
    [ // Map 6: The Labyrinth (New)
        "11111111111111111111",
        "12010000010000000001",
        "11010111010111111101",
        "10000100010100000101",
        "10111101110101110101",
        "10000001000001000001",
        "11111111011111011111",
        "10000000010000010031",
        "10111111111111111111",
        "11111111111111111111"
    ],
    [ // Map 7: Zig Zag (New)
        "11111111111111111111",
        "12000000000000000001",
        "11111111111111111101",
        "10000000000000000001",
        "10111111111111111111",
        "10000000000000000001",
        "11111111111111111101",
        "13000000000000000001",
        "11111111111111111111",
        "11111111111111111111"
    ]
];

let mazeActive = false;
let mazeState = 'waiting';
let mazeHearts = 3;
let currentMazeLevel = 0;
let selectedMazeIndices = [];
let currentMap = null;
let mazeCellW = 0;
let mazeCellH = 0;
let mazeLastX = -1000, mazeLastY = -1000;

const mCanvas = document.getElementById('mazeCanvas');
const mCtx = mCanvas.getContext('2d');

function startMazeGame() {
    closeGameMenu();
    let indices = [0, 1, 2, 3, 4];
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    selectedMazeIndices = indices.slice(0, 3);
    
    mazeHearts = 3;
    currentMazeLevel = 0;
    document.getElementById('mazeHearts').innerText = "❤️❤️❤️";
    document.getElementById('mazeContainer').style.display = "block";
    
    mazeActive = true;
    mazeLastX = mouse.x;
    mazeLastY = mouse.y;
    loadMazeLevel();
}

function stopMazeGame() {
    mazeActive = false;
    document.getElementById('mazeContainer').style.display = "none";
}

function loadMazeLevel() {
    currentMap = allMazeMaps[selectedMazeIndices[currentMazeLevel]];
    drawMazeStatic();
    
    document.getElementById('mazeLevel').innerText = currentMazeLevel + 1;
    mazeState = 'waiting';
    
    const msg = document.getElementById('mazeMessage');
    msg.innerText = "Move to the Green START Area!";
    msg.style.color = "white";
    msg.style.opacity = "1";
}

function drawMazeStatic() {
    mCanvas.width = window.innerWidth;
    mCanvas.height = window.innerHeight;
    mazeCellW = mCanvas.width / 20;
    mazeCellH = mCanvas.height / 10;
    
    mCtx.clearRect(0, 0, mCanvas.width, mCanvas.height);
    
    for(let r = 0; r < 10; r++) {
        for(let c = 0; c < 20; c++) {
            const type = currentMap[r][c];
            if(type === '1') { // Wall
                mCtx.fillStyle = '#1a1d20'; 
                mCtx.strokeStyle = '#0dcaf0'; 
                mCtx.lineWidth = 2;
                mCtx.fillRect(c*mazeCellW, r*mazeCellH, mazeCellW, mazeCellH);
                mCtx.strokeRect(c*mazeCellW, r*mazeCellH, mazeCellW, mazeCellH);
            } else if(type === '2') { // Start
                mCtx.fillStyle = 'rgba(25, 135, 84, 0.7)'; 
                mCtx.fillRect(c*mazeCellW, r*mazeCellH, mazeCellW, mazeCellH);
                mCtx.fillStyle = '#fff';
                mCtx.font = "bold 20px Arial";
                mCtx.textAlign = "center";
                mCtx.fillText("START", c*mazeCellW + mazeCellW/2, r*mazeCellH + mazeCellH/2 + 7);
            } else if(type === '3') { // End
                mCtx.fillStyle = 'rgba(255, 193, 7, 0.7)'; 
                mCtx.fillRect(c*mazeCellW, r*mazeCellH, mazeCellW, mazeCellH);
                mCtx.fillStyle = '#fff';
                mCtx.font = "bold 20px Arial";
                mCtx.textAlign = "center";
                mCtx.fillText("END", c*mazeCellW + mazeCellW/2, r*mazeCellH + mazeCellH/2 + 7);
            }
        }
    }
}

function loseMazeHeart() {
    mazeHearts--;
    document.getElementById('mazeHearts').innerText = "❤️".repeat(mazeHearts) + "🖤".repeat(3 - mazeHearts);
    
    const msg = document.getElementById('mazeMessage');
    msg.style.opacity = "1";
    
    if (mazeHearts <= 0) {
        mazeActive = false;
        msg.innerText = "💀 GAME OVER 💀";
        msg.style.color = "#dc3545";
        setTimeout(stopMazeGame, 2000);
    } else {
        mazeState = 'waiting';
        msg.innerText = "Ouch! Move back to the START zone.";
        msg.style.color = "#dc3545";
    }
}

function winMazeLevel() {
    mazeState = 'waiting';
    currentMazeLevel++;
    const msg = document.getElementById('mazeMessage');
    msg.style.opacity = "1";
    
    if (currentMazeLevel >= 3) {
        mazeActive = false;
        msg.innerText = "🎉 YOU ESCAPED! 🎉";
        msg.style.color = "#198754";
        setTimeout(stopMazeGame, 3000);
    } else {
        msg.innerText = "Good Job! Loading next level...";
        msg.style.color = "#20c997";
        setTimeout(() => { loadMazeLevel(); }, 1500);
    }
}

// ==========================================
// --- BALL VS BRICK GAME LOGIC ---
// ==========================================
const bCanvas = document.getElementById('brickCanvas');
const bCtx = bCanvas.getContext('2d');
let brickActive = false;
let bReqId;
let bScore = 0;
let bLives = 3;

let bBall = { x: 0, y: 0, dx: 6, dy: -6, radius: 10 };
let bPaddle = { w: 120, h: 15, x: 0 };
let bBricks = [];
let bCols = 10, bRows = 6;
let bPowerUps = [];

const POWERUP_TYPES = ['expand', 'shrink', 'slow', 'life'];

function startBrickGame() {
    closeGameMenu();
    brickActive = true;
    bScore = 0;
    bLives = 3;
    document.getElementById('brickContainer').style.display = "block";
    document.getElementById('brickMessage').style.display = "none";
    updateBrickUI();
    initBrickLevel();
    drawBrickGame();
}

function stopBrickGame() {
    brickActive = false;
    cancelAnimationFrame(bReqId);
    document.getElementById('brickContainer').style.display = "none";
}

function initBrickLevel() {
    bCanvas.width = window.innerWidth;
    bCanvas.height = window.innerHeight;

    bBall.x = bCanvas.width / 2;
    bBall.y = bCanvas.height - 60;
    bBall.dx = (Math.random() > 0.5 ? 6 : -6);
    bBall.dy = -6;

    bPaddle.w = 120; // reset size
    bPaddle.x = (bCanvas.width - bPaddle.w) / 2;
    
    bPowerUps = []; // clear powerups

    let totalPadding = (bCols + 1) * 15;
    let brickW = (bCanvas.width - totalPadding) / bCols;
    let brickH = 30;

    bBricks = [];
    for(let c=0; c<bCols; c++) {
        bBricks[c] = [];
        for(let r=0; r<bRows; r++) {
            let bX = (c * (brickW + 15)) + 15;
            let bY = (r * (brickH + 15)) + 60;
            
            // Generate Map Pattern
            let bType = 1; // Normal (1 hit)
            if (r === 0 && c % 3 === 0) bType = -1; // Solid
            else if (r === 1 || (r === 2 && c % 2 === 0)) bType = 2; // Hard (2 hits)
            
            bBricks[c][r] = { x: bX, y: bY, status: bType, w: brickW, h: brickH };
        }
    }
}

function updateBrickUI() {
    document.getElementById('brickScore').innerText = bScore;
    document.getElementById('brickLives').innerText = "❤️".repeat(Math.min(5, bLives)) + (bLives < 3 ? "🖤".repeat(3 - bLives) : "");
}

function spawnPowerUp(x, y) {
    if (Math.random() < 0.25) { // 25% chance
        const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
        let icon = "⭐";
        if (type === 'expand') icon = "↔️";
        if (type === 'shrink') icon = "><";
        if (type === 'slow') icon = "🐢";
        if (type === 'life') icon = "❤️";
        
        bPowerUps.push({ x: x, y: y, type: type, icon: icon, dy: 3 });
    }
}

function applyPowerUp(type) {
    if (type === 'expand') bPaddle.w = Math.min(bPaddle.w + 40, 300);
    if (type === 'shrink') bPaddle.w = Math.max(bPaddle.w - 30, 60);
    if (type === 'life') { bLives++; updateBrickUI(); }
    if (type === 'slow') {
        let speed = Math.hypot(bBall.dx, bBall.dy);
        if (speed > 5) {
            bBall.dx *= 0.8;
            bBall.dy *= 0.8;
        }
    }
}

function drawBrickGame() {
    if(!brickActive) return;

    bCtx.clearRect(0, 0, bCanvas.width, bCanvas.height);

    // Draw Bricks
    for(let c=0; c<bCols; c++) {
        for(let r=0; r<bRows; r++) {
            let b = bBricks[c][r];
            if(b.status !== 0) {
                if (b.status === -1) {
                    bCtx.fillStyle = "#6c757d"; // Gray (Solid)
                } else if (b.status === 2) {
                    bCtx.fillStyle = "#fd7e14"; // Orange (Hard)
                } else {
                    bCtx.fillStyle = `hsl(${(c * 30 + r * 15)}, 100%, 60%)`; // Normal
                }
                
                bCtx.fillRect(b.x, b.y, b.w, b.h);
                bCtx.strokeStyle = "rgba(255,255,255,0.3)";
                bCtx.strokeRect(b.x, b.y, b.w, b.h);
            }
        }
    }

    // Draw PowerUps
    for (let i = bPowerUps.length - 1; i >= 0; i--) {
        let p = bPowerUps[i];
        p.y += p.dy;
        bCtx.font = "24px Arial";
        bCtx.textAlign = "center";
        bCtx.fillText(p.icon, p.x, p.y);
        
        // Paddle Collision for PowerUp
        if (p.y > bCanvas.height - 20 - bPaddle.h && p.x > bPaddle.x && p.x < bPaddle.x + bPaddle.w) {
            applyPowerUp(p.type);
            bPowerUps.splice(i, 1);
        } else if (p.y > bCanvas.height) {
            bPowerUps.splice(i, 1); // Missed it
        }
    }

    // Draw Paddle
    bCtx.fillStyle = "#0dcaf0";
    bCtx.shadowColor = "#0dcaf0";
    bCtx.shadowBlur = 10;
    bCtx.fillRect(bPaddle.x, bCanvas.height - bPaddle.h - 20, bPaddle.w, bPaddle.h);
    bCtx.shadowBlur = 0; // reset

    // Draw Ball
    bCtx.beginPath();
    bCtx.arc(bBall.x, bBall.y, bBall.radius, 0, Math.PI*2);
    bCtx.fillStyle = "#ffc107";
    bCtx.fill();
    bCtx.closePath();

    // Collision Logic: Walls
    if(bBall.x + bBall.dx > bCanvas.width - bBall.radius || bBall.x + bBall.dx < bBall.radius) {
        bBall.dx = -bBall.dx;
    }
    if(bBall.y + bBall.dy < bBall.radius) {
        bBall.dy = -bBall.dy;
    } else if(bBall.y + bBall.dy > bCanvas.height - bBall.radius - 20 - bPaddle.h) {
        // Paddle Hit
        if(bBall.x > bPaddle.x && bBall.x < bPaddle.x + bPaddle.w) {
            bBall.dy = -Math.abs(bBall.dy); // Force it upwards
            let hitPoint = bBall.x - (bPaddle.x + bPaddle.w/2);
            bBall.dx = hitPoint * 0.15;
            
            // Gradually speed ball up to make it harder
            let speed = Math.hypot(bBall.dx, bBall.dy);
            if (speed < 12) {
                bBall.dx *= 1.05;
                bBall.dy *= 1.05;
            }
        } else if(bBall.y + bBall.dy > bCanvas.height - bBall.radius) {
            // Missed
            bLives--;
            bPowerUps = []; // Clear falling items
            updateBrickUI();
            if(!bLives) {
                document.getElementById('brickMessage').innerText = "GAME OVER";
                document.getElementById('brickMessage').style.display = "block";
                setTimeout(stopBrickGame, 2500);
                return;
            } else {
                bBall.x = bCanvas.width/2;
                bBall.y = bCanvas.height-60;
                bBall.dx = (Math.random() > 0.5 ? 6 : -6);
                bBall.dy = -6;
                bPaddle.w = 120; // reset paddle on death
                bPaddle.x = (bCanvas.width-bPaddle.w)/2;
            }
        }
    }

    // Collision Logic: Bricks
    let totalBreakableBricks = 0;
    for(let c=0; c<bCols; c++) {
        for(let r=0; r<bRows; r++) {
            let b = bBricks[c][r];
            if(b.status > 0) totalBreakableBricks++; // Count only breakable bricks
            
            if(b.status !== 0) {
                if(bBall.x > b.x && bBall.x < b.x + b.w && bBall.y > b.y && bBall.y < b.y + b.h) {
                    bBall.dy = -bBall.dy;
                    
                    if (b.status > 0) { // If not solid
                        b.status--;
                        if (b.status === 0) {
                            bScore += 10;
                            spawnPowerUp(b.x + b.w/2, b.y + b.h);
                        } else {
                            bScore += 5; // Hard brick hit
                        }
                        updateBrickUI();
                    }
                }
            }
        }
    }

    if(totalBreakableBricks === 0) {
        document.getElementById('brickMessage').innerText = "YOU WIN!";
        document.getElementById('brickMessage').style.display = "block";
        setTimeout(stopBrickGame, 2500);
        return;
    }

    // Move Ball
    bBall.x += bBall.dx;
    bBall.y += bBall.dy;

    bReqId = requestAnimationFrame(drawBrickGame);
}

// ==========================================
// --- RESPONSIVE FADING LINE EFFECT ---
// ==========================================
const canvas = document.getElementById('cursorCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const trail = [];
const trailLength = 45; // Short snappy tail
let hue = 200;

let mouse = { x: -1000, y: -1000 };
let isMoving = false;
let fadeOut = 0; 
let moveTimeout;

for (let i = 0; i < trailLength; i++) {
    trail.push({ x: mouse.x, y: mouse.y });
}

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (mazeActive) drawMazeStatic();
    if (brickActive) initBrickLevel();
});

window.addEventListener('mousemove', (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    
    isMoving = true;
    fadeOut = 1; 
    
    clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
        isMoving = false;
    }, 50); 

    // Handle Brick Paddle Movement
    if (brickActive) {
        let relativeX = mouse.x;
        if(relativeX > 0 && relativeX < window.innerWidth) {
            bPaddle.x = relativeX - bPaddle.w/2;
        }
    }
    
    // --- MAZE COLLISION DETECTION ---
    if (mazeActive) {
        // Anti-cheat interpolation check
        if (mazeLastX !== -1000) {
            const dist = Math.hypot(mouse.x - mazeLastX, mouse.y - mazeLastY);
            const steps = Math.max(1, Math.floor(dist / 5)); // Check every 5 pixels between frames
            
            for(let i = 1; i <= steps; i++) {
                const cx = mazeLastX + (mouse.x - mazeLastX) * (i/steps);
                const cy = mazeLastY + (mouse.y - mazeLastY) * (i/steps);
                
                const col = Math.floor(cx / mazeCellW);
                const row = Math.floor(cy / mazeCellH);
                
                if(row >= 0 && row < 10 && col >= 0 && col < 20) {
                    const cell = currentMap[row][col];
                    
                    if(mazeState === 'waiting' && cell === '2') {
                        mazeState = 'playing';
                        document.getElementById('mazeMessage').innerText = "Reach the Gold Exit!";
                        document.getElementById('mazeMessage').style.color = "#ffc107";
                        document.getElementById('mazeMessage').style.opacity = "0.2"; 
                    }
                    else if(mazeState === 'playing') {
                        if (cell === '1') {
                            loseMazeHeart();
                            break; 
                        } else if (cell === '3') {
                            winMazeLevel();
                            break; 
                        }
                    }
                }
            }
        }
        mazeLastX = mouse.x;
        mazeLastY = mouse.y;
    }
});

function animateLine() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!isMoving) {
        fadeOut = Math.max(0, fadeOut - 0.08); 
    }

    trail[0].x = mouse.x;
    trail[0].y = mouse.y;

    const speed = 0.85; 

    for (let i = 1; i < trailLength; i++) {
        trail[i].x += (trail[i - 1].x - trail[i].x) * speed;
        trail[i].y += (trail[i - 1].y - trail[i].y) * speed;
    }

    if (fadeOut > 0) {
        for (let i = trailLength - 1; i > 0; i--) {
            const p1 = trail[i];
            const p2 = trail[i - 1];

            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            
            const size = ((trailLength - i) / trailLength) * 15; 
            const alpha = ((trailLength - i) / trailLength) * fadeOut;
            
            ctx.strokeStyle = `hsla(${hue - i}, 100%, 60%, ${alpha})`; 
            ctx.lineWidth = size;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
        }
    }

    hue += 3; 
    requestAnimationFrame(animateLine);
}

animateLine();
