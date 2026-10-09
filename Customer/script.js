/* =========================================================
   LOGIX AI - CUSTOMER PORTAL
   REAL-TIME LIVE TRUCK TRACKING VERSION

   Backend:
   http://localhost:3000

   Mapping:
   Leaflet + OpenStreetMap

   Routing:
   OSRM

   Geocoding:
   Nominatim

   Realtime:
   Socket.IO
   ========================================================= */

"use strict";

const API_BASE = "http://localhost:3000/api";
const SOCKET_URL = "http://localhost:3000";

const NOMINATIM_URL =
    "https://nominatim.openstreetmap.org/search";

const OSRM_URL =
    "https://router.project-osrm.org/route/v1/driving";

let orders = [];
let disruptions = [];
let drivers = [];

let selectedOrderNumber = "ORD-1024";

let socket = null;

let trackingMap = null;
let truckMarker = null;
let routeLine = null;
let startMarker = null;
let destinationMarker = null;

let currentDriver = null;
let currentRoute = null;

let simulationTimer = null;
let simulationIndex = 0;
let simulationRunning = false;

let simulationSpeedMultiplier = 20;

let lastTruckPosition = null;

/* =========================================================
   DOM HELPERS
   ========================================================= */

function byId(id) {
    return document.getElementById(id);
}

function setText(id, value) {

    const element = byId(id);

    if (!element) {
        return;
    }

    element.textContent =
        value === null ||
        value === undefined ||
        value === ""
            ? "—"
            : value;
}

