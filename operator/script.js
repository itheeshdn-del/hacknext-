
/* =========================================================
   LOGIX AI — OPERATOR CONTROL CENTER
   Frontend dashboard and real-time communication
   Backend: http://localhost:3000
   ========================================================= */

"use strict";

/* ==================== CONFIGURATION ==================== */

const API_BASE = "http://localhost:3000";
const SOCKET_URL = API_BASE;
const OPERATOR_STORAGE_KEY = "logixAI.operator";
const TRIGGER_STORAGE_KEY = "logixAI.triggers";

const DEFAULT_OPERATOR = {
  name: "Control Operator",
  shift: "Morning"
};

const DEFAULT_TRIGGERS = {
  criticalRisk: true,
  highRisk: true,
  driverGPS: true,
  disruptionAlerts: true,
  browserNotifications: false
};

const scenarioData = {
  current: {
    label: "Continue",
    description: "Continue with the current operational plan.",
    decision: "Continue",
    risk: "Current risk remains subject to the latest shipment data."
  },
  alternate: {
    label: "Reroute",
    description: "Consider an alternative route to reduce disruption exposure.",
    decision: "Reroute",
    risk: "Actual route availability must be verified by the logistics backend."
  },
  hold: {
    label: "Hold",
    description: "Temporarily hold the shipment until conditions are reviewed.",
    decision: "Hold",
    risk: "A hold can increase delivery time."
  },
  reassign: {
    label: "Reassign",
    description: "Consider assigning the shipment to another available driver.",
    decision: "Reassign",
    risk: "Driver availability must be confirmed before reassignment."
  }
};

/* ==================== STATE ==================== */

let socket = null;
let operatorMap = null;
let mapInitialized = false;
let mapInitializationAttempted = false;

let drivers = [];
let orders = [];
let disruptions = [];

let driverMarkers = {};
let driverRoutes = {};

let selectedOrder = null;
let selectedScenario = "current";

let decisionSeconds = 522;
let decisionTimerInterval = null;

let alerts = [];
let decisions = [];
let simulationResults = [];
let whatIfResults = [];

let lastRefreshDate = null;
let lastBackendSuccess = false;
let lastSocketEventAt = null;
let dismissedBanner = false;
let currentHandoverText = "";

let operatorProfile = loadStoredObject(
  OPERATOR_STORAGE_KEY,
  DEFAULT_OPERATOR
);

let triggerSettings = loadStoredObject(
  TRIGGER_STORAGE_KEY,
  DEFAULT_TRIGGERS
);

/* ==================== INITIALIZATION ==================== */

document.addEventListener("DOMContentLoaded", initializeApplication);

function initializeApplication() {
  initializeNavigation();
  initializeButtons();
  initializeSearch();
  initializeScenarioControls();
  initializeTriggers();
  initializeClock();
  initializeDecisionTimer();
  initializeMap();
  initializeProfile();
  connectRealtime();
  loadInitialData();

  updateOperatorName();
  renderAlerts();
  renderDecisionLog();
  updateHandoverSummary();

  window.addEventListener("online", () => {
    showToast("Network restored", "Browser reports an active network connection.", "success");
    refreshAllData();
  });

  window.addEventListener("offline", () => {
    setBackendStatus(false, "Browser offline");
    showToast("Network unavailable", "The browser reports that the network is offline.", "warning");
  });

  window.addEventListener("resize", debounce(() => {
    if (operatorMap) {
      operatorMap.invalidateSize();
    }
  }, 150));

  // Fallback polling is used only when Socket.IO is unavailable.
  window.setInterval(() => {
    if (!socket || !socket.connected) {
      refreshAllData();
    }
  }, 15000);
}

/* ==================== NAVIGATION ==================== */

function initializeNavigation() {
  document.querySelectorAll(".nav-item[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      showPage(button.dataset.page);
      closeMobileSidebar();
    });
  });

  document.querySelectorAll("[data-go-page]").forEach(button => {
    button.addEventListener("click", () => {
      showPage(button.dataset.goPage);
    });
  });

  const menuButton = document.getElementById("mobileMenuBtn");
  const backdrop = document.getElementById("sidebarBackdrop");
  const sidebar = document.getElementById("sidebar");

  if (menuButton) {
    menuButton.addEventListener("click", () => {
      const isOpen = sidebar.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(isOpen));

      if (backdrop) {
        backdrop.hidden = !isOpen;
      }
    });
  }

  if (backdrop) {
    backdrop.addEventListener("click", closeMobileSidebar);
  }
}

function showPage(pageName) {
  const target = document.getElementById(`page-${pageName}`);

  if (!target) {
    console.warn("Unknown dashboard page:", pageName);
    return;
  }

  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page === target);
  });

  document.querySelectorAll(".nav-item[data-page]").forEach(button => {
    const active = button.dataset.page === pageName;
    button.classList.toggle("active", active);

    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  const titles = {
    dashboard: "Operator Dashboard",
    network: "Network Overview",
    impact: "Impact Analysis",
    decision: "Decision Center",
    whatif: "What-if Planning",
    triggers: "Trigger Rules",
    decisions: "Decision Log",
    handover: "Shift Handover",
    simulation: "Simulation Lab",
    alerts: "Alerts & Notifications"
  };

  const title = titles[pageName] || "Operator Dashboard";
  setText("topbarTitle", title);
  setText("breadcrumb", `Operations / ${title}`);

  if (pageName === "network") {
    window.setTimeout(() => {
      if (operatorMap) operatorMap.invalidateSize();
    }, 100);
  }

  if (pageName === "decision") {
    populateOrderSelects();
    renderDecisionQueue();
  }

  if (pageName === "whatif") {
    populateOrderSelects();
  }

  if (pageName === "decisions") {
    renderDecisionLog();
  }

  if (pageName === "handover") {
    updateHandoverSummary();
  }

  if (pageName === "alerts") {
    renderAlerts();
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  const menuButton = document.getElementById("mobileMenuBtn");

  if (sidebar) sidebar.classList.remove("open");
  if (backdrop) backdrop.hidden = true;
  if (menuButton) menuButton.setAttribute("aria-expanded", "false");
}

/* ==================== BUTTONS ==================== */

function initializeButtons() {
  bindClick("refreshDashboardBtn", refreshAllData);
  bindClick("refreshNetworkBtn", refreshAllData);
  bindClick("refreshImpactBtn", refreshAllData);

  bindClick("openSimulationBtn", () => showPage("simulation"));
  bindClick("notificationBtn", () => showPage("alerts"));

  bindClick("dismissBannerBtn", () => {
    dismissedBanner = true;
    const banner = document.getElementById("criticalBanner");
    if (banner) banner.hidden = true;
  });

  bindClick("fitMapBtn", fitMapToDrivers);
  bindClick("resetMapBtn", resetMapView);

  bindClick("acceptScenarioBtn", submitDecision);
  bindClick("resetDecisionBtn", resetDecisionForm);

  bindClick("runWhatIfBtn", runWhatIfAnalysis);
  bindClick("runSimulationBtn", runSimulation);
  bindClick("resetSimulationBtn", resetSimulation);

  bindClick("markAllReadBtn", markAllAlertsRead);
  bindClick("clearAlertsBtn", clearAlerts);

  bindClick("createHandoverBtn", createHandover);
  bindClick("downloadHandoverBtn", downloadHandover);
  bindClick("exportDecisionsBtn", exportDecisionsCSV);

  bindClick("resetTriggersBtn", resetTriggers);
  bindClick("profileBtn", openProfileModal);
  bindClick("closeProfileBtn", closeProfileModal);
  bindClick("cancelProfileBtn", closeProfileModal);
  bindClick("saveProfileBtn", saveProfile);

  const orderSelect = document.getElementById("decisionOrderSelect");

  if (orderSelect) {
    orderSelect.addEventListener("change", () => {
      selectOrderForDecision(orderSelect.value);
    });
  }

  const impactFilter = document.getElementById("impactRiskFilter");

  if (impactFilter) {
    impactFilter.addEventListener("change", renderAffectedShipments);
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeProfileModal();
      closeMobileSidebar();
    }
  });
}

function bindClick(id, handler) {
  const element = document.getElementById(id);
  if (element) element.addEventListener("click", handler);
}

/* ==================== BACKEND STATUS ==================== */

