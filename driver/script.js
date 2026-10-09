/* =========================================================
   LOGIX-AI DRIVER PORTAL
   REAL-TIME DRIVER MANAGEMENT
   Backend: http://localhost:3000
   ========================================================= */

const API_BASE = "http://localhost:3000";

let socket = null;

let currentDriver = null;
let currentVehicle = null;
let currentOrders = [];
let currentOrder = null;

let currentSpeed = 0;
let currentLatitude = null;
let currentLongitude = null;

let simulationTimer = null;
let simulationRunning = false;
let simulationPaused = false;

let gpsWatchId = null;
let gpsActive = false;

let routeCoordinates = [];
let routeIndex = 0;

let lastUpdateTime = null;


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function $(selector) {
    return document.querySelector(selector);
}

function $all(selector) {
    return Array.from(document.querySelectorAll(selector));
}

function safeText(value, fallback = "--") {
    if (
        value === undefined ||
        value === null ||
        value === "" ||
        value === "undefined" ||
        value === "null"
    ) {
        return fallback;
    }

    return String(value);
}

function numberValue(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeArray(data) {
    if (Array.isArray(data)) return data;

    if (data && Array.isArray(data.rows)) return data.rows;
    if (data && Array.isArray(data.data)) return data.data;
    if (data && Array.isArray(data.orders)) return data.orders;
    if (data && Array.isArray(data.drivers)) return data.drivers;

    return [];
}

async function apiFetch(path, options = {}) {

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        throw new Error(
            `${options.method || "GET"} ${path} failed: ${response.status}`
        );
    }

    const text = await response.text();

    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}


/* =========================================================
   NOTIFICATIONS
   ========================================================= */

function showToast(message, type = "info") {

    let container = document.getElementById("logixToastContainer");

    if (!container) {

        container = document.createElement("div");

        container.id = "logixToastContainer";

        container.style.position = "fixed";
        container.style.right = "18px";
        container.style.bottom = "18px";
        container.style.zIndex = "99999";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.gap = "8px";
        container.style.maxWidth = "360px";

        document.body.appendChild(container);
    }

    const toast = document.createElement("div");

    toast.style.padding = "14px 18px";
    toast.style.borderRadius = "12px";
    toast.style.background = "#111827";
    toast.style.color = "#fff";
    toast.style.fontSize = "14px";
    toast.style.boxShadow = "0 10px 30px rgba(0,0,0,.25)";
    toast.style.borderLeft =
        type === "success"
            ? "4px solid #22c55e"
            : type === "error"
                ? "4px solid #ef4444"
                : "4px solid #3b82f6";

    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3500);
}


/* =========================================================
   DOM UPDATE HELPERS
   ========================================================= */

function setTextByIds(ids, value) {

    ids.forEach(id => {

        const el = document.getElementById(id);

        if (el) {
            el.textContent = safeText(value);
        }
    });
}

function setHTMLByIds(ids, value) {

    ids.forEach(id => {

        const el = document.getElementById(id);

        if (el) {
            el.innerHTML = value;
        }
    });
}


/* =========================================================
   BACKEND STATUS
   ========================================================= */

function setBackendStatus(online) {

    const elements = [
        ...$all("[data-backend-status]"),
        ...$all("#backendStatus"),
        ...$all("#backendConnection"),
        ...$all("#serverStatus")
    ];

    elements.forEach(el => {

        el.textContent = online
            ? "Backend: ONLINE"
            : "Backend: OFFLINE";

        el.style.color = online ? "#16a34a" : "#ef4444";
    });

    const realtime = document.querySelector(
        "[data-realtime-status], #realtimeStatus, #socketStatus"
    );

    if (realtime) {

        realtime.textContent =
            socket && socket.connected
                ? "Realtime Connected"
                : "Realtime Connecting...";
    }
}


/* =========================================================
   BACKEND HEALTH CHECK
   ========================================================= */

async function checkBackend() {

    try {

        const result = await apiFetch("/api/status");

        console.log("LOGIX backend:", result);

        setBackendStatus(true);

        return true;

    } catch (error) {

        console.error("Backend unavailable:", error);

        setBackendStatus(false);

        return false;
    }
}


/* =========================================================
   LOAD DRIVERS
   ========================================================= */