function escapeHtml(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* =========================================================
   PAGE NAVIGATION
   ========================================================= */

function showPage(pageId) {

    document
        .querySelectorAll(".page")
        .forEach(function(page) {

            page.classList.remove(
                "active-page"
            );
        });

    document
        .querySelectorAll(".nav-btn")
        .forEach(function(button) {

            button.classList.remove(
                "active"
            );

            if (
                button.dataset.page ===
                pageId
            ) {
                button.classList.add(
                    "active"
                );
            }
        });

    const page = byId(pageId);

    if (page) {
        page.classList.add(
            "active-page"
        );
    }

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

    if (
        pageId === "trackingPage"
    ) {
        setTimeout(function() {

            if (trackingMap) {
                trackingMap.invalidateSize();
            }

            updateSelectedOrder();

        }, 200);
    }
}

function setupNavigation() {

    document
        .querySelectorAll(".nav-btn")
        .forEach(function(button) {

            button.addEventListener(
                "click",
                function(event) {

                    event.preventDefault();

                    const pageId =
                        button.dataset.page;

                    if (pageId) {
                        showPage(pageId);
                    }
                }
            );
        });

    document
        .querySelectorAll(
            "[data-go-page]"
        )
        .forEach(function(button) {

            button.addEventListener(
                "click",
                function(event) {

                    event.preventDefault();

                    const pageId =
                        button.dataset.goPage;

                    if (pageId) {
                        showPage(pageId);
                    }
                }
            );
        });
}

/* =========================================================
   MODAL
   ========================================================= */

function openModal(title, message) {

    const overlay =
        byId("modalOverlay");

    const content =
        byId("modalContent");

    if (
        !overlay ||
        !content
    ) {
        return;
    }

    content.innerHTML = `
        <h2>${escapeHtml(title)}</h2>
        <div>${message}</div>
    `;

    overlay.classList.add("show");
}

function closeModal() {

    const overlay =
        byId("modalOverlay");

    if (overlay) {
        overlay.classList.remove(
            "show"
        );
    }
}

function setupModal() {

    const overlay =
        byId("modalOverlay");

    const closeButton =
        byId("modalClose");

    if (closeButton) {

        closeButton.addEventListener(
            "click",
            function(event) {

                event.preventDefault();

                closeModal();
            }
        );
    }

    if (overlay) {

        overlay.addEventListener(
            "click",
            function(event) {

                if (
                    event.target ===
                    overlay
                ) {
                    closeModal();
                }
            }
        );
    }

    document.addEventListener(
        "keydown",
        function(event) {

            if (
                event.key ===
                "Escape"
            ) {
                closeModal();
            }
        }
    );
}

/* =========================================================
   PROFILE
   ========================================================= */

function setupProfile() {

    const button =
        byId("profileButton");

    if (!button) {
        return;
    }

    button.addEventListener(
        "click",
        function(event) {

            event.preventDefault();

            openModal(
                "Customer Profile",
                `
                <strong>Arun Kumar</strong><br>
                ABC Industries<br><br>

                <strong>Email</strong><br>
                arun@abcindustries.com<br><br>

                <strong>Phone</strong><br>
                +91 98765 43210<br><br>

                <strong>Destination</strong><br>
                Chennai, Tamil Nadu
                `
            );
        }
    );
}

/* =========================================================
   SYSTEM STATUS
   ========================================================= */

function setSystemStatus(online) {

    const pill =
        document.querySelector(
            ".system-pill"
        );

    const connection =
        document.querySelector(
            ".connection-status"
        );

    if (pill) {

        if (online) {

            pill.innerHTML = `
                <span></span>
                System Online
            `;

            pill.title =
                "Connected to LOGIX AI backend";

        } else {

            pill.innerHTML = `
                <span></span>
                System Offline
            `;

            pill.title =
                "Backend unavailable";
        }
    }

    if (connection) {

        const title =
            connection.querySelector(
                "strong"
            );

        const subtitle =
            connection.querySelector(
                "small"
            );

        if (title) {

            title.textContent =
                online
                    ? "Live System"
                    : "System Offline";
        }

        if (subtitle) {

            subtitle.textContent =
                online
                    ? "Backend • Realtime Connected"
                    : "Backend unavailable";
        }
    }
}

/* =========================================================
   API
   ========================================================= */

async function apiRequest(
    endpoint,
    options = {}
) {

    const config = {
        ...options,
        headers: {
            ...(options.body
                ? {
                    "Content-Type":
                        "application/json"
                }
                : {}),
            ...(options.headers || {})
        }
    };

    const response =
        await fetch(
            API_BASE + endpoint,
            config
        );

    if (!response.ok) {

        throw new Error(
            "API error " +
            response.status
        );
    }

    const text =
        await response.text();

    if (!text) {
        return null;
    }

    try {

        return JSON.parse(text);

    } catch {

        return text;
    }
}

/* =========================================================
   ARRAY NORMALIZATION
   ========================================================= */

function extractArray(result) {

    if (Array.isArray(result)) {
        return result;
    }

    if (
        result &&
        Array.isArray(result.data)
    ) {
        return result.data;
    }

    if (
        result &&
        Array.isArray(result.orders)
    ) {
        return result.orders;
    }

    if (
        result &&
        Array.isArray(result.drivers)
    ) {
        return result.drivers;
    }

    if (
        result &&
        Array.isArray(result.disruptions)
    ) {
        return result.disruptions;
    }

    return [];
}

/* =========================================================
   ORDERS
   ========================================================= */

async function loadOrders() {

    try {

        const result =
            await apiRequest(
                "/orders"
            );

        orders =
            extractArray(result);

        renderOrders();

        updateDashboard();

        updateSelectedOrder();

        setSystemStatus(true);

        return orders;

    } catch (error) {

        console.error(
            "Unable to load orders:",
            error
        );

        setSystemStatus(false);

        return [];
    }
}

/* =========================================================
   DRIVERS
   ========================================================= */

async function loadDrivers() {

    try {

        const result =
            await apiRequest(
                "/drivers"
            );

        drivers =
            extractArray(result);

        return drivers;

    } catch (error) {

        console.error(
            "Unable to load drivers:",
            error
        );

        return [];
    }
}

/* =========================================================
   DISRUPTIONS
   ========================================================= */

async function loadDisruptions() {

    try {

        const result =
            await apiRequest(
                "/disruptions"
            );

        disruptions =
            extractArray(result);

        renderLatestDisruption();

        return disruptions;

    } catch (error) {

        console.error(
            "Unable to load disruptions:",
            error
        );

        return [];
    }
}

/* =========================================================
   ORDER HELPERS
   ========================================================= */

function getOrderNumber(order) {

    if (!order) {
        return "";
    }

    return String(
        order.order_number ||
        order.orderNumber ||
        ""
    );
}

function findOrder(orderNumber) {

    return orders.find(
        function(order) {

            return (
                getOrderNumber(order)
                    .toUpperCase() ===
                String(orderNumber)
                    .toUpperCase()
            );
        }
    );
}

function normalizeOrder(order) {

    if (!order) {
        return null;
    }

    return {

        orderNumber:
            order.order_number ||
            order.orderNumber ||
            "",

        customer:
            order.customer ||
            order.customer_name ||
            "",

        product:
            order.product ||
            order.product_name ||
            "Shipment",

        origin:
            order.origin ||
            "",

        destination:
            order.destination ||
            "",

        status:
            order.status ||
            "Unknown",

        priority:
            order.priority ||
            "Normal",

        originalEta:
            order.original_eta ||
            order.originalEta ||
            "",

        revisedEta:
            order.revised_eta ||
            order.revisedEta ||
            "",

        deadline:
            order.deadline ||
            "",

        risk:
            order.risk ||
            "Low",

        driverId:
            order.driver_id ||
            order.driverId ||
            null
    };
}

/* =========================================================
   STATUS
   ========================================================= */

function getStatusClass(status) {

    const value =
        String(status || "")
            .toLowerCase();

    if (
        value.includes("transit") ||
        value.includes("rerout")
    ) {
        return "transit";
    }

    if (
        value.includes("ready") ||
        value.includes("prepar") ||
        value.includes("loading")
    ) {
        return "preparing";
    }

    if (
        value.includes("deliver")
    ) {
        return "delivered";
    }

    return "preparing";
}

function getPriorityClass(priority) {

    return String(
        priority || ""
    )
        .toLowerCase()
        .includes("high")
        ? "high"
        : "normal";
}

/* =========================================================
   RENDER ORDERS
   ========================================================= */

function renderOrders() {

    const table =
        byId("ordersTable");

    if (!table) {
        return;
    }

    const tbody =
        table.querySelector("tbody");

    if (!tbody) {
        return;
    }

    tbody.innerHTML = "";

    orders.forEach(
        function(rawOrder) {

            const order =
                normalizeOrder(
                    rawOrder
                );

            if (
                !order ||
                !order.orderNumber
            ) {
                return;
            }

            const row =
                document.createElement(
                    "tr"
                );

            row.className =
                "order-row";

            row.dataset.order =
                order.orderNumber;

            row.dataset.status =
                getStatusClass(
                    order.status
                );

            row.innerHTML = `
                <td>
                    <strong>
                        #${escapeHtml(
                            order.orderNumber
                        )}
                    </strong>
                    <small>
                        Live database order
                    </small>
                </td>

                <td>
                    ${escapeHtml(
                        order.product
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        order.destination
                    )}
                </td>

                <td>
                    <span class="status-chip ${
                        getStatusClass(
                            order.status
                        )
                    }">
                        ${escapeHtml(
                            order.status
                        )}
                    </span>
                </td>

                <td>
                    ${escapeHtml(
                        order.revisedEta ||
                        order.originalEta ||
                        "—"
                    )}
                </td>

                <td>
                    <span class="priority ${
                        getPriorityClass(
                            order.priority
                        )
                    }">
                        ${escapeHtml(
                            order.priority
                        )}
                    </span>
                </td>
            `;

            row.addEventListener(
                "click",
                function() {

                    selectedOrderNumber =
                        order.orderNumber;

                    showOrderDetails(
                        order
                    );
                }
            );

            tbody.appendChild(row);
        }
    );

    filterOrders();
}

/* =========================================================
   ORDER DETAILS
   ========================================================= */

function showOrderDetails(
    rawOrder
) {

    const order =
        normalizeOrder(
            rawOrder
        );

    if (!order) {
        return;
    }

    setText(
        "detailOrderId",
        "#" + order.orderNumber
    );

    setText(
        "detailProduct",
        order.product
    );

    setText(
        "detailDestination",
        order.destination
    );

    setText(
        "detailStatus",
        order.status
    );

    setText(
        "detailEta",
        order.revisedEta ||
        order.originalEta ||
        "—"
    );

    setText(
        "detailPriority",
        order.priority
    );

    const details =
        byId("orderDetails");

    if (details) {
        details.classList.add(
            "show"
        );
    }
}

function setupOrderDetails() {

    const closeButton =
        byId("closeOrderDetails");

    const details =
        byId("orderDetails");

    if (closeButton) {

        closeButton.addEventListener(
            "click",
            function() {

                if (details) {
                    details.classList.remove(
                        "show"
                    );
                }
            }
        );
    }

    if (details) {

        details.addEventListener(
            "click",
            function(event) {

                if (
                    event.target ===
                    details
                ) {
                    details.classList.remove(
                        "show"
                    );
                }
            }
        );
    }
}

/* =========================================================
   DASHBOARD
   ========================================================= */

function updateDashboard() {

    const normalized =
        orders
            .map(normalizeOrder)
            .filter(Boolean);

    const active =
        normalized.filter(
            function(order) {

                return !String(
                    order.status
                )
                    .toLowerCase()
                    .includes("deliver");
            }
        ).length;

    const transit =
        normalized.filter(
            function(order) {

                const status =
                    String(
                        order.status
                    ).toLowerCase();

                return (
                    status.includes(
                        "transit"
                    ) ||
                    status.includes(
                        "rerout"
                    )
                );
            }
        ).length;

    const atRisk =
        normalized.filter(
            function(order) {

                const risk =
                    String(
                        order.risk
                    ).toLowerCase();

                return (
                    risk.includes(
                        "high"
                    ) ||
                    risk.includes(
                        "critical"
                    ) ||
                    risk.includes(
                        "medium"
                    )
                );
            }
        ).length;

    const delivered =
        normalized.filter(
            function(order) {

                return String(
                    order.status
                )
                    .toLowerCase()
                    .includes(
                        "deliver"
                    );
            }
        ).length;

    const cards =
        document.querySelectorAll(
            ".summary-card"
        );

    if (cards[0]) {
        setSummaryValue(
            cards[0],
            active
        );
    }

    if (cards[1]) {
        setSummaryValue(
            cards[1],
            transit
        );
    }

    if (cards[2]) {
        setSummaryValue(
            cards[2],
            atRisk
        );
    }

    if (cards[3]) {
        setSummaryValue(
            cards[3],
            delivered
        );
    }
}

function setSummaryValue(
    card,
    value
) {

    const strong =
        card.querySelector(
            "strong"
        );

    if (strong) {
        strong.textContent =
            value;
    }
}

/* =========================================================
   CURRENT DELIVERY
   ========================================================= */

function updateDashboardDelivery(
    order
) {

    if (!order) {
        return;
    }

    const orderLabel =
        document.querySelector(
            ".delivery-main-card .order-label"
        );

    if (orderLabel) {

        orderLabel.textContent =
            "ORDER #" +
            order.orderNumber;
    }

    const header =
        document.querySelector(
            ".delivery-main-card .delivery-header h2"
        );

    if (header) {

        header.textContent =
            order.product +
            " Shipment";
    }

    const route =
        document.querySelector(
            ".delivery-main-card .route-text"
        );

    if (route) {

        route.innerHTML = `
            <span>
                📍 ${escapeHtml(
                    order.origin
                )}
            </span>

            <b>→</b>

            <span>
                📍 ${escapeHtml(
                    order.destination
                )}
            </span>
        `;
    }

    updateRiskDisplay(order);

    updateRouteOverview(order);
}

/* =========================================================
   RISK
   ========================================================= */

function updateRiskDisplay(
    order
) {

    const indicator =
        byId("riskIndicator");

    const icon =
        byId("riskIcon");

    const status =
        byId("riskStatus");

    const message =
        byId("riskMessage");

    const risk =
        String(
            order.risk ||
            "low"
        ).toLowerCase();

    if (indicator) {

        indicator.classList.remove(
            "safe",
            "at-risk",
            "critical"
        );
    }

    let className =
        "safe";

    let emoji =
        "🟢";

    let label =
        "SAFE";

    let text =
        "Delivery is currently within the expected schedule.";

    if (
        risk.includes("critical") ||
        risk.includes("high")
    ) {

        className =
            "critical";

        emoji =
            "🔴";

        label =
            "CRITICAL";

        text =
            "Immediate attention may be required.";

    } else if (
        risk.includes("medium") ||
        risk.includes("risk")
    ) {

        className =
            "at-risk";

        emoji =
            "🟠";

        label =
            "AT RISK";

        text =
            "Delivery is approaching the expected deadline.";
    }

    if (indicator) {

        indicator.classList.add(
            className
        );
    }

    if (icon) {
        icon.textContent =
            emoji;
    }

    if (status) {
        status.textContent =
            label;
    }

    if (message) {
        message.textContent =
            text;
    }

    updateTimeRemaining(
        order
    );
}

/* =========================================================
   TIME
   ========================================================= */

function parseTimeString(
    value
) {

    if (!value) {
        return null;
    }

    const match =
        String(value)
            .trim()
            .match(
                /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i
            );

    if (!match) {
        return null;
    }

    let hour =
        Number(match[1]);

    const minute =
        Number(match[2]);

    const period =
        match[3].toUpperCase();

    if (
        period === "PM" &&
        hour !== 12
    ) {
        hour += 12;
    }

    if (
        period === "AM" &&
        hour === 12
    ) {
        hour = 0;
    }

    const date =
        new Date();

    date.setHours(
        hour,
        minute,
        0,
        0
    );

    return date;
}

function updateTimeRemaining(
    order
) {

    const element =
        byId("timeRemaining");

    if (!element) {
        return;
    }

    const deadline =
        parseTimeString(
            order.deadline
        );

    if (!deadline) {

        element.textContent =
            "—";

        return;
    }

    const now =
        new Date();

    let difference =
        Math.round(
            (
                deadline.getTime() -
                now.getTime()
            ) / 60000
        );

    if (difference < 0) {
        difference = 0;
    }

    element.textContent =
        difference +
        " min";
}

/* =========================================================
   ROUTE OVERVIEW
   ========================================================= */

function updateRouteOverview(
    order
) {

    const cards =
        document.querySelectorAll(
            ".overview-card"
        );

    if (
        cards.length < 4
    ) {
        return;
    }

    setOverviewValue(
        cards[0],
        order.origin || "—"
    );

    setOverviewValue(
        cards[1],
        String(
            order.status
        )
            .toLowerCase()
            .includes("rerout")
            ? "Alternate Route"
            : "Original Route"
    );

    setOverviewValue(
        cards[2],
        currentDriver
            ? currentDriver.name
            : "Loading..."
    );

    setOverviewValue(
        cards[3],
        currentDriver
            ? currentDriver.vehicle_number
            : "Loading..."
    );
}

function setOverviewValue(
    card,
    value
) {

    const strong =
        card.querySelector(
            "strong"
        );

    if (strong) {
        strong.textContent =
            value;
    }
}

/* =========================================================
   LEAFLET MAP
   ========================================================= */

function initializeTrackingMap() {

    const mapElement =
        byId("trackingMap");

    if (
        !mapElement ||
        typeof L === "undefined"
    ) {
        console.error(
            "Leaflet or trackingMap is missing."
        );

        return;
    }

    if (trackingMap) {

        trackingMap.invalidateSize();

        return;
    }

    trackingMap =
        L.map(
            mapElement,
            {
                zoomControl: true
            }
        ).setView(
            [11.0168, 76.9558],
            7
        );

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution:
                "&copy; OpenStreetMap contributors"
        }
    ).addTo(
        trackingMap
    );
}