async function checkBackendStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/status`, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Backend status returned HTTP ${response.status}`);
    }

    const payload = await response.json();

    lastBackendSuccess = true;
    setBackendStatus(true, "Connected");
    return payload;
  } catch (error) {
    lastBackendSuccess = false;
    setBackendStatus(false, "Disconnected");
    console.warn("Backend status check failed:", error.message);
    return null;
  }
}

function setBackendStatus(connected, message) {
  const dot = document.getElementById("backendStatusDot");
  const text = document.getElementById("backendStatusText");
  const sidebarDot = document.getElementById("sidebarStatusDot");
  const sidebarText = document.getElementById("sidebarStatusText");
  const sidebarSubtitle = document.getElementById("sidebarStatusSubtitle");

  if (dot) {
    dot.classList.toggle("offline", !connected);
    dot.classList.toggle("pulse", connected);
  }

  if (sidebarDot) {
    sidebarDot.classList.toggle("offline", !connected);
    sidebarDot.classList.toggle("pulse", connected);
  }

  if (text) text.textContent = message;
  if (sidebarText) sidebarText.textContent = connected ? "System online" : "System offline";

  if (sidebarSubtitle) {
    sidebarSubtitle.textContent = connected
      ? "Backend reachable"
      : "Check backend server";
  }
}

/* ==================== DATA LOADING ==================== */

async function loadInitialData() {
  await checkBackendStatus();

  await Promise.allSettled([
    loadDrivers(),
    loadOrders(),
    loadDisruptions()
  ]);

  renderAll();
  lastRefreshDate = new Date();
  setText("lastRefreshTime", formatClock(lastRefreshDate));
}

async function refreshAllData() {
  await checkBackendStatus();

  await Promise.allSettled([
    loadDrivers(),
    loadOrders(),
    loadDisruptions()
  ]);

  renderAll();
  lastRefreshDate = new Date();
  setText("lastRefreshTime", formatClock(lastRefreshDate));
}

async function fetchJSON(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();

    if (!text.trim()) return {};
    throw new Error(`Expected JSON from ${path}`);
  }

  return response.json();
}

function normalizeArray(payload, possibleKeys) {
  if (Array.isArray(payload)) return payload;

  if (payload && typeof payload === "object") {
    for (const key of possibleKeys) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }

  return [];
}

async function loadDrivers() {
  try {
    const payload = await fetchJSON("/api/drivers");
    const list = normalizeArray(payload, ["drivers", "data", "results"]);

    drivers = list.map(normalizeDriver);
    return drivers;
  } catch (error) {
    console.warn("Could not load drivers:", error.message);
    addAlertOnce("backend-drivers", {
      title: "Driver data unavailable",
      message: "The driver endpoint could not be refreshed. Previously loaded data has been retained.",
      severity: "warning"
    });
    return drivers;
  }
}

async function loadOrders() {
  try {
    const payload = await fetchJSON("/api/orders");
    const list = normalizeArray(payload, ["orders", "shipments", "data", "results"]);

    orders = list.map(normalizeOrder);
    return orders;
  } catch (error) {
    console.warn("Could not load shipments:", error.message);
    addAlertOnce("backend-orders", {
      title: "Shipment data unavailable",
      message: "The shipment endpoint could not be refreshed. Previously loaded data has been retained.",
      severity: "warning"
    });
    return orders;
  }
}

async function loadDisruptions() {
  try {
    const payload = await fetchJSON("/api/disruptions");
    const list = normalizeArray(payload, ["disruptions", "events", "data", "results"]);

    disruptions = list.map(normalizeDisruption);
    return disruptions;
  } catch (error) {
    console.warn("Could not load disruptions:", error.message);
    addAlertOnce("backend-disruptions", {
      title: "Disruption data unavailable",
      message: "The disruption endpoint could not be refreshed. Previously loaded data has been retained.",
      severity: "warning"
    });
    return disruptions;
  }
}

/* ==================== DATA NORMALIZATION ==================== */

function normalizeDriver(driver = {}) {
  return {
    ...driver,
    id: getDriverId(driver),
    name: firstValue(driver.name, driver.driver_name, driver.driverName, "Unknown Driver"),
    vehicle: firstValue(
      driver.vehicle_number,
      driver.vehicleNumber,
      driver.vehicle,
      driver.registration_number,
      "Vehicle not assigned"
    ),
    status: normalizeStatus(firstValue(driver.status, driver.state, "unknown")),
    speed: toNumber(firstValue(driver.speed, driver.speed_kmh, driver.speedKmh), 0),
    latitude: getLatitude(driver),
    longitude: getLongitude(driver),
    updated_at: firstValue(driver.updated_at, driver.updatedAt, driver.timestamp, null)
  };
}

function normalizeOrder(order = {}) {
  const number = firstValue(
    order.order_number,
    order.orderNumber,
    order.shipment_id,
    order.shipmentId,
    order.id,
    "Unknown"
  );

  return {
    ...order,
    order_number: String(number),
    destination: firstValue(
      order.destination,
      order.destination_name,
      order.destinationName,
      order.delivery_location,
      "Not specified"
    ),
    status: normalizeStatus(firstValue(order.status, "unknown")),
    risk: normalizeRisk(firstValue(order.risk, order.risk_level, order.riskLevel, "low")),
    eta: firstValue(order.eta, order.revised_eta, order.estimated_delivery, order.estimatedArrival, null),
    delay_minutes: toNumber(
      firstValue(order.delay_minutes, order.delayMinutes, order.estimated_delay),
      0
    ),
    driver_id: firstValue(order.driver_id, order.driverId, null)
  };
}

function normalizeDisruption(event = {}) {
  return {
    ...event,
    id: firstValue(event.id, event.event_id, event.eventId, null),
    title: firstValue(event.title, event.name, event.type, "Disruption event"),
    type: firstValue(event.type, event.category, "General"),
    severity: normalizeRisk(firstValue(event.severity, event.risk, "medium")),
    location: firstValue(event.location, event.area, event.address, "Not specified"),
    message: firstValue(event.message, event.description, event.details, "No additional details."),
    timestamp: firstValue(event.timestamp, event.created_at, event.createdAt, null)
  };
}

function normalizeStatus(value) {
  return String(value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function normalizeRisk(value) {
  const risk = normalizeStatus(value);

  if (["urgent", "severe", "critical", "very-high"].includes(risk)) return "critical";
  if (["high", "danger", "dangerous"].includes(risk)) return "high";
  if (["moderate", "medium", "medium-risk"].includes(risk)) return "medium";
  if (["low", "normal", "safe"].includes(risk)) return "low";

  return risk || "low";
}

function getDriverId(driver = {}) {
  const value = firstValue(driver.driver_id, driver.driverId, driver.id, driver._id);
  return value === undefined || value === null ? null : String(value);
}

function getLatitude(data = {}) {
  const value = Number(firstValue(data.latitude, data.lat, data.gps_latitude));
  return Number.isFinite(value) && value >= -90 && value <= 90 ? value : null;
}

function getLongitude(data = {}) {
  const value = Number(firstValue(data.longitude, data.lng, data.lon, data.gps_longitude));
  return Number.isFinite(value) && value >= -180 && value <= 180 ? value : null;
}

/* ==================== REAL-TIME SOCKET ==================== */

function connectRealtime() {
  if (typeof window.io !== "function") {
    console.warn("Socket.IO client is unavailable. HTTP refresh fallback will be used.");
    setBackendStatus(false, "HTTP fallback");
    return;
  }

  try {
    socket = window.io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000
    });

    socket.on("connect", () => {
      console.info("LOGIX AI Socket.IO connected:", socket.id);
      lastSocketEventAt = new Date();

      setBackendStatus(true, "Live connected");

      socket.emit("identify", {
        role: "operator",
        operatorName: operatorProfile.name
      });

      refreshAllData();
    });

    socket.on("disconnect", reason => {
      console.warn("Socket.IO disconnected:", reason);
      setBackendStatus(false, "Live disconnected");
    });

    socket.on("connect_error", error => {
      console.warn("Socket.IO connection error:", error.message);
      setBackendStatus(false, "Reconnecting");
    });

    socket.on("driverLocationUpdated", handleDriverLocationUpdate);
    socket.on("newDisruption", handleNewDisruption);
    socket.on("operatorDecision", handleOperatorDecision);
    socket.on("orderUpdated", handleOrderUpdated);
  } catch (error) {
    console.error("Could not initialize Socket.IO:", error);
    setBackendStatus(false, "Connection failed");
  }
}