async function loadDrivers() {

    try {

        const data = await apiFetch("/api/drivers");

        const drivers = normalizeArray(data);

        console.log("Drivers received:", drivers);

        if (!drivers.length) {

            console.warn("No drivers returned from backend.");

            showToast(
                "Backend is connected, but no driver records were returned.",
                "error"
            );

            return;
        }

        /*
         * Select the first available driver.
         * If the HTML later provides a driver ID,
         * this can be changed without affecting the rest.
         */

        currentDriver = drivers[0];

        console.log("Selected driver:", currentDriver);

        currentVehicle =
            currentDriver.vehicle ||
            currentDriver.vehicle_data ||
            null;

        updateDriverUI();

        updateVehicleUI();

        await loadOrders();

        await loadDriverLocation();

        showToast("Driver data loaded successfully.", "success");

    } catch (error) {

        console.error("Unable to load driver data:", error);

        showToast(
            "Unable to load driver data. Check backend on port 3000.",
            "error"
        );
    }
}


/* =========================================================
   DRIVER UI
   ========================================================= */

function updateDriverUI() {

    if (!currentDriver) return;

    const driverName =
        currentDriver.name ||
        currentDriver.driver_name ||
        currentDriver.full_name ||
        `Driver ${currentDriver.id || ""}`;

    const driverStatus =
        currentDriver.status ||
        "Available";

    const driverType =
        currentDriver.type ||
        currentDriver.vehicle_type ||
        "Driver";

    setTextByIds(
        [
            "driverName",
            "driver_name",
            "currentDriverName",
            "profileDriverName"
        ],
        driverName
    );

    setTextByIds(
        [
            "driverStatus",
            "driver_status",
            "currentDriverStatus"
        ],
        driverStatus
    );

    setTextByIds(
        [
            "driverType",
            "driver_type"
        ],
        driverType
    );

    /*
     * The existing sidebar/profile may not have IDs.
     * Find the visible Driver card and update it.
     */

    const driverCards = $all("aside div, nav div");

    driverCards.forEach(card => {

        const text = card.textContent.trim();

        if (
            text === "Driver --" ||
            text === "Driver Loading..." ||
            text === "Driver"
        ) {

            const children = Array.from(card.children);

            if (children.length >= 2) {

                const textChildren =
                    children.filter(
                        child =>
                            child.textContent.trim().length > 0
                    );

                if (textChildren.length) {

                    textChildren[textChildren.length - 1]
                        .textContent = driverName;
                }
            }
        }
    });

    setTextByIds(
        [
            "headerDriverName",
            "welcomeDriverName",
            "profileName"
        ],
        driverName
    );
}


/* =========================================================
   VEHICLE UI
   ========================================================= */

function updateVehicleUI() {

    if (!currentDriver) return;

    const vehicleNumber =
        currentDriver.vehicle_number ||
        currentDriver.registration_number ||
        currentDriver.vehicle ||
        "--";

    const vehicleType =
        currentDriver.vehicle_type ||
        currentDriver.type ||
        "Cargo Vehicle";

    const capacity =
        numberValue(
            currentDriver.capacity ||
            currentDriver.vehicle_capacity ||
            0
        );

    const load =
        numberValue(
            currentDriver.current_load ||
            currentDriver.load ||
            0
        );

    const loadPercent =
        capacity > 0
            ? Math.min(100, Math.round((load / capacity) * 100))
            : 0;

    setTextByIds(
        [
            "vehicleNumber",
            "vehicle_number",
            "currentVehicleNumber"
        ],
        vehicleNumber
    );

    setTextByIds(
        [
            "vehicleType",
            "vehicle_type",
            "currentVehicleType"
        ],
        vehicleType
    );

    setTextByIds(
        [
            "vehicleLoad",
            "vehicle_load"
        ],
        `${load} kg`
    );

    setTextByIds(
        [
            "vehicleCapacity",
            "vehicle_capacity"
        ],
        `${capacity} kg`
    );

    setTextByIds(
        [
            "vehicleLoadPercent",
            "vehicle_load_percent",
            "loadPercent"
        ],
        `${loadPercent}%`
    );

    setTextByIds(
        [
            "vehicleSpeed",
            "vehicle_speed",
            "currentVehicleSpeed"
        ],
        `${Math.round(currentSpeed)} km/h`
    );

    /*
     * Existing progress bars
     */

    const progressBars = [
        ...$all("#vehicleLoadBar"),
        ...$all("#loadBar"),
        ...$all(".vehicle-load-bar")
    ];

    progressBars.forEach(bar => {
        bar.style.width = `${loadPercent}%`;
    });
}


/* =========================================================
   LOAD ORDERS
   ========================================================= */