/* =========================================================
   TRUCK ICON
   ========================================================= */

function createTruckIcon() {

    return L.divIcon({

        className:
            "logix-truck-marker",

        html: `
            <div style="
                width:48px;
                height:48px;
                border-radius:50%;
                background:#2563eb;
                border:4px solid white;
                box-shadow:0 4px 15px rgba(0,0,0,.35);
                display:flex;
                align-items:center;
                justify-content:center;
                font-size:25px;
            ">
                🚛
            </div>
        `,

        iconSize: [
            48,
            48
        ],

        iconAnchor: [
            24,
            24
        ]
    });
}

/* =========================================================
   UPDATE TRUCK MARKER
   ========================================================= */

function updateTruckMarker(
    latitude,
    longitude,
    pan = true
) {

    if (
        !trackingMap ||
        !Number.isFinite(
            Number(latitude)
        ) ||
        !Number.isFinite(
            Number(longitude)
        )
    ) {
        return;
    }

    const lat =
        Number(latitude);

    const lng =
        Number(longitude);

    lastTruckPosition = {
        latitude: lat,
        longitude: lng
    };

    if (!truckMarker) {

        truckMarker =
            L.marker(
                [lat, lng],
                {
                    icon:
                        createTruckIcon(),
                    zIndexOffset:
                        1000
                }
            )
                .addTo(
                    trackingMap
                )
                .bindPopup(
                    "LOGIX AI Truck"
                );

    } else {

        truckMarker.setLatLng(
            [lat, lng]
        );
    }

    if (pan) {

        trackingMap.panTo(
            [lat, lng],
            {
                animate: true,
                duration: 0.5
            }
        );
    }

    updateLiveLocationDisplay(
        lat,
        lng
    );
}