function handleDriverLocationUpdate(payload) {
  if (!payload || !triggerSettings.driverGPS) return;

  const id = getDriverId(payload);
  const lat = getLatitude(payload);
  const lng = getLongitude(payload);

  if (!id || lat === null || lng === null) {
    console.warn("Ignoring invalid driver location event:", payload);
    return;
  }

  lastSocketEventAt = new Date();

  const index = drivers.findIndex(driver => String(driver.id) === id);

  if (index >= 0) {
    drivers[index] = normalizeDriver({
      ...drivers[index],
      ...payload,
      latitude: lat,
      longitude: lng
    });
  } else {
    drivers.push(normalizeDriver({
      ...payload,
      id,
      latitude: lat,
      longitude: lng
    }));
  }

  updateDriverMarker(drivers.find(driver => String(driver.id) === id));
  renderDrivers();
  renderDriverTable();
  updateDriverCounters();
  updateNetworkMetrics();
  setText("mapLiveStatus", `GPS updated ${formatClock(new Date())}`);
}

function handleNewDisruption(payload) {
  if (!payload) return;

  const disruption = normalizeDisruption(payload);
  const key = disruption.id
    ? `id:${disruption.id}`
    : `${disruption.type}|${disruption.location}|${disruption.message}`;

  const exists = disruptions.some(item => {
    const itemKey = item.id
      ? `id:${item.id}`
      : `${item.type}|${item.location}|${item.message}`;

    return itemKey === key;
  });

  if (!exists) {
    disruptions.unshift(disruption);
    disruptions = disruptions.slice(0, 100);
  }

  lastSocketEventAt = new Date();

  if (triggerSettings.disruptionAlerts) {
    addAlertOnce(`disruption:${key}`, {
      title: `Disruption: ${disruption.title}`,
      message: `${disruption.location} — ${disruption.message}`,
      severity: disruption.severity
    });
  }

  renderAll();
  showToast("New disruption received", disruption.title, "warning");
}

function handleOperatorDecision(payload) {
  if (!payload) return;

  const decision = normalizeDecision(payload);
  const key = decisionKey(decision);

  if (!decisions.some(item => decisionKey(item) === key)) {
    decisions.unshift(decision);
    decisions = decisions.slice(0, 500);
  }

  lastSocketEventAt = new Date();
  renderDecisionLog();
  updateHandoverSummary();
}

function handleOrderUpdated(payload) {
  if (!payload) return;

  const updated = normalizeOrder(payload);
  const index = orders.findIndex(order =>
    String(order.order_number) === String(updated.order_number)
  );

  if (index >= 0) {
    orders[index] = {
      ...orders[index],
      ...updated
    };
  } else {
    orders.push(updated);
  }

  lastSocketEventAt = new Date();
  renderAll();
}

/* ==================== LEAFLET MAP ==================== */