async function loadOrders() {

    try {

        const data = await apiFetch("/api/orders");

        let orders = normalizeArray(data);

        console.log("All orders:", orders);

        /*
         * Determine driver ID / vehicle ID.
         */

        const driverId =
            currentDriver?.id ??
            currentDriver?.driver_id;

        const driverName =
            String(
                currentDriver?.name ||
                currentDriver?.driver_name ||
                ""
            ).toLowerCase();

        const vehicleId =
            currentDriver?.vehicle_id;

        const vehicleNumber =
            String(
                currentDriver?.vehicle_number ||
                ""
            ).toLowerCase();

        /*
         * Match orders belonging to this driver.
         *
         * If backend has no driver assignment yet,
         * we still display orders whose status is assignable.
         */

        let matched = orders.filter(order => {

            const orderDriverId =
                order.driver_id ??
                order.driverId;

            const orderDriverName =
                String(
                    order.driver_name ||
                    order.driverName ||
                    ""
                ).toLowerCase();

            const orderVehicleId =
                order.vehicle_id ??
                order.vehicleId;

            const orderVehicleNumber =
                String(
                    order.vehicle_number ||
                    order.vehicleNumber ||
                    ""
                ).toLowerCase();

            if (
                driverId !== undefined &&
                orderDriverId !== undefined &&
                Number(orderDriverId) === Number(driverId)
            ) {
                return true;
            }

            if (
                driverName &&
                orderDriverName &&
                orderDriverName === driverName
            ) {
                return true;
            }

            if (
                vehicleId !== undefined &&
                orderVehicleId !== undefined &&
                Number(orderVehicleId) === Number(vehicleId)
            ) {
                return true;
            }

            if (
                vehicleNumber &&
                orderVehicleNumber &&
                orderVehicleNumber === vehicleNumber
            ) {
                return true;
            }

            return false;
        });


        /*
         * If there are no explicit assignments,
         * don't blindly show every delivered order.
         *
         * Show active/unassigned orders as available work.
         */

        if (!matched.length) {

            matched = orders.filter(order => {

                const status =
                    String(order.status || "")
                        .toLowerCase();

                return [
                    "assigned",
                    "ready for loading",
                    "loading",
                    "loaded",
                    "in transit",
                    "out for delivery",
                    "rerouted",
                    "delayed",
                    "arrived"
                ].includes(status);
            });
        }

        currentOrders = matched;

        console.log(
            "Driver orders:",
            currentOrders
        );

        updateOrderCounts();

        updateCurrentOrder();

    } catch (error) {

        console.error(
            "Unable to load assigned orders:",
            error
        );

        showToast(
            "Unable to load assigned orders.",
            "error"
        );

        currentOrders = [];

        updateOrderCounts();
        updateCurrentOrder();
    }
}


/* =========================================================
   ORDER COUNTS
   ========================================================= */

function updateOrderCounts() {

    const total = currentOrders.length;

    let active = 0;
    let pending = 0;
    let delivered = 0;
    let completed = 0;
    let delayed = 0;
    let highRisk = 0;

    currentOrders.forEach(order => {

        const status =
            String(order.status || "")
                .trim()
                .toLowerCase();

        if ([
            "assigned",
            "ready for loading",
            "loading",
            "loaded",
            "in transit",
            "out for delivery",
            "rerouted"
        ].includes(status)) {

            active++;
        }

        if ([
            "pending",
            "created",
            "waiting"
        ].includes(status)) {

            pending++;
        }

        if (status === "delivered") {

            delivered++;
            completed++;
        }

        if (status === "arrived") {

            completed++;
        }

        if (
            status === "delayed" ||
            status === "disrupted"
        ) {

            delayed++;
            active++;
        }

        const risk =
            String(
                order.risk ||
                order.risk_level ||
                ""
            ).toLowerCase();

        if (risk === "high") {
            highRisk++;
        }
    });

    /*
     * Main assigned order count
     */

    setTextByIds(
        [
            "assignedOrders",
            "assignedOrderCount",
            "orderCount",
            "totalAssignedOrders",
            "dashboardAssignedOrders"
        ],
        total
    );

    /*
     * Active
     */

    setTextByIds(
        [
            "activeOrders",
            "activeOrderCount",
            "dashboardActiveOrders"
        ],
        active
    );

    /*
     * Pending
     */

    setTextByIds(
        [
            "pendingOrders",
            "pendingOrderCount",
            "dashboardPendingOrders"
        ],
        pending
    );

    /*
     * Delivered
     */

    setTextByIds(
        [
            "deliveredOrders",
            "deliveredOrderCount",
            "dashboardDeliveredOrders"
        ],
        delivered
    );

    /*
     * Completed
     */

    setTextByIds(
        [
            "completedOrders",
            "completedOrderCount",
            "dashboardCompletedOrders",
            "tripHistoryCount"
        ],
        completed
    );

    /*
     * Delayed
     */

    setTextByIds(
        [
            "delayedOrders",
            "delayedOrderCount"
        ],
        delayed
    );

    /*
     * Risk
     */

    setTextByIds(
        [
            "highRiskOrders",
            "highRiskCount"
        ],
        highRisk
    );

    /*
     * Alerts
     */

    setTextByIds(
        [
            "alertsCount",
            "alertCount"
        ],
        delayed + highRisk
    );

    /*
     * Update sidebar counters even when the
     * original HTML does not use IDs.
     */

    const sidebarText =
        $all("aside *, nav *");

    sidebarText.forEach(el => {

        const text =
            el.textContent.trim();

        if (text === "Assigned Orders") {

            if (
                el.parentElement &&
                !el.parentElement.textContent.match(/\d+$/)
            ) {
                el.parentElement.textContent =
                    `Assigned Orders ${total}`;
            }
        }

        if (text === "Alerts") {

            if (
                el.parentElement &&
                !el.parentElement.textContent.match(/\d+$/)
            ) {
                el.parentElement.textContent =
                    `Alerts ${delayed + highRisk}`;
            }
        }

        if (text === "Trip History") {

            if (
                el.parentElement &&
                !el.parentElement.textContent.match(/\d+$/)
            ) {
                el.parentElement.textContent =
                    `Trip History ${completed}`;
            }
        }
    });

    console.log(
        "Driver counts:",
        {
            total,
            active,
            pending,
            delivered,
            completed,
            delayed,
            highRisk
        }
    );
}