/* =========================================================
   LIVE LOCATION DISPLAY
   ========================================================= */

function updateLiveLocationDisplay(
    latitude,
    longitude
) {

    setText(
        "trackingLatitude",
        Number(latitude)
            .toFixed(6)
    );

    setText(
        "trackingLongitude",
        Number(longitude)
            .toFixed(6)
    );

    const live =
        byId("trackingLiveLocation");

    if (live) {

        live.textContent =
            Number(latitude).toFixed(6) +
            ", " +
            Number(longitude).toFixed(6);
    }
}

/* =========================================================
   DRIVER DISPLAY
   ========================================================= */

function updateDriverDisplay(
    driver
) {

    if (!driver) {
        return;
    }

    setText(
        "trackingVehicle",
        driver.vehicle_number ||
        driver.vehicleNumber ||
        "—"
    );

    setText(
        "trackingDriver",
        driver.name ||
        "—"
    );

    setText(
        "trackingStatus",
        driver.status ||
        "—"
    );

    setText(
        "trackingSpeed",
        driver.speed !== null &&
        driver.speed !== undefined
            ? Number(driver.speed)
                .toFixed(1) +
              " km/h"
            : "—"
    );

    if (
        driver.latitude !== null &&
        driver.latitude !== undefined &&
        driver.longitude !== null &&
        driver.longitude !== undefined
    ) {

        updateTruckMarker(
            Number(driver.latitude),
            Number(driver.longitude),
            false
        );
    }
}

/* =========================================================
   FIND DRIVER FOR ORDER
   ========================================================= */

async function loadDriverForTracking(
    order
) {

    if (!order) {
        return null;
    }

    if (!drivers.length) {
        await loadDrivers();
    }

    let driver =
        drivers.find(
            function(item) {

                return String(
                    item.id
                ) === String(
                    order.driverId
                );
            }
        );

    if (!driver) {

        driver =
            drivers.find(
                function(item) {

                    return String(
                        item.driver_id
                    ) === String(
                        order.driverId
                    );
                }
            );
    }

    if (!driver) {

        console.warn(
            "Driver not found for order:",
            order.orderNumber,
            order.driverId
        );

        return null;
    }

    currentDriver =
        driver;

    updateDriverDisplay(
        driver
    );

    updateRouteOverview(
        order
    );

    return driver;
}

/* =========================================================
   GEOCODING
   ========================================================= */

async function geocodePlace(
    place
) {

    if (!place) {
        return null;
    }

    try {

        const url =
            NOMINATIM_URL +
            "?format=jsonv2" +
            "&limit=1" +
            "&countrycodes=in" +
            "&q=" +
            encodeURIComponent(
                place +
                ", Tamil Nadu, India"
            );

        const response =
            await fetch(
                url,
                {
                    headers: {
                        "Accept":
                            "application/json"
                    }
                }
            );

        if (!response.ok) {
            throw new Error(
                "Geocoding failed"
            );
        }

        const results =
            await response.json();

        if (
            !results ||
            !results.length
        ) {
            return null;
        }

        return {

            latitude:
                Number(
                    results[0].lat
                ),

            longitude:
                Number(
                    results[0].lon
                ),

            displayName:
                results[0].display_name
        };

    } catch (error) {

        console.error(
            "Geocoding error:",
            place,
            error
        );

        return null;
    }
}

/* =========================================================
   REAL ROAD ROUTE
   ========================================================= */

async function getRoadRoute(
    start,
    end
) {

    const url =
        OSRM_URL +
        "/" +
        start.longitude +
        "," +
        start.latitude +
        ";" +
        end.longitude +
        "," +
        end.latitude +
        "?overview=full" +
        "&geometries=geojson" +
        "&steps=true";

    const response =
        await fetch(url);

    if (!response.ok) {

        throw new Error(
            "OSRM routing failed"
        );
    }

    const data =
        await response.json();

    if (
        data.code !== "Ok" ||
        !data.routes ||
        !data.routes.length
    ) {

        throw new Error(
            "No road route available"
        );
    }

    const route =
        data.routes[0];

    return {

        coordinates:
            route.geometry.coordinates,

        distanceKm:
            route.distance / 1000,

        durationMinutes:
            route.duration / 60,

        raw:
            route
    };
}

/* =========================================================
   DISPLAY REAL ROUTE
   ========================================================= */