function initializeMap() {
    const mapElement = document.getElementById("operatorMap");

    if (!mapElement) {
        console.error("LOGIX AI: Map container #operatorMap was not found.");
        return;
    }

    if (typeof L === "undefined") {
        console.error(
            "LOGIX AI: Leaflet did not load. Check the Leaflet script URL."
        );

        mapElement.innerHTML =
            '<div style="padding:20px;color:#b91c1c;">' +
            "Map library failed to load. Check your internet connection " +
            "and Leaflet script URL." +
            "</div>";

        return;
    }

    // Prevent duplicate map initialization.
    if (operatorMap) {
        operatorMap.invalidateSize(true);
        return;
    }

    try {
        operatorMap = L.map("operatorMap", {
            center: [11.0168, 76.9558],
            zoom: 12,
            zoomControl: true,
            scrollWheelZoom: true
        });

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                attribution:
                    '&copy; <a href="https://www.openstreetmap.org/copyright">' +
                    "OpenStreetMap</a> contributors",
                maxZoom: 19
            }
        ).addTo(operatorMap);

        // Add a marker to verify that the map is working.
        L.marker([11.0168, 76.9558])
            .addTo(operatorMap)
            .bindPopup("<b>LOGIX AI</b><br>Map initialized successfully.");

        // Recalculate dimensions after the page has rendered.
        requestAnimationFrame(() => {
            if (operatorMap) {
                operatorMap.invalidateSize(true);
            }
        });

        setTimeout(() => {
            if (operatorMap) {
                operatorMap.invalidateSize(true);
            }
        }, 500);

        console.log("LOGIX AI: Map initialized successfully.");

    } catch (error) {
        console.error("LOGIX AI: Map initialization failed:", error);
        operatorMap = null;
    }
}
function updateDriverMarker(driver) {
  if (!operatorMap || !driver || driver.latitude === null || driver.longitude === null) {
    return;
  }

  const id = String(driver.id ?? getDriverId(driver) ?? "");
  if (!id) return;

  const risk = normalizeRisk(driver.risk || driver.status);
  const markerClass = risk === "critical"
    ? "critical"
    : risk === "high" || driver.status === "delayed"
      ? "delayed"
      : "";

  const icon = L.divIcon({
    className: "",
    html: `<div class="truck-marker ${markerClass}" title="${escapeHTML(driver.name)}">🚚</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });

  const popup = `
    <div class="map-popup">
      <strong>${escapeHTML(driver.name)}</strong><br>
      Vehicle: ${escapeHTML(driver.vehicle)}<br>
      Status: ${escapeHTML(driver.status)}<br>
      Speed: ${escapeHTML(String(driver.speed))} km/h<br>
      GPS: ${Number(driver.latitude).toFixed(5)}, ${Number(driver.longitude).toFixed(5)}
    </div>
  `;

  if (driverMarkers[id]) {
    driverMarkers[id].setLatLng([driver.latitude, driver.longitude]);
    driverMarkers[id].setIcon(icon);
    driverMarkers[id].setPopupContent(popup);
  } else {
    driverMarkers[id] = L.marker(
      [driver.latitude, driver.longitude],
      { icon }
    ).addTo(operatorMap).bindPopup(popup);
  }
}

function renderAllDriverMarkers() {
  if (!operatorMap) return;

  drivers.forEach(updateDriverMarker);

  const validIds = new Set(
    drivers.filter(driver =>
      driver.latitude !== null &&
      driver.longitude !== null
    ).map(driver => String(driver.id))
  );

  Object.keys(driverMarkers).forEach(id => {
    if (!validIds.has(id)) {
      operatorMap.removeLayer(driverMarkers[id]);
      delete driverMarkers[id];
    }
  });
}

function fitMapToDrivers() {
  if (!operatorMap) return;

  const markers = Object.values(driverMarkers);

  if (!markers.length) {
    showToast("No GPS positions", "No valid driver coordinates are currently available.", "info");
    return;
  }

  const group = L.featureGroup(markers);
  operatorMap.fitBounds(group.getBounds().pad(0.15), {
    maxZoom: 14
  });
}

function resetMapView() {
  if (operatorMap) {
    operatorMap.setView([11.0168, 76.9558], 8);
  }
}

/* ==================== RENDER DASHBOARD ==================== */

function renderAll() {
  renderDrivers();
  renderDriverTable();
  renderOrdersTable();
  renderNetworkEvents();
  renderDecisionQueue();
  renderAffectedShipments();
  populateOrderSelects();
  updateDashboardCounters();
  updateDriverCounters();
  updateNetworkMetrics();
  updateImpactMetrics();
  updateHandoverSummary();
  renderAlerts();
  renderDecisionLog();
  renderAllDriverMarkers();
  updateCriticalBanner();
}

function updateDashboardCounters() {
  const total = orders.length;
  const active = orders.filter(isActiveOrder).length;
  const atRisk = orders.filter(order =>
    ["high", "critical"].includes(normalizeRisk(order.risk))
  ).length;

  const completed = orders.filter(order =>
    ["completed", "delivered"].includes(order.status)
  ).length;

  const onTime = orders.filter(order =>
    ["completed", "delivered", "on-time", "on_time"].includes(order.status)
  ).length;

  const onTimeRate = completed > 0
    ? Math.round((onTime / completed) * 100)
    : 0;

  setText("totalOrders", total);
  setText("activeDrivers", drivers.filter(isDriverActive).length);
  setText("atRiskOrders", atRisk);
  setText("onTimeRate", `${onTimeRate}%`);

  setText("networkActiveOrders", active);
  setText("networkDisruptions", disruptions.length);
  setText("networkCriticalOrders", orders.filter(order =>
    normalizeRisk(order.risk) === "critical"
  ).length);

  setProgress("activeOrdersProgress", total ? active / total * 100 : 0);
  setProgress("disruptionProgress", Math.min(disruptions.length * 10, 100));
  setProgress("criticalProgress", total
    ? orders.filter(order => normalizeRisk(order.risk) === "critical").length / total * 100
    : 0);

  setText("decisionNavBadge", atRisk);
  setText("impactNavBadge", getAffectedOrders().length);
}

function updateDriverCounters() {
  setText("networkDriverCount", drivers.length);
  setText("networkOrderCount", orders.length);
  setText("networkDisruptionCount", disruptions.length);

  setText("networkRiskCount", orders.filter(order =>
    ["high", "critical"].includes(normalizeRisk(order.risk))
  ).length);
}

function updateNetworkMetrics() {
  updateDashboardCounters();
  updateDriverCounters();
}

function updateImpactMetrics() {
  const affected = getAffectedOrders();
  const critical = affected.filter(order => normalizeRisk(order.risk) === "critical").length;

  const estimatedDelay = affected.reduce((sum, order) => {
    return sum + Math.max(0, toNumber(order.delay_minutes, 0));
  }, 0);

  setText("impactAffectedCount", affected.length);
  setText("impactCriticalCount", critical);
  setText("impactDisruptionCount", disruptions.length);
  setText("impactEstimatedDelay", `${estimatedDelay} min`);
}

function updateCriticalBanner() {
  const banner = document.getElementById("criticalBanner");
  if (!banner) return;

  const criticalOrders = orders.filter(order =>
    normalizeRisk(order.risk) === "critical"
  );

  if (dismissedBanner && criticalOrders.length === 0) {
    banner.hidden = true;
    return;
  }

  banner.hidden = false;

  if (criticalOrders.length > 0) {
    banner.classList.remove("warning", "info");
    setText("criticalBannerTitle", `${criticalOrders.length} critical-risk shipment(s)`);
    setText(
      "criticalBannerMessage",
      "Review the critical shipments and verify the appropriate operational response."
    );
  } else if (disruptions.length > 0) {
    banner.classList.remove("info");
    banner.classList.add("warning");
    setText("criticalBannerTitle", `${disruptions.length} disruption event(s) detected`);
    setText(
      "criticalBannerMessage",
      "Review current disruption information and check potentially affected shipments."
    );
  } else {
    banner.classList.remove("warning");
    banner.classList.add("info");
    setText("criticalBannerTitle", "Logistics network monitoring");
    setText(
      "criticalBannerMessage",
      lastBackendSuccess
        ? "The dashboard is connected. Continue monitoring live shipment and driver updates."
        : "Waiting for the backend connection. Some data may be unavailable."
    );
  }
}

/* ==================== DRIVER RENDERING ==================== */

function renderDrivers() {
  const container = document.getElementById("driversList");
  if (!container) return;

  if (!drivers.length) {
    container.innerHTML = emptyStateHTML(
      "🚚",
      "No drivers available",
      "The driver endpoint has not returned any driver records."
    );
    return;
  }

  container.innerHTML = drivers.slice(0, 12).map(driver => {
    const initials = getInitials(driver.name);
    const statusClass = statusBadgeClass(driver.status);

    const gps = driver.latitude !== null && driver.longitude !== null
      ? `${driver.latitude.toFixed(4)}, ${driver.longitude.toFixed(4)}`
      : "GPS unavailable";

    return `
      <div class="driver-item">
        <div class="driver-avatar">${escapeHTML(initials)}</div>
        <div class="driver-details">
          <div class="driver-name">${escapeHTML(driver.name)}</div>
          <div class="driver-meta">
            ${escapeHTML(driver.vehicle)} · ${escapeHTML(gps)}
          </div>
        </div>
        <div class="driver-status">
          <span class="badge ${statusClass}">${escapeHTML(driver.status)}</span>
          <div class="driver-meta">${escapeHTML(String(driver.speed))} km/h</div>
        </div>
      </div>
    `;
  }).join("");
}

function renderDriverTable() {
  const tbody = document.getElementById("networkDriversTable");
  if (!tbody) return;

  const query = getInputValue("driverSearch").toLowerCase();

  const filtered = drivers.filter(driver => {
    const searchable = [
      driver.name,
      driver.vehicle,
      driver.status,
      driver.id
    ].join(" ").toLowerCase();

    return searchable.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6">No matching drivers.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(driver => {
    const gps = driver.latitude !== null && driver.longitude !== null
      ? `${driver.latitude.toFixed(5)}, ${driver.longitude.toFixed(5)}`
      : "Unavailable";

    return `
      <tr>
        <td><strong>${escapeHTML(driver.name)}</strong></td>
        <td>${escapeHTML(driver.vehicle)}</td>
        <td><span class="badge ${statusBadgeClass(driver.status)}">${escapeHTML(driver.status)}</span></td>
        <td>${escapeHTML(String(driver.speed))} km/h</td>
        <td>${escapeHTML(gps)}</td>
        <td>${escapeHTML(formatDateTime(driver.updated_at))}</td>
      </tr>
    `;
  }).join("");
}

/* ==================== ORDER RENDERING ==================== */

function renderOrdersTable() {
  const tbody = document.getElementById("networkOrdersTable");
  if (!tbody) return;

  const query = getInputValue("orderSearch").toLowerCase();

  const filtered = orders.filter(order => {
    return [
      order.order_number,
      order.destination,
      order.status,
      order.risk
    ].join(" ").toLowerCase().includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6">No matching shipments.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(order => `
    <tr>
      <td>
        <div class="table-primary-text">${escapeHTML(order.order_number)}</div>
        <div class="table-secondary-text">Shipment</div>
      </td>
      <td>${escapeHTML(order.destination)}</td>
      <td><span class="badge ${statusBadgeClass(order.status)}">${escapeHTML(order.status)}</span></td>
      <td><span class="badge ${riskBadgeClass(order.risk)}">${escapeHTML(order.risk)}</span></td>
      <td>${escapeHTML(formatETA(order.eta))}</td>
      <td>
        <button class="btn btn-primary btn-sm" data-review-order="${escapeHTML(order.order_number)}">
          Review
        </button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-review-order]").forEach(button => {
    button.addEventListener("click", () => {
      selectOrderForDecision(button.dataset.reviewOrder);
      showPage("decision");
    });
  });
}

function renderNetworkEvents() {
  const tbody = document.getElementById("networkEventsTable");
  if (!tbody) return;

  if (!disruptions.length) {
    tbody.innerHTML = `<tr><td colspan="6">No disruption events are currently available.</td></tr>`;
    return;
  }

  tbody.innerHTML = disruptions.map(event => `
    <tr>
      <td>${escapeHTML(event.title)}</td>
      <td>${escapeHTML(event.type)}</td>
      <td><span class="badge ${riskBadgeClass(event.severity)}">${escapeHTML(event.severity)}</span></td>
      <td>${escapeHTML(event.location)}</td>
      <td>${escapeHTML(event.message)}</td>
      <td>${escapeHTML(formatDateTime(event.timestamp))}</td>
    </tr>
  `).join("");
}

/* ==================== DECISION QUEUE ==================== */

function renderDecisionQueue() {
  renderQueueInto("decisionQueue", true);
  renderQueueInto("fullDecisionQueue", false);
}