/* =========================================================
   CURRENT ORDER
   ========================================================= */

function updateCurrentOrder() {

    /*
     * Prefer an active order.
     */

    const activeStatuses = [
        "assigned",
        "ready for loading",
        "loading",
        "loaded",
        "in transit",
        "out for delivery",
        "rerouted",
        "delayed"
    ];

    currentOrder =
        currentOrders.find(order =>
            activeStatuses.includes(
                String(order.status || "")
                    .toLowerCase()
            )
        ) ||
        currentOrders.find(order =>
            String(order.status || "")
                .toLowerCase() === "arrived"
        ) ||
        null;

    updateCurrentDeliveryUI();
}


/* =========================================================
   CURRENT DELIVERY UI
   ========================================================= */

function updateCurrentDeliveryUI() {

    if (!currentOrder) {

        setTextByIds(
            [
                "currentTrip",
                "currentOrder",
                "currentOrderNumber",
                "tripOrder"
            ],
            "--"
        );

        setTextByIds(
            [
                "assignedRoute"
            ],
            "No assigned order"
        );

        setTextByIds(
            [
                "currentStatus",
                "deliveryStatus",
                "tripStatus"
            ],
            "No Trip"
        );

        setTextByIds(
            [
                "customerName",
                "currentCustomer"
            ],
            "--"
        );

        setTextByIds(
            [
                "origin",
                "currentOrigin"
            ],
            "--"
        );

        setTextByIds(
            [
                "destination",
                "currentDestination"
            ],
            "--"
        );

        setTextByIds(
            [
                "eta",
                "currentETA"
            ],
            "--"
        );

        setTextByIds(
            [
                "priority",
                "currentPriority"
            ],
            "--"
        );

        setTextByIds(
            [
                "risk",
                "currentRisk"
            ],
            "Low"
        );

        setTextByIds(
            [
                "distance",
                "currentDistance"
            ],
            "--"
        );

        return;
    }

    const orderNumber =
        currentOrder.order_number ||
        currentOrder.orderNumber ||
        currentOrder.id ||
        "--";

    const customer =
        currentOrder.customer ||
        currentOrder.customer_name ||
        currentOrder.customerName ||
        "--";

    const origin =
        currentOrder.origin ||
        currentOrder.source ||
        currentOrder.pickup_location ||
        "--";

    const destination =
        currentOrder.destination ||
        currentOrder.delivery_location ||
        currentOrder.drop_location ||
        "--";

    const status =
        currentOrder.status ||
        "Assigned";

    const priority =
        currentOrder.priority ||
        "Normal";

    const risk =
        currentOrder.risk ||
        currentOrder.risk_level ||
        "Low";

    const eta =
        currentOrder.eta ||
        currentOrder.estimated_arrival ||
        "--";

    const distance =
        currentOrder.distance ||
        currentOrder.distance_km ||
        "--";

    setTextByIds(
        [
            "currentTrip",
            "currentOrder",
            "currentOrderNumber",
            "tripOrder"
        ],
        orderNumber
    );

    setTextByIds(
        [
            "assignedRoute"
        ],
        `${origin} → ${destination}`
    );

    setTextByIds(
        [
            "currentStatus",
            "deliveryStatus",
            "tripStatus"
        ],
        status
    );

    setTextByIds(
        [
            "customerName",
            "currentCustomer"
        ],
        customer
    );

    setTextByIds(
        [
            "origin",
            "currentOrigin"
        ],
        origin
    );

    setTextByIds(
        [
            "destination",
            "currentDestination"
        ],
        destination
    );

    setTextByIds(
        [
            "eta",
            "currentETA"
        ],
        eta
    );

    setTextByIds(
        [
            "priority",
            "currentPriority"
        ],
        priority
    );

    setTextByIds(
        [
            "risk",
            "currentRisk"
        ],
        risk
    );

    setTextByIds(
        [
            "distance",
            "currentDistance"
        ],
        typeof distance === "number"
            ? `${distance.toFixed(1)} km`
            : distance
    );
}