async function displayRealRoute(
    order
) {

    if (
        !trackingMap ||
        !order
    ) {
        return null;
    }

    const origin =
        await geocodePlace(
            order.origin
        );

    const destination =
        await geocodePlace(
            order.destination
        );

    if (!origin) {

        throw new Error(
            "Unable to locate origin: " +
            order.origin
        );
    }

    if (!destination) {

        throw new Error(
            "Unable to locate destination: " +
            order.destination
        );
    }

    const route =
        await getRoadRoute(
            origin,
            destination
        );

    currentRoute = {
        origin,
        destination,
        coordinates:
            route.coordinates,
        distanceKm:
            route.distanceKm,
        durationMinutes:
            route.durationMinutes
    };

    if (routeLine) {

        trackingMap.removeLayer(
            routeLine
        );
    }

    if (startMarker) {

        trackingMap.removeLayer(
            startMarker
        );
    }

    if (destinationMarker) {

        trackingMap.removeLayer(
            destinationMarker
        );
    }

    const latLngs =
        route.coordinates.map(
            function(point) {

                return [
                    point[1],
                    point[0]
                ];
            }
        );

    routeLine =
        L.polyline(
            latLngs,
            {
                weight: 6,
                opacity: 0.85
            }
        ).addTo(
            trackingMap
        );

    startMarker =
        L.marker(
            [
                origin.latitude,
                origin.longitude
            ]
        )
            .addTo(
                trackingMap
            )
            .bindPopup(
                "Origin<br>" +
                escapeHtml(
                    order.origin
                )
            );

    destinationMarker =
        L.marker(
            [
                destination.latitude,
                destination.longitude
            ]
        )
            .addTo(
                trackingMap
            )
            .bindPopup(
                "Destination<br>" +
                escapeHtml(
                    order.destination
                )
            );

    trackingMap.fitBounds(
        routeLine.getBounds(),
        {
            padding: [
                30,
                30
            ]
        }
    );

    setText(
        "trackingRoute",
        order.origin +
        " → " +
        order.destination
    );

    setText(
        "trackingDistance",
        route.distanceKm.toFixed(1) +
        " km"
    );

    setText(
        "trackingRouteDuration",
        Math.round(
            route.durationMinutes
        ) +
        " min"
    );

    return currentRoute;
}

/* =========================================================
   CLOSEST ROUTE POINT
   ========================================================= */

function findClosestRouteIndex(
    latitude,
    longitude
) {

    if (
        !currentRoute ||
        !currentRoute.coordinates ||
        !currentRoute.coordinates.length
    ) {
        return 0;
    }

    let closestIndex = 0;
    let closestDistance =
        Infinity;

    currentRoute.coordinates.forEach(
        function(point, index) {

            const lng =
                Number(point[0]);

            const lat =
                Number(point[1]);

            const distance =
                Math.pow(
                    lat -
                    Number(latitude),
                    2
                ) +
                Math.pow(
                    lng -
                    Number(longitude),
                    2
                );

            if (
                distance <
                closestDistance
            ) {

                closestDistance =
                    distance;

                closestIndex =
                    index;
            }
        }
    );

    return closestIndex;
}

/* =========================================================
   TRACKING ORDER
   ========================================================= */

async function updateTracking(
    order
) {

    if (!order) {
        return;
    }

    const status =
        document.querySelector(
            ".tracking-status-card .current-status-box strong"
        );

    const description =
        document.querySelector(
            ".tracking-status-card .current-status-box p"
        );

    if (status) {
        status.textContent =
            order.status;
    }

    if (description) {

        description.textContent =
            "Shipment is moving toward " +
            order.destination +
            ".";
    }

    const mapHeader =
        document.querySelector(
            ".map-header span:first-child"
        );

    if (mapHeader) {

        mapHeader.textContent =
            "ORDER #" +
            order.orderNumber;
    }

    updateProgress(
        order
    );

    initializeTrackingMap();

    try {

        await loadDriverForTracking(
            order
        );

        await displayRealRoute(
            order
        );

        /*
           If the backend already has a GPS
           position, use that position.

           Otherwise place the truck at
           the beginning of the actual
           road route.
        */

        if (
            currentDriver &&
            Number.isFinite(
                Number(
                    currentDriver.latitude
                )
            ) &&
            Number.isFinite(
                Number(
                    currentDriver.longitude
                )
            )
        ) {

            updateTruckMarker(
                Number(
                    currentDriver.latitude
                ),
                Number(
                    currentDriver.longitude
                ),
                false
            );

        } else if (
            currentRoute &&
            currentRoute.coordinates
        ) {

            const first =
                currentRoute
                    .coordinates[0];

            updateTruckMarker(
                Number(first[1]),
                Number(first[0]),
                false
            );
        }

        createSimulationControls();

    } catch (error) {

        console.error(
            "Tracking map error:",
            error
        );

        setText(
            "trackingRoute",
            "Unable to calculate road route"
        );
    }
}

/* =========================================================
   SIMULATION CONTROLS
   ========================================================= */

function createSimulationControls() {

    const map =
        byId("trackingMap");

    if (!map) {
        return;
    }

    if (
        byId(
            "logixSimulationControls"
        )
    ) {
        return;
    }

    const controls =
        document.createElement(
            "div"
        );

    controls.id =
        "logixSimulationControls";

    controls.style.cssText = `
        position:relative;
        z-index:1000;
        margin-top:12px;
        padding:14px;
        border-radius:14px;
        background:#ffffff;
        border:1px solid #e5e7eb;
        box-shadow:0 4px 15px rgba(0,0,0,.08);
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        gap:10px;
    `;

    controls.innerHTML = `

        <strong>
            🚛 Live Truck
        </strong>

        <button
            id="startTruckSimulation"
            type="button"
        >
            ▶ Start Trip
        </button>

        <button
            id="pauseTruckSimulation"
            type="button"
        >
            ⏸ Pause
        </button>

        <button
            id="stopTruckSimulation"
            type="button"
        >
            ⏹ Stop
        </button>

        <label>
            Demo Speed:
            <select
                id="truckSimulationSpeed"
            >
                <option value="5">
                    5×
                </option>

                <option value="10">
                    10×
                </option>

                <option
                    value="20"
                    selected
                >
                    20×
                </option>

                <option value="50">
                    50×
                </option>

                <option value="100">
                    100×
                </option>
            </select>
        </label>

        <span
            id="truckSimulationStatus"
            style="font-weight:600;"
        >
            Ready
        </span>
    `;

    map.parentNode.insertBefore(
        controls,
        map.nextSibling
    );

    byId(
        "startTruckSimulation"
    ).addEventListener(
        "click",
        startTruckSimulation
    );

    byId(
        "pauseTruckSimulation"
    ).addEventListener(
        "click",
        pauseTruckSimulation
    );

    byId(
        "stopTruckSimulation"
    ).addEventListener(
        "click",
        stopTruckSimulation
    );

    byId(
        "truckSimulationSpeed"
    ).addEventListener(
        "change",
        function(event) {

            simulationSpeedMultiplier =
                Number(
                    event.target.value
                );
        }
    );
}

/* =========================================================
   START TRUCK SIMULATION
   ========================================================= */

async function startTruckSimulation() {

    if (
        !currentRoute ||
        !currentRoute.coordinates ||
        currentRoute.coordinates.length <
            2
    ) {

        const order =
            normalizeOrder(
                findOrder(
                    selectedOrderNumber
                )
            );

        if (!order) {
            return;
        }

        try {

            await updateTracking(
                order
            );

        } catch (error) {

            console.error(error);

            return;
        }
    }

    if (
        !currentRoute ||
        !currentRoute.coordinates
    ) {
        return;
    }

    if (simulationRunning) {
        return;
    }

    /*
       Start from current truck location
       if available.
    */

    if (lastTruckPosition) {

        simulationIndex =
            findClosestRouteIndex(
                lastTruckPosition.latitude,
                lastTruckPosition.longitude
            );

    } else {

        simulationIndex = 0;
    }

    simulationRunning = true;

    setSimulationStatus(
        "🟢 Trip running"
    );

    clearInterval(
        simulationTimer
    );

    simulationTimer =
        setInterval(
            moveSimulatedTruck,
            1000
        );

    /*
       Immediately move once.
    */

    moveSimulatedTruck();
}