function renderQueueInto(containerId, limitItems) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const riskOrders = orders
    .filter(order => ["high", "critical"].includes(normalizeRisk(order.risk)))
    .sort((a, b) => riskRank(b.risk) - riskRank(a.risk));

  const items = limitItems ? riskOrders.slice(0, 5) : riskOrders;

  if (!items.length) {
    container.innerHTML = emptyStateHTML(
      "✓",
      "No priority decisions",
      "No high- or critical-risk shipments are currently identified in the loaded data."
    );
    return;
  }

  container.innerHTML = items.map(order => `
    <article class="decision-card ${normalizeRisk(order.risk) === "critical" ? "urgent" : "warning"}">
      <div class="decision-card-header">
        <h4 class="decision-title">Shipment ${escapeHTML(order.order_number)}</h4>
        <span class="badge ${riskBadgeClass(order.risk)}">${escapeHTML(order.risk)} risk</span>
      </div>
      <p class="decision-description">
        Destination: ${escapeHTML(order.destination)}.
        Status: ${escapeHTML(order.status)}.
      </p>
      <div class="decision-meta">
        <span>ETA: ${escapeHTML(formatETA(order.eta))}</span>
        <span>Delay: ${escapeHTML(String(order.delay_minutes))} min</span>
      </div>
      <div class="decision-actions">
        <button class="btn btn-primary btn-sm" data-review-queue-order="${escapeHTML(order.order_number)}">
          Review Decision
        </button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll("[data-review-queue-order]").forEach(button => {
    button.addEventListener("click", () => {
      selectOrderForDecision(button.dataset.reviewQueueOrder);
      showPage("decision");
    });
  });
}

/* ==================== DECISION FORM ==================== */

function populateOrderSelects() {
  const decisionSelect = document.getElementById("decisionOrderSelect");
  const whatIfSelect = document.getElementById("whatIfOrderSelect");

  if (decisionSelect) {
    const previous = decisionSelect.value;

    decisionSelect.innerHTML =
      `<option value="">Select a shipment...</option>` +
      orders.map(order => `
        <option value="${escapeHTML(order.order_number)}">
          ${escapeHTML(order.order_number)} — ${escapeHTML(order.destination)}
        </option>
      `).join("");

    if (orders.some(order => String(order.order_number) === previous)) {
      decisionSelect.value = previous;
    }
  }

  if (whatIfSelect) {
    const previous = whatIfSelect.value;

    whatIfSelect.innerHTML =
      `<option value="">All shipments</option>` +
      orders.map(order => `
        <option value="${escapeHTML(order.order_number)}">
          ${escapeHTML(order.order_number)} — ${escapeHTML(order.destination)}
        </option>
      `).join("");

    if (orders.some(order => String(order.order_number) === previous)) {
      whatIfSelect.value = previous;
    }
  }

  if (selectedOrder) {
    const stillExists = orders.find(order =>
      String(order.order_number) === String(selectedOrder.order_number)
    );

    if (stillExists) {
      selectedOrder = stillExists;
      if (decisionSelect) decisionSelect.value = selectedOrder.order_number;
      renderSelectedOrder();
    }
  }
}

function selectOrderForDecision(orderNumber) {
  const order = orders.find(item =>
    String(item.order_number) === String(orderNumber)
  );

  if (!order) {
    showToast("Shipment not found", "The selected shipment is no longer in the loaded dataset.", "warning");
    return;
  }

  selectedOrder = order;

  const select = document.getElementById("decisionOrderSelect");
  if (select) select.value = order.order_number;

  renderSelectedOrder();
}

function renderSelectedOrder() {
  const container = document.getElementById("selectedOrderDetails");
  if (!container) return;

  if (!selectedOrder) {
    container.innerHTML = emptyStateHTML(
      "📦",
      "No shipment selected",
      "Choose a shipment from the list to review it."
    );
    return;
  }

  const order = selectedOrder;

  container.innerHTML = `
    <div class="metric-row">
      <span class="metric-label">Shipment</span>
      <strong>${escapeHTML(order.order_number)}</strong>
    </div>
    <div class="metric-row">
      <span class="metric-label">Destination</span>
      <strong>${escapeHTML(order.destination)}</strong>
    </div>
    <div class="metric-row">
      <span class="metric-label">Current Status</span>
      <span class="badge ${statusBadgeClass(order.status)}">${escapeHTML(order.status)}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Risk Level</span>
      <span class="badge ${riskBadgeClass(order.risk)}">${escapeHTML(order.risk)}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Estimated Arrival</span>
      <strong>${escapeHTML(formatETA(order.eta))}</strong>
    </div>
    <div class="metric-row">
      <span class="metric-label">Estimated Delay</span>
      <strong>${escapeHTML(String(order.delay_minutes))} min</strong>
    </div>
  `;

  updateScenarioUI();
}

function initializeScenarioControls() {
  document.querySelectorAll("[data-scenario]").forEach(button => {
    button.addEventListener("click", () => {
      const scenario = button.dataset.scenario;

      if (!scenarioData[scenario]) return;

      selectedScenario = scenario;
      updateScenarioUI();
    });
  });

  updateScenarioUI();
}

function updateScenarioUI() {
  document.querySelectorAll("[data-scenario]").forEach(button => {
    const active = button.dataset.scenario === selectedScenario;

    button.classList.toggle("selected", active);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const scenario = scenarioData[selectedScenario];
  if (!scenario) return;

  const result = document.getElementById("scenarioResult");

  if (result) {
    result.className = "alert alert-info";
    result.textContent = selectedOrder
      ? `${scenario.label}: ${scenario.description} Selected shipment: ${selectedOrder.order_number}. ${scenario.risk}`
      : `${scenario.label}: ${scenario.description} Select a shipment before submitting a decision.`;
  }
}

function resetDecisionForm() {
  selectedOrder = null;
  selectedScenario = "current";

  const select = document.getElementById("decisionOrderSelect");
  const reason = document.getElementById("decisionReason");

  if (select) select.value = "";
  if (reason) reason.value = "";

  renderSelectedOrder();
  updateScenarioUI();
}

async function submitDecision() {
  if (!selectedOrder) {
    showToast("Select a shipment", "Choose a shipment before submitting a decision.", "warning");
    return;
  }

  const scenario = scenarioData[selectedScenario];
  if (!scenario) return;

  const reason = getInputValue("decisionReason").trim();

  if (!reason) {
    showToast("Reason required", "Enter a reason for the selected operational decision.", "warning");
    return;
  }

  const payload = {
    operator_name: operatorProfile.name,
    order_number: selectedOrder.order_number,
    decision: scenario.decision,
    reason
  };

  const button = document.getElementById("acceptScenarioBtn");

  if (button) {
    button.disabled = true;
    button.textContent = "Submitting...";
  }

  try {
    await fetchJSON("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const localDecision = normalizeDecision({
      ...payload,
      created_at: new Date().toISOString(),
      source: "operator-console"
    });

    const key = decisionKey(localDecision);

    if (!decisions.some(item => decisionKey(item) === key)) {
      decisions.unshift(localDecision);
      decisions = decisions.slice(0, 500);
    }

    addAlert({
      title: "Decision submitted",
      message: `${scenario.decision} submitted for shipment ${selectedOrder.order_number}.`,
      severity: "info"
    });

    showToast("Decision submitted", `${scenario.decision} recorded successfully.`, "success");

    // Update the shipment only after the decision endpoint succeeds.
    // If the backend does not support this route, the decision remains recorded
    // but the shipment status will be refreshed from the backend.
    if (["Reroute", "Continue", "Hold"].includes(scenario.decision)) {
      await tryUpdateOrderAfterDecision(selectedOrder, scenario.decision);
    }

    await refreshAllData();
    renderDecisionLog();
    updateHandoverSummary();
  } catch (error) {
    console.error("Decision submission failed:", error);
    showToast(
      "Decision submission failed",
      "The backend rejected or could not receive the decision. Check the server terminal and API route.",
      "error"
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Submit Decision";
    }
  }
}

async function tryUpdateOrderAfterDecision(order, decision) {
  const body = {
    decision,
    operator_name: operatorProfile.name
  };

  try {
    await fetchJSON(`/api/orders/${encodeURIComponent(order.order_number)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    console.warn("Optional shipment update was not accepted:", error.message);
  }
}

/* ==================== AFFECTED SHIPMENTS ==================== */

function getAffectedOrders() {
  return orders.filter(order => {
    const risk = normalizeRisk(order.risk);

    return ["high", "critical"].includes(risk) ||
      toNumber(order.delay_minutes, 0) > 0;
  });
}

function renderAffectedShipments() {
  const tbody = document.getElementById("affectedShipmentsTable");
  if (!tbody) return;

  const filter = getInputValue("impactRiskFilter") || "all";

  let affected = getAffectedOrders();

  if (filter !== "all") {
    affected = affected.filter(order => normalizeRisk(order.risk) === filter);
  }

  if (!affected.length) {
    tbody.innerHTML = `<tr><td colspan="6">No shipments match the selected filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = affected.map(order => {
    const disruption = disruptions[0];

    return `
      <tr>
        <td>${escapeHTML(order.order_number)}</td>
        <td>${escapeHTML(order.destination)}</td>
        <td><span class="badge ${riskBadgeClass(order.risk)}">${escapeHTML(order.risk)}</span></td>
        <td>${escapeHTML(String(order.delay_minutes))} min</td>
        <td>${escapeHTML(disruption ? disruption.title : "No linked event")}</td>
        <td>
          <button class="btn btn-primary btn-sm" data-impact-review="${escapeHTML(order.order_number)}">
            Review
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-impact-review]").forEach(button => {
    button.addEventListener("click", () => {
      selectOrderForDecision(button.dataset.impactReview);
      showPage("decision");
    });
  });
}