/* =========================================================
   UPDATE ORDER ON BACKEND
   ========================================================= */

async function updateOrderOnServer(status, extra = {}) {

    if (!currentOrder) {

        showToast(
            "No current delivery selected.",
            "error"
        );

        return false;
    }

    const orderNumber =
        currentOrder.order_number ||
        currentOrder.orderNumber;

    if (!orderNumber) {

        console.warn(
            "Order does not have order_number:",
            currentOrder
        );

        return false;
    }

    try {

        const updated = await apiFetch(
            `/api/orders/${encodeURIComponent(orderNumber)}`,
            {
                method: "PUT",
                body: JSON.stringify({
                    status,
                    driver_id:
                        currentDriver?.id ||
                        currentDriver?.driver_id ||
                        null,
                    vehicle_id:
                        currentDriver?.vehicle_id ||
                        null,
                    ...extra
                })
            }
        );

        console.log(
            "Order updated:",
            updated
        );

        currentOrder.status = status;

        const index =
            currentOrders.findIndex(
                order =>
                    String(
                        order.order_number ||
                        order.orderNumber
                    ) === String(orderNumber)
            );

        if (index >= 0) {
            currentOrders[index] = {
                ...currentOrders[index],
                status,
                ...extra
            };
        }

        updateOrderCounts();
        updateCurrentOrder();

        return true;

    } catch (error) {

        console.error(
            "Order update failed:",
            error
        );

        showToast(
            `Could not update order status to ${status}.`,
            "error"
        );

        return false;
    }
}


/* =========================================================
   START TRIP
   ========================================================= */

async function startTrip() {

    if (!currentOrder) {

        showToast(
            "No current delivery selected.",
            "error"
        );

        return;
    }

    simulationPaused = false;
    simulationRunning = true;

    await updateOrderOnServer("In Transit");

    if (currentDriver) {

        currentDriver.status = "On Trip";
    }

    updateDriverUI();

    startSimulation();

    startRealGPS();

    showToast(
        "Trip started. Driver status: On Trip.",
        "success"
    );
}


/* =========================================================
   PAUSE TRIP
   ========================================================= */

async function pauseTrip() {

    if (!currentOrder) {

        showToast(
            "No current delivery selected.",
            "error"
        );

        return;
    }

    simulationPaused = true;

    if (currentDriver) {
        currentDriver.status = "Paused";
    }

    updateDriverUI();

    await sendDriverLocation();

    showToast(
        "Trip paused.",
        "info"
    );
}


/* =========================================================
   RESUME TRIP
   ========================================================= */

async function resumeTrip() {

    if (!currentOrder) {

        showToast(
            "No current delivery selected.",
            "error"
        );

        return;
    }

    simulationPaused = false;
    simulationRunning = true;

    if (currentDriver) {
        currentDriver.status = "On Trip";
    }

    updateDriverUI();

    startSimulation();

    showToast(
        "Trip resumed.",
        "success"
    );
}


/* =========================================================
   STOP TRIP
   ========================================================= */

async function stopTrip() {

    simulationRunning = false;
    simulationPaused = false;

    if (simulationTimer) {

        clearInterval(simulationTimer);

        simulationTimer = null;
    }

    if (currentDriver) {

        currentDriver.status = "Available";
    }

    updateDriverUI();

    await sendDriverLocation();

    showToast(
        "Trip stopped.",
        "info"
    );
}


/* =========================================================
   ARRIVAL
   ========================================================= */

async function arriveAtDestination() {

    if (!currentOrder) return;

    simulationRunning = false;

    if (simulationTimer) {

        clearInterval(simulationTimer);

        simulationTimer = null;
    }

    await updateOrderOnServer("Arrived");

    if (currentDriver) {
        currentDriver.status = "Available";
    }

    updateDriverUI();

    showToast(
        "Driver arrived at destination.",
        "success"
    );
}