/* =========================================================
   MOVE TRUCK ALONG ACTUAL ROAD
   ========================================================= */

function moveSimulatedTruck() {

    if (
        !simulationRunning ||
        !currentRoute ||
        !currentRoute.coordinates
    ) {
        return;
    }

    const coordinates =
        currentRoute.coordinates;

    if (
        simulationIndex >=
        coordinates.length - 1
    ) {

        simulationRunning =
            false;

        clearInterval(
            simulationTimer
        );

        setSimulationStatus(
            "🏁 Destination reached"
        );

        updateTruckStatus(
            "Delivered"
        );

        return;
    }

    /*
       Number of route points advanced
       per second.

       OSRM geometry can contain many
       points, therefore multiplier controls
       how quickly the demonstration runs.
    */

    const step =
        Math.max(
            1,
            Math.round(
                simulationSpeedMultiplier /
                5
            )
        );

    simulationIndex += step;

    if (
        simulationIndex >=
        coordinates.length
    ) {

        simulationIndex =
            coordinates.length - 1;
    }

    const point =
        coordinates[
            simulationIndex
        ];

    const longitude =
        Number(point[0]);

    const latitude =
        Number(point[1]);

    updateTruckMarker(
        latitude,
        longitude,
        true
    );

    /*
       Estimate demonstration speed.
    */

    const speed =
        Math.max(
            20,
            simulationSpeedMultiplier *
            2
        );

    updateTrackingSpeed(
        speed
    );

    /*
       Send the simulated GPS to backend.

       This is important:

       Customer → backend → SQLite
                      ↓
                  Socket.IO

       So other portals can receive
       the movement too.
    */

    sendDriverLocation(
        latitude,
        longitude,
        speed
    );
}

/* =========================================================
   SEND DRIVER LOCATION TO BACKEND
   ========================================================= */

async function sendDriverLocation(
    latitude,
    longitude,
    speed
) {

    if (!currentDriver) {

        console.warn(
            "No driver selected."
        );

        return;
    }

    const driverId =
        currentDriver.id ||
        currentDriver.driver_id;

    if (!driverId) {
        return;
    }

    try {

        await apiRequest(
            "/drivers/" +
            driverId +
            "/location",
            {
                method: "POST",

                body: JSON.stringify({
                    latitude:
                        Number(latitude),

                    longitude:
                        Number(longitude),

                    speed:
                        Number(speed)
                })
            }
        );

        currentDriver.latitude =
            Number(latitude);

        currentDriver.longitude =
            Number(longitude);

        currentDriver.speed =
            Number(speed);

    } catch (error) {

        console.error(
            "Unable to send truck GPS:",
            error
        );
    }
}

/* =========================================================
   PAUSE
   ========================================================= */

function pauseTruckSimulation() {

    simulationRunning =
        false;

    clearInterval(
        simulationTimer
    );

    setSimulationStatus(
        "⏸ Trip paused"
    );
}

/* =========================================================
   STOP
   ========================================================= */

function stopTruckSimulation() {

    simulationRunning =
        false;

    clearInterval(
        simulationTimer
    );

    simulationIndex = 0;

    setSimulationStatus(
        "⏹ Trip stopped"
    );

    if (
        currentRoute &&
        currentRoute.coordinates &&
        currentRoute.coordinates.length
    ) {

        const first =
            currentRoute.coordinates[0];

        updateTruckMarker(
            Number(first[1]),
            Number(first[0]),
            false
        );
    }
}

/* =========================================================
   SIMULATION STATUS
   ========================================================= */

function setSimulationStatus(
    text
) {

    const element =
        byId(
            "truckSimulationStatus"
        );

    if (element) {
        element.textContent =
            text;
    }
}

/* =========================================================
   UPDATE TRACKING SPEED
   ========================================================= */

function updateTrackingSpeed(
    speed
) {

    setText(
        "trackingSpeed",
        Number(speed).toFixed(1) +
        " km/h"
    );
}

/* =========================================================
   UPDATE TRUCK STATUS
   ========================================================= */

function updateTruckStatus(
    status
) {

    setText(
        "trackingStatus",
        status
    );
}

/* =========================================================
   PROGRESS
   ========================================================= */

function updateProgress(
    order
) {

    const steps =
        document.querySelectorAll(
            ".progress-step"
        );

    if (!steps.length) {
        return;
    }

    const status =
        String(
            order.status || ""
        ).toLowerCase();

    steps.forEach(
        function(step) {

            step.classList.remove(
                "completed",
                "current"
            );
        }
    );

    if (
        status.includes(
            "deliver"
        )
    ) {

        steps.forEach(
            function(step) {

                step.classList.add(
                    "completed"
                );
            }
        );

        return;
    }

    if (
        status.includes(
            "transit"
        ) ||
        status.includes(
            "rerout"
        )
    ) {

        steps.forEach(
            function(step, index) {

                if (index < 2) {

                    step.classList.add(
                        "completed"
                    );

                } else if (
                    index === 2
                ) {

                    step.classList.add(
                        "current"
                    );
                }
            }
        );

        return;
    }

    steps[0].classList.add(
        "current"
    );
}

/* =========================================================
   DISRUPTIONS
   ========================================================= */

function renderLatestDisruption() {

    if (
        !disruptions.length
    ) {
        return;
    }

    const disruption =
        disruptions[0];

    const type =
        disruption.type ||
        "Route";

    const location =
        disruption.location ||
        "current route";

    const title =
        document.querySelector(
            ".disruption-title h3"
        );

    const description =
        document.querySelector(
            ".disruption-content > p"
        );

    if (title) {

        title.textContent =
            type +
            " Disruption Detected";
    }

    if (description) {

        description.textContent =
            disruption.description ||
            type +
            " disruption detected at " +
            location +
            ".";
    }

    const impactTitle =
        document.querySelector(
            ".impact-card .impact-header h2"
        );

    if (impactTitle) {

        impactTitle.textContent =
            type +
            " disruption detected";
    }

    const impactDescription =
        document.querySelector(
            ".impact-card > p"
        );

    if (impactDescription) {

        impactDescription.textContent =
            disruption.description ||
            "A " +
            type +
            " disruption was detected at " +
            location +
            ".";
    }
}

/* =========================================================
   NOTIFICATIONS
   ========================================================= */