/* ==================== WHAT-IF PLANNING ==================== */

function runWhatIfAnalysis() {
  const selectedNumber = getInputValue("whatIfOrderSelect");
  const disruptionType = getInputValue("whatIfDisruption") || "traffic";
  const delay = clamp(toNumber(getInputValue("whatIfDelay"), 30), 0, 1440);
  const severity = normalizeRisk(getInputValue("whatIfSeverity") || "medium");

  const sourceOrders = selectedNumber
    ? orders.filter(order => String(order.order_number) === selectedNumber)
    : orders;

  if (!sourceOrders.length) {
    showToast("No shipments available", "Load shipment data before running the what-if analysis.", "warning");
    return;
  }

  const severityExtra = {
    low: 0,
    medium: 10,
    high: 25,
    critical: 45
  }[severity] ?? 10;

  const strategies = [
    {
      name: "Continue Current Route",
      multiplier: 1,
      note: "Maintains the current plan; disruption impact may remain."
    },
    {
      name: "Alternative Route",
      multiplier: 0.65,
      note: "Illustrative reduced delay; an actual alternative route must be validated."
    },
    {
      name: "Hold and Reassess",
      multiplier: 1.2,
      note: "Allows reassessment but may add waiting time."
    }
  ];

  whatIfResults = [];

  sourceOrders.forEach(order => {
    strategies.forEach(strategy => {
      const estimatedDelay = Math.round(
        Math.max(0, toNumber(order.delay_minutes, 0) + delay * strategy.multiplier + severityExtra)
      );

      whatIfResults.push({
        order_number: order.order_number,
        strategy: strategy.name,
        delay: estimatedDelay,
        risk: deriveRiskFromDelay(estimatedDelay, severity),
        note: `${disruptionType.replace(/_/g, " ")}: ${strategy.note}`
      });
    });
  });

  renderWhatIfResults();

  const result = document.getElementById("whatIfScenarioResult");

  if (result) {
    const affectedCount = sourceOrders.length;
    const best = whatIfResults.reduce((min, item) =>
      item.delay < min.delay ? item : min
    , whatIfResults[0]);

    result.className = "alert alert-info";
    result.innerHTML = `
      <strong>Analysis complete</strong>
      <p>Shipments assessed: ${affectedCount}</p>
      <p>Hypothetical disruption: ${escapeHTML(disruptionType.replace(/_/g, " "))}</p>
      <p>Configured delay: ${delay} minutes</p>
      <p>Severity: ${escapeHTML(severity)}</p>
      <p>Lowest illustrative delay: ${best.delay} minutes using ${escapeHTML(best.strategy)}.</p>
      <p class="form-help">These are estimates, not live route calculations.</p>
    `;
  }

  showToast("What-if analysis complete", "Illustrative strategy comparison has been generated.", "success");
}

function renderWhatIfResults() {
  const tbody = document.getElementById("whatIfResultsTable");
  if (!tbody) return;

  if (!whatIfResults.length) {
    tbody.innerHTML = `<tr><td colspan="4">Run an analysis to see comparison results.</td></tr>`;
    return;
  }

  tbody.innerHTML = whatIfResults.map(item => `
    <tr>
      <td>
        <strong>${escapeHTML(item.strategy)}</strong>
        <div class="table-secondary-text">Shipment ${escapeHTML(item.order_number)}</div>
      </td>
      <td>${item.delay} min</td>
      <td><span class="badge ${riskBadgeClass(item.risk)}">${escapeHTML(item.risk)}</span></td>
      <td>${escapeHTML(item.note)}</td>
    </tr>
  `).join("");
}

function deriveRiskFromDelay(delay, severity) {
  if (severity === "critical" || delay >= 120) return "critical";
  if (severity === "high" || delay >= 60) return "high";
  if (severity === "medium" || delay >= 30) return "medium";
  return "low";
}

/* ==================== TRIGGER SETTINGS ==================== */

function initializeTriggers() {
  document.querySelectorAll("[data-trigger]").forEach(input => {
    const key = input.dataset.trigger;

    if (Object.prototype.hasOwnProperty.call(triggerSettings, key)) {
      input.checked = Boolean(triggerSettings[key]);
    }

    input.addEventListener("change", async () => {
      triggerSettings[key] = input.checked;
      saveStoredObject(TRIGGER_STORAGE_KEY, triggerSettings);

      if (key === "browserNotifications" && input.checked) {
        if (!("Notification" in window)) {
          input.checked = false;
          triggerSettings[key] = false;
          saveStoredObject(TRIGGER_STORAGE_KEY, triggerSettings);
          showToast("Notifications unsupported", "This browser does not support desktop notifications.", "warning");
          return;
        }

        const permission = await Notification.requestPermission();

        if (permission !== "granted") {
          input.checked = false;
          triggerSettings[key] = false;
          saveStoredObject(TRIGGER_STORAGE_KEY, triggerSettings);
          showToast("Permission not granted", "Browser notifications remain disabled.", "warning");
          return;
        }
      }

      showToast(
        "Trigger preference updated",
        `${input.parentElement.previousElementSibling?.querySelector(".rule-title")?.textContent || key} ${input.checked ? "enabled" : "disabled"}.`,
        "success"
      );
    });
  });
}

function resetTriggers() {
  triggerSettings = { ...DEFAULT_TRIGGERS };
  saveStoredObject(TRIGGER_STORAGE_KEY, triggerSettings);

  document.querySelectorAll("[data-trigger]").forEach(input => {
    input.checked = Boolean(triggerSettings[input.dataset.trigger]);
  });

  showToast("Trigger preferences reset", "Default local monitoring preferences restored.", "success");
}

/* ==================== DECISION LOG ==================== */

function normalizeDecision(decision = {}) {
  return {
    ...decision,
    order_number: String(firstValue(
      decision.order_number,
      decision.orderNumber,
      decision.shipment_id,
      "Unknown"
    )),
    decision: String(firstValue(decision.decision, decision.action, "Unknown")),
    reason: String(firstValue(decision.reason, decision.notes, "")),
    operator_name: String(firstValue(
      decision.operator_name,
      decision.operatorName,
      operatorProfile.name
    )),
    created_at: firstValue(
      decision.created_at,
      decision.createdAt,
      decision.timestamp,
      new Date().toISOString()
    ),
    source: firstValue(decision.source, "backend")
  };
}

function decisionKey(decision) {
  return [
    decision.order_number,
    decision.decision,
    decision.reason,
    decision.operator_name,
    decision.created_at
  ].join("|");
}