/* =========================================================
   CONFIRM DELIVERY
   ========================================================= */

async function confirmDelivery() {

    if (!currentOrder) {

        showToast(
            "No current delivery selected.",
            "error"
        );

        return;
    }

    const success =
        await updateOrderOnServer("Delivered");

    if (!success) return;

    simulationRunning = false;

    if (simulationTimer) {

        clearInterval(simulationTimer);

        simulationTimer = null;
    }

    if (currentDriver) {

        currentDriver.status = "Available";

        if (currentDriver.current_load !== undefined) {

            const orderWeight =
                numberValue(
                    currentOrder.weight ||
                    currentOrder.weight_kg ||
                    currentOrder.load_weight ||
                    0
                );

            currentDriver.current_load =
                Math.max(
                    0,
                    numberValue(
                        currentDriver.current_load
                    ) - orderWeight
                );
        }
    }

    updateDriverUI();
    updateVehicleUI();

    showToast(
        "Delivery confirmed successfully.",
        "success"
    );

    await loadOrders();
}


/* =========================================================
   SIMULATION
   ========================================================= */

function startSimulation() {

    if (simulationTimer) {

        clearInterval(simulationTimer);
        simulationTimer = null;
    }

    if (!currentOrder) return;

    simulationRunning = true;

    /*
     * If no road route has been loaded,
     * simulate speed/location progression anyway.
     */

    simulationTimer = setInterval(async () => {

        if (!simulationRunning) return;

        if (simulationPaused) return;

        currentSpeed =
            Math.min(
                60,
                Math.max(
                    20,
                    currentSpeed + (Math.random() * 10 - 5)
                )
            );

        updateSpeedUI();

        if (
            routeCoordinates.length &&
            routeIndex < routeCoordinates.length
        ) {

            const point =
                routeCoordinates[routeIndex];

            currentLatitude = point[1];
            currentLongitude = point[0];

            routeIndex++;

        } else {

            /*
             * If GPS coordinates already exist,
             * slightly move the vehicle.
             */

            if (
                currentLatitude !== null &&
                currentLongitude !== null
            ) {

                currentLatitude +=
                    (Math.random() - 0.5) * 0.0005;

                currentLongitude +=
                    (Math.random() - 0.5) * 0.0005;
            }
        }

        lastUpdateTime = new Date();

        updateGPSUI();

        await sendDriverLocation();

        if (
            routeCoordinates.length &&
            routeIndex >= routeCoordinates.length
        ) {

            await arriveAtDestination();
        }

    }, 3000);
}


/* =========================================================
   SPEED UI
   ========================================================= */

function updateSpeedUI() {

    setTextByIds(
        [
            "currentSpeed",
            "speed",
            "vehicleSpeed",
            "liveSpeed"
        ],
        `${Math.round(currentSpeed)} km/h`
    );
}


/* =========================================================
   GPS UI
   ========================================================= */

function updateGPSUI() {

    setTextByIds(
        [
            "latitude",
            "currentLatitude",
            "gpsLatitude"
        ],
        currentLatitude !== null
            ? Number(currentLatitude).toFixed(6)
            : "--"
    );

    setTextByIds(
        [
            "longitude",
            "currentLongitude",
            "gpsLongitude"
        ],
        currentLongitude !== null
            ? Number(currentLongitude).toFixed(6)
            : "--"
    );

    setTextByIds(
        [
            "gpsSpeed",
            "liveGPSSpeed"
        ],
        `${Math.round(currentSpeed)} km/h`
    );

    setTextByIds(
        [
            "lastUpdate",
            "gpsLastUpdate"
        ],
        lastUpdateTime
            ? lastUpdateTime.toLocaleTimeString()
            : "--"
    );

    updateSpeedUI();
}


/* =========================================================
   SEND DRIVER LOCATION
   ========================================================= */

async function sendDriverLocation() {

    if (!currentDriver) return;

    if (
        currentLatitude === null ||
        currentLongitude === null
    ) {
        return;
    }

    const driverId =
        currentDriver.id ||
        currentDriver.driver_id;

    if (!driverId) return;

    try {

        await apiFetch(
            `/api/drivers/${driverId}/location`,
            {
                method: "POST",
                body: JSON.stringify({
                    latitude: currentLatitude,
                    longitude: currentLongitude,
                    speed: currentSpeed,
                    status:
                        currentDriver.status ||
                        "Available"
                })
            }
        );

        console.log(
            "Location sent:",
            currentLatitude,
            currentLongitude
        );

    } catch (error) {

        console.warn(
            "Location update failed:",
            error
        );
    }
}


/* =========================================================
   LOAD DRIVER LOCATION
   ========================================================= */