function updateNotificationCount() {

    const unread =
        document.querySelectorAll(
            ".notification-item.unread"
        ).length;

    const count =
        byId(
            "notificationCount"
        );

    const summary =
        byId(
            "alertSummary"
        );

    const navCount =
        document.querySelector(
            ".nav-alert-count"
        );

    if (count) {

        count.textContent =
            unread;

        count.style.display =
            unread === 0
                ? "none"
                : "flex";
    }

    if (summary) {

        summary.textContent =
            unread +
            (
                unread === 1
                    ? " unread notification"
                    : " unread notifications"
            );
    }

    if (navCount) {

        navCount.textContent =
            unread;

        navCount.style.display =
            unread === 0
                ? "none"
                : "flex";
    }
}

function addNotification(
    title,
    message,
    type = "warning"
) {

    const list =
        document.querySelector(
            ".notification-list"
        );

    if (!list) {
        return;
    }

    const item =
        document.createElement(
            "div"
        );

    item.className =
        "notification-item unread";

    item.innerHTML = `
        <div class="notification-icon ${
            escapeHtml(type)
        }">
            ${
                type === "success"
                    ? "✓"
                    : "⚠️"
            }
        </div>

        <div class="notification-body">

            <div class="notification-title">
                <h3>
                    ${escapeHtml(
                        title
                    )}
                </h3>

                <span>
                    Just now
                </span>
            </div>

            <p>
                ${escapeHtml(
                    message
                )}
            </p>

        </div>
    `;

    item.addEventListener(
        "click",
        function() {

            item.classList.remove(
                "unread"
            );

            item.classList.add(
                "read"
            );

            updateNotificationCount();
        }
    );

    list.prepend(item);

    updateNotificationCount();
}

function setupNotifications() {

    document
        .querySelectorAll(
            ".notification-item"
        )
        .forEach(
            function(item) {

                item.addEventListener(
                    "click",
                    function() {

                        item.classList.remove(
                            "unread"
                        );

                        item.classList.add(
                            "read"
                        );

                        updateNotificationCount();
                    }
                );
            }
        );

    const markAll =
        byId(
            "markAllRead"
        );

    if (markAll) {

        markAll.addEventListener(
            "click",
            function(event) {

                event.preventDefault();

                document
                    .querySelectorAll(
                        ".notification-item.unread"
                    )
                    .forEach(
                        function(item) {

                            item.classList.remove(
                                "unread"
                            );

                            item.classList.add(
                                "read"
                            );
                        }
                    );

                updateNotificationCount();
            }
        );
    }

    const notificationButton =
        byId(
            "notificationButton"
        );

    if (notificationButton) {

        notificationButton.addEventListener(
            "click",
            function(event) {

                event.preventDefault();

                showPage(
                    "alertsPage"
                );
            }
        );
    }

    updateNotificationCount();
}

/* =========================================================
   SEARCH
   ========================================================= */

function filterOrders() {

    const rows =
        document.querySelectorAll(
            ".order-row"
        );

    const searchInput =
        byId(
            "orderSearch"
        );

    const statusSelect =
        byId(
            "statusFilter"
        );

    const empty =
        byId(
            "emptyOrders"
        );

    const search =
        searchInput
            ? searchInput.value
                .toLowerCase()
                .trim()
            : "";

    const selectedStatus =
        statusSelect
            ? statusSelect.value
            : "all";

    let visible = 0;

    rows.forEach(
        function(row) {

            const text =
                row.textContent
                    .toLowerCase();

            const status =
                row.dataset.status ||
                "";

            const matchesSearch =
                text.includes(
                    search
                );

            const matchesStatus =
                selectedStatus ===
                    "all" ||
                status ===
                    selectedStatus;

            if (
                matchesSearch &&
                matchesStatus
            ) {

                row.style.display =
                    "";

                visible++;

            } else {

                row.style.display =
                    "none";
            }
        }
    );

    if (empty) {

        empty.style.display =
            visible === 0
                ? "block"
                : "none";
    }
}

function setupSearch() {

    const search =
        byId(
            "orderSearch"
        );

    const filter =
        byId(
            "statusFilter"
        );

    if (search) {

        search.addEventListener(
            "input",
            filterOrders
        );
    }

    if (filter) {

        filter.addEventListener(
            "change",
            filterOrders
        );
    }
}

/* =========================================================
   TRACK BUTTON
   ========================================================= */

function setupTrackingButton() {

    const button =
        byId(
            "trackSelectedOrder"
        );

    if (button) {

        button.addEventListener(
            "click",
            function(event) {

                event.preventDefault();

                showPage(
                    "trackingPage"
                );

                updateSelectedOrder();
            }
        );
    }
}

/* =========================================================
   SUPPORT
   ========================================================= */

function setupSupport() {

    const call =
        byId(
            "callSupport"
        );

    const email =
        byId(
            "emailSupport"
        );

    if (call) {

        call.addEventListener(
            "click",
            function(event) {

                event.preventDefault();

                openModal(
                    "Customer Support",
                    `
                    <strong>
                        LOGIX AI Support Team
                    </strong>

                    <br><br>

                    Support Status:
                    <strong style="color:#16a34a">
                        ● Available
                    </strong>

                    <br><br>

                    Phone:<br>
                    +91 1800 123 4567

                    <br><br>

                    Average response time:
                    Under 5 minutes
                    `
                );
            }
        );
    }

    if (email) {

        email.addEventListener(
            "click",
            function(event) {

                event.preventDefault();

                openModal(
                    "Email Support",
                    `
                    Please contact our logistics
                    support team.

                    <br><br>

                    <strong>
                        support@logixai.com
                    </strong>

                    <br><br>

                    Include your order number
                    in the message.
                    `
                );
            }
        );
    }
}

/* =========================================================
   SOCKET.IO
   ========================================================= */