function renderDecisionLog() {
  const tbody = document.getElementById("decisionLogTable");
  if (!tbody) return;

  const query = getInputValue("decisionLogSearch").toLowerCase();

  const filtered = decisions.filter(decision => [
    decision.order_number,
    decision.decision,
    decision.reason,
    decision.operator_name,
    decision.source
  ].join(" ").toLowerCase().includes(query));

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6">No matching decisions.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(decision => `
    <tr>
      <td>${escapeHTML(formatDateTime(decision.created_at))}</td>
      <td>${escapeHTML(decision.order_number)}</td>
      <td><span class="badge badge-primary">${escapeHTML(decision.decision)}</span></td>
      <td>${escapeHTML(decision.reason)}</td>
      <td>${escapeHTML(decision.operator_name)}</td>
      <td>${escapeHTML(decision.source)}</td>
    </tr>
  `).join("");
}

function exportDecisionsCSV() {
  if (!decisions.length) {
    showToast("No decisions to export", "The decision log is currently empty.", "info");
    return;
  }

  const rows = [
    ["Time", "Shipment", "Decision", "Reason", "Operator", "Source"],
    ...decisions.map(item => [
      formatDateTime(item.created_at),
      item.order_number,
      item.decision,
      item.reason,
      item.operator_name,
      item.source
    ])
  ];

  const csv = rows.map(row =>
    row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")
  ).join("\r\n");

  downloadBlob(csv, "logix-ai-decisions.csv", "text/csv;charset=utf-8;");
}

/* ==================== SHIFT HANDOVER ==================== */

function updateHandoverSummary() {
  setText("handoverOrderCount", orders.length);
  setText("handoverRiskCount", getAffectedOrders().length);
  setText("handoverDisruptionCount", disruptions.length);
  setText("handoverDecisionCount", decisions.length);
}

function createHandover() {
  const notes = getInputValue("handoverNotes").trim();

  const report = {
    title: "LOGIX AI — Shift Handover Report",
    generatedAt: new Date().toISOString(),
    operator: operatorProfile.name,
    shift: operatorProfile.shift,
    totalOrders: orders.length,
    activeOrders: orders.filter(isActiveOrder).length,
    affectedOrders: getAffectedOrders().length,
    criticalOrders: orders.filter(order => normalizeRisk(order.risk) === "critical").length,
    drivers: drivers.length,
    activeDrivers: drivers.filter(isDriverActive).length,
    disruptions: disruptions.length,
    decisions: decisions.length,
    notes
  };

  currentHandoverText = [
    report.title,
    `Generated: ${formatDateTime(report.generatedAt)}`,
    `Operator: ${report.operator}`,
    `Shift: ${report.shift}`,
    "",
    "OPERATIONAL SUMMARY",
    `Total shipments: ${report.totalOrders}`,
    `Active shipments: ${report.activeOrders}`,
    `Affected/high-risk shipments: ${report.affectedOrders}`,
    `Critical-risk shipments: ${report.criticalOrders}`,
    `Drivers loaded: ${report.drivers}`,
    `Active drivers: ${report.activeDrivers}`,
    `Known disruptions: ${report.disruptions}`,
    `Session decisions: ${report.decisions}`,
    "",
    "HIGH-RISK SHIPMENTS",
    ...orders.filter(order => ["high", "critical"].includes(normalizeRisk(order.risk)))
      .map(order => `- ${order.order_number} | ${order.destination} | ${order.risk} | ${order.status}`),
    "",
    "LATEST DISRUPTIONS",
    ...disruptions.slice(0, 10)
      .map(event => `- ${event.title} | ${event.severity} | ${event.location} | ${event.message}`),
    "",
    "OPERATOR NOTES",
    notes || "No additional notes entered."
  ].join("\n");

  const container = document.getElementById("handoverReport");

  if (container) {
    container.innerHTML = `
      <div class="handover-list">
        <div class="handover-item">
          <span class="handover-item-icon">✓</span>
          <div class="handover-item-text">
            <strong>Report generated</strong><br>
            ${escapeHTML(formatDateTime(report.generatedAt))}
          </div>
        </div>
        <div class="handover-item">
          <span class="handover-item-icon">📦</span>
          <div class="handover-item-text">
            ${report.totalOrders} shipments, ${report.affectedOrders} affected/high-risk shipments,
            and ${report.criticalOrders} critical-risk shipments.
          </div>
        </div>
        <div class="handover-item">
          <span class="handover-item-icon">🚚</span>
          <div class="handover-item-text">
            ${report.activeDrivers} active drivers from ${report.drivers} loaded drivers.
          </div>
        </div>
        <div class="handover-item">
          <span class="handover-item-icon">⚠</span>
          <div class="handover-item-text">
            ${report.disruptions} known disruptions and ${report.decisions} recorded session decisions.
          </div>
        </div>
        <div class="handover-item">
          <span class="handover-item-icon">📝</span>
          <div class="handover-item-text">${escapeHTML(notes || "No additional operator notes entered.")}</div>
        </div>
      </div>
    `;
  }

  const downloadButton = document.getElementById("downloadHandoverBtn");
  if (downloadButton) downloadButton.disabled = false;

  showToast("Handover report generated", "The current loaded information has been summarized.", "success");
}

function downloadHandover() {
  if (!currentHandoverText) {
    showToast("No report available", "Generate the handover report first.", "warning");
    return;
  }

  downloadBlob(
    currentHandoverText,
    "logix-ai-shift-handover.txt",
    "text/plain;charset=utf-8;"
  );
}

/* ==================== SIMULATION LAB ==================== */

function runSimulation() {
  const delay = clamp(toNumber(getInputValue("simulationDelay"), 30), 0, 1440);
  const severity = normalizeRisk(getInputValue("simulationRisk") || "medium");
  const scope = getInputValue("simulationScope") || "all";

  let sourceOrders = [...orders];

  if (scope === "active") {
    sourceOrders = sourceOrders.filter(isActiveOrder);
  } else if (scope === "atrisk") {
    sourceOrders = sourceOrders.filter(order =>
      ["high", "critical"].includes(normalizeRisk(order.risk))
    );
  }

  if (!sourceOrders.length) {
    showToast("No shipments to simulate", "Change the scope or load shipment data first.", "warning");
    return;
  }

  simulationResults = sourceOrders.map(order => {
    const currentRisk = normalizeRisk(order.risk);
    const estimatedDelay = Math.max(0, toNumber(order.delay_minutes, 0) + delay);

    const simulatedRisk = severity === "critical"
      ? "critical"
      : severity === "high"
        ? elevateRisk(currentRisk, 2)
        : severity === "medium"
          ? elevateRisk(currentRisk, 1)
          : currentRisk;

    return {
      order_number: order.order_number,
      currentRisk,
      simulatedRisk,
      delay: estimatedDelay,
      recommendation: simulatedRisk === "critical"
        ? "Immediate operator review"
        : simulatedRisk === "high"
          ? "Review alternative response"
          : "Continue monitoring"
    };
  });

  const highRiskCount = simulationResults.filter(result =>
    ["high", "critical"].includes(result.simulatedRisk)
  ).length;

  setText("simulationAffected", simulationResults.length);
  setText("simulationHighRisk", highRiskCount);

  const summary = document.getElementById("simulationSummary");

  if (summary) {
    summary.className = highRiskCount > 0 ? "alert alert-warning" : "alert alert-info";
    summary.textContent =
      `Simulation completed for ${simulationResults.length} shipment(s). ` +
      `${highRiskCount} shipment(s) would be high or critical risk under the configured scenario. ` +
      "This simulation does not modify backend data.";
  }

  renderSimulationResults();
  showToast("Simulation complete", "Illustrative impact results are ready.", "success");
}

function renderSimulationResults() {
  const tbody = document.getElementById("simulationResultsTable");
  if (!tbody) return;

  if (!simulationResults.length) {
    tbody.innerHTML = `<tr><td colspan="5">No simulation has been run.</td></tr>`;
    return;
  }

  tbody.innerHTML = simulationResults.map(result => `
    <tr>
      <td>${escapeHTML(result.order_number)}</td>
      <td><span class="badge ${riskBadgeClass(result.currentRisk)}">${escapeHTML(result.currentRisk)}</span></td>
      <td><span class="badge ${riskBadgeClass(result.simulatedRisk)}">${escapeHTML(result.simulatedRisk)}</span></td>
      <td>${result.delay} min</td>
      <td>${escapeHTML(result.recommendation)}</td>
    </tr>
  `).join("");
}

function resetSimulation() {
  simulationResults = [];

  setText("simulationAffected", "0");
  setText("simulationHighRisk", "0");

  const summary = document.getElementById("simulationSummary");

  if (summary) {
    summary.className = "alert alert-info";
    summary.textContent = "Run a simulation to calculate illustrative impacts.";
  }

  renderSimulationResults();
}

function elevateRisk(currentRisk, levels) {
  const order = ["low", "medium", "high", "critical"];
  const index = Math.max(0, order.indexOf(normalizeRisk(currentRisk)));

  return order[Math.min(order.length - 1, index + levels)];
}

/* ==================== ALERT MANAGEMENT ==================== */

function addAlert(alert) {
  const entry = {
    id: createUniqueId(),
    title: alert.title || "Notification",
    message: alert.message || "",
    severity: normalizeRisk(alert.severity || "info"),
    createdAt: new Date().toISOString(),
    read: false
  };

  alerts.unshift(entry);
  alerts = alerts.slice(0, 50);

  renderAlerts();

  if (triggerSettings.browserNotifications &&
      "Notification" in window &&
      Notification.permission === "granted") {
    try {
      new Notification(entry.title, {
        body: entry.message
      });
    } catch (error) {
      console.warn("Browser notification could not be displayed:", error);
    }
  }

  return entry;
}

function addAlertOnce(key, alert) {
  if (alerts.some(item => item.dedupeKey === key)) return;

  const entry = {
    ...alert,
    dedupeKey: key
  };

  addAlert(entry);
}

function renderAlerts() {
  const container = document.getElementById("alertsList");
  const unread = alerts.filter(alert => !alert.read).length;
  const critical = alerts.filter(alert => alert.severity === "critical").length;

  setText("totalAlerts", alerts.length);
  setText("unreadAlerts", unread);
  setText("criticalAlerts", critical);
  setText("alertNavBadge", unread);

  const indicator = document.getElementById("notificationIndicator");
  if (indicator) indicator.hidden = unread === 0;

  setText(
    "latestAlertTime",
    alerts.length ? formatClock(new Date(alerts[0].createdAt)) : "—"
  );

  if (!container) return;

  if (!alerts.length) {
    container.innerHTML = emptyStateHTML(
      "♧",
      "No alerts yet",
      "New alerts will appear here when events are received."
    );
    return;
  }

  container.innerHTML = alerts.map(alert => `
    <article class="alert-row ${alert.read ? "" : "unread"} ${escapeHTML(alert.severity)}">
      <div class="alert-row-content">
        <div class="alert-row-title">${escapeHTML(alert.title)}</div>
        <div class="alert-row-message">${escapeHTML(alert.message)}</div>
        <div class="alert-row-time">${escapeHTML(formatDateTime(alert.createdAt))}</div>
      </div>
      <div class="flex gap-2">
        <span class="badge ${riskBadgeClass(alert.severity)}">${escapeHTML(alert.severity)}</span>
        ${alert.read ? "" : `<button class="btn btn-secondary btn-sm" data-read-alert="${escapeHTML(alert.id)}">Read</button>`}
      </div>
    </article>
  `).join("");

  container.querySelectorAll("[data-read-alert]").forEach(button => {
    button.addEventListener("click", () => {
      const alert = alerts.find(item => item.id === button.dataset.readAlert);
      if (alert) alert.read = true;
      renderAlerts();
    });
  });
}

function markAllAlertsRead() {
  alerts.forEach(alert => {
    alert.read = true;
  });

  renderAlerts();
  showToast("Alerts updated", "All alerts have been marked as read.", "success");
}

function clearAlerts() {
  alerts = [];
  renderAlerts();
  showToast("Alerts cleared", "Session alerts have been cleared.", "success");
}

/* ==================== CLOCK ==================== */

function initializeClock() {
  updateClock();
  window.setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();

  setText("liveClock", now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }));
}

function initializeDecisionTimer() {
  updateDecisionTimer();

  if (decisionTimerInterval) {
    clearInterval(decisionTimerInterval);
  }

  decisionTimerInterval = window.setInterval(() => {
    if (decisionSeconds > 0) decisionSeconds -= 1;
    updateDecisionTimer();
  }, 1000);
}

function updateDecisionTimer() {
  const timer = document.getElementById("decisionTimer");
  if (!timer) return;

  const minutes = Math.floor(decisionSeconds / 60);
  const seconds = decisionSeconds % 60;

  timer.textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  timer.classList.toggle("expired", decisionSeconds === 0);
}

/* ==================== OPERATOR PROFILE ==================== */

function initializeProfile() {
  const nameInput = document.getElementById("operatorNameInput");
  const shiftInput = document.getElementById("operatorShiftInput");

  if (nameInput) nameInput.value = operatorProfile.name || DEFAULT_OPERATOR.name;
  if (shiftInput) shiftInput.value = operatorProfile.shift || DEFAULT_OPERATOR.shift;
}

function openProfileModal() {
  const modal = document.getElementById("profileModal");
  if (modal) modal.hidden = false;
  initializeProfile();
}

function closeProfileModal() {
  const modal = document.getElementById("profileModal");
  if (modal) modal.hidden = true;
}

function saveProfile() {
  const name = getInputValue("operatorNameInput").trim();
  const shift = getInputValue("operatorShiftInput").trim();

  if (!name) {
    showToast("Operator name required", "Enter an operator name before saving.", "warning");
    return;
  }

  operatorProfile = {
    name: name.slice(0, 80),
    shift: shift || DEFAULT_OPERATOR.shift
  };

  saveStoredObject(OPERATOR_STORAGE_KEY, operatorProfile);
  updateOperatorName();

  if (socket && socket.connected) {
    socket.emit("identify", {
      role: "operator",
      operatorName: operatorProfile.name
    });
  }

  closeProfileModal();
  showToast("Profile updated", "Operator profile updated in this browser.", "success");
}

function updateOperatorName() {
  setText("operatorNameLabel", operatorProfile.name || DEFAULT_OPERATOR.name);
}

/* ==================== SEARCH ==================== */

function initializeSearch() {
  bindInput("driverSearch", renderDriverTable);
  bindInput("orderSearch", renderOrdersTable);
  bindInput("decisionLogSearch", renderDecisionLog);
}

function bindInput(id, handler) {
  const element = document.getElementById(id);
  if (element) element.addEventListener("input", handler);
}

/* ==================== GENERAL HELPERS ==================== */

function isActiveOrder(order) {
  return !["completed", "delivered", "cancelled", "canceled", "failed"].includes(
    normalizeStatus(order.status)
  );
}

function isDriverActive(driver) {
  return ["active", "online", "available", "in-transit", "in-transit"].includes(
    normalizeStatus(driver.status)
  );
}

function riskRank(risk) {
  return {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
  }[normalizeRisk(risk)] || 0;
}

function statusBadgeClass(status) {
  const value = normalizeStatus(status);

  if (["completed", "delivered", "active", "online", "available"].includes(value)) {
    return "badge-success";
  }

  if (["delayed", "pending", "waiting", "hold", "on-hold"].includes(value)) {
    return "badge-warning";
  }

  if (["failed", "cancelled", "canceled", "offline", "inactive"].includes(value)) {
    return "badge-danger";
  }

  if (["in-transit", "in-transit", "dispatched"].includes(value)) {
    return "badge-info";
  }

  return "badge-primary";
}

function riskBadgeClass(risk) {
  const value = normalizeRisk(risk);

  if (value === "critical") return "badge-danger";
  if (value === "high") return "badge-warning";
  if (value === "medium") return "badge-info";
  if (value === "low") return "badge-success";

  return "badge-primary";
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value ?? "");
}

function setProgress(id, value) {
  const element = document.getElementById(id);
  if (!element) return;

  element.style.width = `${clamp(toNumber(value, 0), 0, 100)}%`;
}

function getInputValue(id) {
  const element = document.getElementById(id);
  return element ? String(element.value ?? "") : "";
}

function firstValue(...values) {
  return values.find(value =>
    value !== undefined &&
    value !== null &&
    value !== ""
  );
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getInitials(name) {
  return String(name || "Driver")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join("");
}

function formatClock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function formatETA(value) {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function emptyStateHTML(icon, title, description) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${escapeHTML(icon)}</div>
      <h3 class="empty-state-title">${escapeHTML(title)}</h3>
      <p class="empty-state-description">${escapeHTML(description)}</p>
    </div>
  `;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function createUniqueId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadStoredObject(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? { ...fallback, ...JSON.parse(value) } : { ...fallback };
  } catch (error) {
    console.warn("Could not load browser settings:", error);
    return { ...fallback };
  }
}