async function loadDriverLocation() {

    /*
     * Current backend may not expose a dedicated
     * GET location route, so use fields returned
     * by /api/drivers.
     */

    if (!currentDriver) return;

    const lat =
        currentDriver.latitude ??
        currentDriver.lat;

    const lng =
        currentDriver.longitude ??
        currentDriver.lng ??
        currentDriver.lon;

    if (
        lat !== undefined &&
        lng !== undefined &&
        lat !== null &&
        lng !== null
    ) {

        currentLatitude = Number(lat);
        currentLongitude = Number(lng);

        updateGPSUI();
    }
}


/* =========================================================
   REAL GPS
   ========================================================= */

function startRealGPS() {

    if (!navigator.geolocation) {

        showToast(
            "Browser GPS is not available. Simulation will continue.",
            "error"
        );

        return;
    }

    if (gpsWatchId !== null) {

        navigator.geolocation.clearWatch(
            gpsWatchId
        );
    }

    gpsWatchId =
        navigator.geolocation.watchPosition(

            async position => {

                gpsActive = true;

                currentLatitude =
                    position.coords.latitude;

                currentLongitude =
                    position.coords.longitude;

                currentSpeed =
                    Number.isFinite(
                        position.coords.speed
                    )
                        ? Math.max(
                            0,
                            position.coords.speed * 3.6
                        )
                        : currentSpeed;

                lastUpdateTime = new Date();

                updateGPSUI();

                await sendDriverLocation();
            },

            error => {

                console.warn(
                    "GPS error:",
                    error
                );

                gpsActive = false;
            },

            {
                enableHighAccuracy: true,
                maximumAge: 3000,
                timeout: 10000
            }
        );
}


/* =========================================================
   SOCKET.IO
   ========================================================= */

function connectRealtime() {

    if (typeof io !== "function") {

        console.error(
            "Socket.IO library is missing."
        );

        showToast(
            "Socket.IO library is not loaded.",
            "error"
        );

        return;
    }

    try {

        socket = io(API_BASE, {
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000
        });

        socket.on("connect", () => {

            console.log(
                "Socket.IO connected:",
                socket.id
            );

            setBackendStatus(true);

            showToast(
                "Realtime connected.",
                "success"
            );
        });

        socket.on("disconnect", reason => {

            console.warn(
                "Socket disconnected:",
                reason
            );

            setBackendStatus(false);
        });

        socket.on("connect_error", error => {

            console.warn(
                "Socket connection error:",
                error.message
            );
        });


        /*
         * Driver location changed
         */

        socket.on(
            "driverLocationUpdated",
            payload => {

                console.log(
                    "Driver location event:",
                    payload
                );

                const eventDriverId =
                    payload?.driver_id ??
                    payload?.driverId;

                const myDriverId =
                    currentDriver?.id ??
                    currentDriver?.driver_id;

                if (
                    eventDriverId !== undefined &&
                    myDriverId !== undefined &&
                    Number(eventDriverId) === Number(myDriverId)
                ) {

                    if (
                        payload.latitude !== undefined
                    ) {
                        currentLatitude =
                            Number(payload.latitude);
                    }

                    if (
                        payload.longitude !== undefined
                    ) {
                        currentLongitude =
                            Number(payload.longitude);
                    }

                    if (
                        payload.speed !== undefined
                    ) {
                        currentSpeed =
                            Number(payload.speed);
                    }

                    updateGPSUI();
                }
            }
        );


        /*
         * Any order update from operator,
         * customer, warehouse or driver.
         */

        socket.on(
            "orderUpdated",
            async payload => {

                console.log(
                    "Realtime order update:",
                    payload
                );

                await loadOrders();

                showToast(
                    "Order information updated in real time.",
                    "info"
                );
            }
        );


        socket.on(
            "orderCreated",
            async payload => {

                console.log(
                    "New order:",
                    payload
                );

                await loadOrders();
            }
        );


        socket.on(
            "warehouseOrderCreated",
            async payload => {

                console.log(
                    "Warehouse order:",
                    payload
                );

                await loadOrders();
            }
        );


        socket.on(
            "operatorDecision",
            async payload => {

                console.log(
                    "Operator decision:",
                    payload
                );

                await loadOrders();

                showToast(
                    "Operator decision received.",
                    "info"
                );
            }
        );


        socket.on(
            "dispatchCreated",
            async payload => {

                console.log(
                    "Dispatch created:",
                    payload
                );

                await loadOrders();
            }
        );


        socket.on(
            "dispatchUpdated",
            async payload => {

                console.log(
                    "Dispatch updated:",
                    payload
                );

                await loadOrders();
            }
        );


        socket.on(
            "loadingCompleted",
            async payload => {

                console.log(
                    "Loading completed:",
                    payload
                );

                await loadOrders();

                showToast(
                    "Warehouse loading completed.",
                    "success"
                );
            }
        );


        socket.on(
            "warehouseUpdated",
            async payload => {

                console.log(
                    "Warehouse updated:",
                    payload
                );

                await loadOrders();
            }
        );


        socket.on(
            "newDisruption",
            payload => {

                console.log(
                    "New disruption:",
                    payload
                );

                showToast(
                    "New route disruption reported.",
                    "error"
                );
            }
        );

    } catch (error) {

        console.error(
            "Socket initialization failed:",
            error
        );
    }
}