function connectRealtime() {

    if (
        typeof io ===
        "undefined"
    ) {

        console.error(
            "Socket.IO client not loaded."
        );

        setSystemStatus(false);

        return;
    }

    try {

        socket =
            io(
                SOCKET_URL,
                {
                    transports: [
                        "websocket",
                        "polling"
                    ],

                    reconnection:
                        true,

                    reconnectionAttempts:
                        Infinity,

                    reconnectionDelay:
                        2000
                }
            );

        socket.on(
            "connect",
            function() {

                console.log(
                    "LOGIX AI realtime connected:",
                    socket.id
                );

                setSystemStatus(
                    true
                );

                socket.emit(
                    "identify",
                    {
                        role:
                            "customer"
                    }
                );
            }
        );

        socket.on(
            "disconnect",
            function(reason) {

                console.warn(
                    "Realtime disconnected:",
                    reason
                );

                setSystemStatus(
                    false
                );
            }
        );

        socket.on(
            "connect_error",
            function(error) {

                console.error(
                    "Socket error:",
                    error.message
                );

                setSystemStatus(
                    false
                );
            }
        );

        /* =========================================
           ORDER UPDATE
           ========================================= */

        socket.on(
            "orderUpdated",
            function(data) {

                const updated =
                    data &&
                    data.data
                        ? data.data
                        : data;

                if (!updated) {
                    return;
                }

                const number =
                    updated.order_number ||
                    updated.orderNumber;

                if (!number) {

                    loadOrders();

                    return;
                }

                const index =
                    orders.findIndex(
                        function(order) {

                            return (
                                getOrderNumber(
                                    order
                                ) ===
                                String(number)
                            );
                        }
                    );

                if (index >= 0) {

                    orders[index] = {
                        ...orders[index],
                        ...updated
                    };

                } else {

                    loadOrders();

                    return;
                }

                renderOrders();

                updateDashboard();

                updateSelectedOrder();

                addNotification(
                    "Order Updated",
                    "Order #" +
                    number +
                    " was updated in real time.",
                    "success"
                );
            }
        );

        /* =========================================
           NEW DISRUPTION
           ========================================= */

        socket.on(
            "newDisruption",
            function(data) {

                const disruption =
                    data &&
                    data.data
                        ? data.data
                        : data;

                if (!disruption) {
                    return;
                }

                disruptions.unshift(
                    disruption
                );

                renderLatestDisruption();

                addNotification(
                    "Route Disruption",
                    disruption.description ||
                    "Route disruption detected.",
                    "warning"
                );
            }
        );

        /* =========================================
           OPERATOR DECISION
           ========================================= */

        socket.on(
            "operatorDecision",
            function(data) {

                const decision =
                    data &&
                    data.data
                        ? data.data
                        : data;

                if (!decision) {
                    return;
                }

                addNotification(
                    "Logistics Decision",
                    decision.reason ||
                    "Operator updated the shipment route.",
                    "success"
                );

                loadOrders();

                /*
                   If reroute happened,
                   regenerate the real road route.
                */

                const current =
                    findOrder(
                        selectedOrderNumber
                    );

                if (current) {

                    setTimeout(
                        function() {

                            updateTracking(
                                normalizeOrder(
                                    current
                                )
                            );

                        },
                        500
                    );
                }
            }
        );

        /* =========================================
           LIVE DRIVER GPS
           ========================================= */

        socket.on(
            "driverLocationUpdated",
            function(data) {

                console.log(
                    "LIVE DRIVER GPS:",
                    data
                );

                const location =
                    data &&
                    data.data
                        ? data.data
                        : data;

                if (!location) {
                    return;
                }

                const driverId =
                    location.driverId ||
                    location.driver_id ||
                    location.id;

                /*
                   Only update the truck belonging
                   to the currently selected order.
                */

                if (
                    currentDriver &&
                    driverId &&
                    String(driverId) !==
                    String(
                        currentDriver.id ||
                        currentDriver.driver_id
                    )
                ) {
                    return;
                }

                const latitude =
                    Number(
                        location.latitude
                    );

                const longitude =
                    Number(
                        location.longitude
                    );

                if (
                    !Number.isFinite(
                        latitude
                    ) ||
                    !Number.isFinite(
                        longitude
                    )
                ) {
                    return;
                }

                /*
                   REAL backend GPS takes
                   priority over simulation.
                */

                lastTruckPosition = {
                    latitude,
                    longitude
                };

                updateTruckMarker(
                    latitude,
                    longitude,
                    true
                );

                if (
                    location.speed !==
                    undefined
                ) {

                    updateTrackingSpeed(
                        Number(
                            location.speed
                        )
                    );
                }

                if (
                    location.status
                ) {

                    updateTruckStatus(
                        location.status
                    );
                }

                /*
                   If real GPS arrives,
                   stop local simulation.
                */

                if (
                    simulationRunning
                ) {

                    pauseTruckSimulation();

                    setSimulationStatus(
                        "📡 Real GPS connected"
                    );
                }
            }
        );

        /* =========================================
           CONNECTION STATUS
           ========================================= */

        socket.on(
            "connectionStatus",
            function(data) {

                console.log(
                    "Backend connection:",
                    data
                );
            }
        );
    }

    catch (error) {

        console.error(
            "Unable to initialize Socket.IO:",
            error
        );

        setSystemStatus(
            false
        );
    }
}

/* =========================================================
   SELECTED ORDER
   ========================================================= */

async function updateSelectedOrder() {

    let order =
        findOrder(
            selectedOrderNumber
        );

    if (
        !order &&
        orders.length
    ) {

        const active =
            orders.find(
                function(item) {

                    const status =
                        String(
                            item.status ||
                            ""
                        ).toLowerCase();

                    return (
                        status.includes(
                            "transit"
                        ) ||
                        status.includes(
                            "rerout"
                        )
                    );
                }
            );

        order =
            active ||
            orders[0];

        if (order) {

            selectedOrderNumber =
                getOrderNumber(
                    order
                );
        }
    }

    if (!order) {
        return;
    }

    const normalized =
        normalizeOrder(
            order
        );

    updateDashboardDelivery(
        normalized
    );

    await updateTracking(
        normalized
    );
}

/* =========================================================
   PERIODIC TIME UPDATE
   ========================================================= */

setInterval(
    function() {

        const order =
            findOrder(
                selectedOrderNumber
            );

        if (order) {

            updateTimeRemaining(
                normalizeOrder(
                    order
                )
            );
        }

    },
    30000
);

/* =========================================================
   BACKUP SYNCHRONIZATION
   ========================================================= */

setInterval(
    async function() {

        await loadOrders();

        await loadDrivers();

        await loadDisruptions();

    },
    60000
);

/* =========================================================
   INITIALIZATION
   ========================================================= */

async function initializeCustomerPortal() {

    console.log(
        "Initializing LOGIX AI Customer Portal..."
    );

    setupNavigation();

    setupModal();

    setupProfile();

    setupOrderDetails();

    setupNotifications();

    setupSearch();

    setupTrackingButton();

    setupSupport();

    setSystemStatus(
        false
    );

    initializeTrackingMap();

    await Promise.allSettled([
        loadOrders(),
        loadDrivers(),
        loadDisruptions()
    ]);

    connectRealtime();

    updateNotificationCount();

    const activePage =
        document.querySelector(
            ".page.active-page"
        );

    if (!activePage) {

        const dashboard =
            byId(
                "dashboardPage"
            );

        if (dashboard) {

            showPage(
                "dashboardPage"
            );
        }
    }

    console.log(
        "LOGIX AI Customer Portal ready."
    );
}

/* =========================================================
   START
   ========================================================= */

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeCustomerPortal
    );

} else {

    initializeCustomerPortal();
}