function saveStoredObject(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("Could not save browser settings:", error);
  }
}

function showToast(title, message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const content = document.createElement("div");
  content.innerHTML = `
    <div class="toast-title">${escapeHTML(title)}</div>
    <div class="toast-message">${escapeHTML(message)}</div>
  `;

  toast.appendChild(content);
  container.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 5000);
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function debounce(callback, delay) {
  let timeout;

  return (...args) => {
    clearTimeout(timeout);
    timeout = window.setTimeout(() => callback(...args), delay);
  };
}

/* ==================== GLOBAL COMPATIBILITY ==================== */

window.showPage = showPage;
window.selectOrderForDecision = selectOrderForDecision;
window.createHandover = createHandover;

/* ==================== DIAGNOSTICS ==================== */

window.LOGIX_AI = {
  refresh: refreshAllData,
  getStatus: () => ({
    backendConnected: lastBackendSuccess,
    socketConnected: Boolean(socket && socket.connected),
    mapInitialized,
    mapInitializationAttempted,
    lastRefreshDate,
    lastSocketEventAt,
    driverCount: drivers.length,
    orderCount: orders.length,
    disruptionCount: disruptions.length,
    alertCount: alerts.length,
    decisionCount: decisions.length
  })
};

console.info("LOGIX AI Operator Control Center initialized.");