/* =========================================================
   BUTTON BINDING
   ========================================================= */

function bindButton(ids, callback) {

    ids.forEach(id => {

        const button =
            document.getElementById(id);

        if (button) {

            button.addEventListener(
                "click",
                callback
            );
        }
    });
}


function bindButtons() {

    bindButton(
        [
            "startTrip",
            "startTripBtn",
            "btnStartTrip"
        ],
        startTrip
    );

    bindButton(
        [
            "pauseTrip",
            "pauseTripBtn",
            "btnPauseTrip"
        ],
        pauseTrip
    );

    bindButton(
        [
            "resumeTrip",
            "resumeTripBtn",
            "btnResumeTrip"
        ],
        resumeTrip
    );

    bindButton(
        [
            "stopTrip",
            "stopTripBtn",
            "btnStopTrip"
        ],
        stopTrip
    );

    bindButton(
        [
            "confirmDelivery",
            "confirmDeliveryBtn",
            "btnConfirmDelivery"
        ],
        confirmDelivery
    );

    bindButton(
        [
            "openCurrentTrip",
            "openCurrentTripBtn"
        ],
        () => {

            if (!currentOrder) {

                showToast(
                    "No current delivery selected.",
                    "error"
                );

                return;
            }

            updateCurrentDeliveryUI();

            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });
        }
    );
}


/* =========================================================
   CLOCK
   ========================================================= */

function startClock() {

    function updateClock() {

        const now = new Date();

        setTextByIds(
            [
                "clock",
                "currentTime",
                "headerTime"
            ],
            now.toLocaleTimeString()
        );
    }

    updateClock();

    setInterval(
        updateClock,
        1000
    );
}


/* =========================================================
   AUTO REFRESH
   ========================================================= */

function startAutoRefresh() {

    setInterval(async () => {

        try {

            await checkBackend();

            if (currentDriver) {

                await loadOrders();
            }

        } catch (error) {

            console.warn(
                "Auto refresh error:",
                error
            );
        }

    }, 10000);
}


/* =========================================================
   INITIALIZATION
   ========================================================= */

async function initDriverPortal() {

    console.log(
        "======================================"
    );

    console.log(
        "       LOGIX-AI DRIVER PORTAL"
    );

    console.log(
        "======================================"
    );

    console.log(
        "Backend:",
        API_BASE
    );

    startClock();

    bindButtons();

    /*
     * Start realtime immediately.
     */

    connectRealtime();

    /*
     * Test backend.
     */

    const backendOnline =
        await checkBackend();

    if (!backendOnline) {

        showToast(
            "Backend OFFLINE. Start LOGIX-AI backend on port 3000.",
            "error"
        );

        /*
         * Keep retrying.
         */

        setTimeout(
            initBackendRetry,
            3000
        );

        return;
    }

    /*
     * Load driver and orders.
     */

    await loadDrivers();

    /*
     * Start automatic synchronization.
     */

    startAutoRefresh();

    /*
     * GPS is available even before trip,
     * but don't force browser permission immediately.
     */

    console.log(
        "Driver portal initialized."
    );
}


/* =========================================================
   BACKEND RETRY
   ========================================================= */

async function initBackendRetry() {

    const online =
        await checkBackend();

    if (online) {

        await loadDrivers();

        startAutoRefresh();

    } else {

        setTimeout(
            initBackendRetry,
            3000
        );
    }
}


/* =========================================================
   GLOBAL FUNCTIONS
   Allows existing HTML onclick="" to continue working.
   ========================================================= */

window.startTrip = startTrip;
window.pauseTrip = pauseTrip;
window.resumeTrip = resumeTrip;
window.stopTrip = stopTrip;
window.confirmDelivery = confirmDelivery;
window.loadOrders = loadOrders;
window.loadDrivers = loadDrivers;


/* =========================================================
   START
   ========================================================= */

if (
    document.readyState === "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initDriverPortal
    );

} else {

    initDriverPortal();
}