
/* =========================================================
   LOGIX AI — WAREHOUSE PORTAL
   Corrected complete frontend script
   Backend: http://localhost:3000
   ========================================================= */

"use strict";

const API_BASE = "http://localhost:3000";
const SOCKET_URL = "http://localhost:3000";
const WAREHOUSE_CODE = "WH-CBE-01";
const REFRESH_INTERVAL = 15000;

let socket = null;
let orders = [];
let drivers = [];
let disruptions = [];
let loadingBays = [];
let dispatches = [];
let activities = [];
let warehouse = null;
let selectedOrder = null;
let currentPage = "dashboard";
let refreshInProgress = false;

/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    initializeNavigation();
    initializeModals();
    initializeSearch();
    initializeButtons();
    initializeClock();
    connectRealtime();
    loadEverything();

    // Refresh data periodically even when sockets are unavailable.
    setInterval(() => {
        if (!socket || !socket.connected) {
            loadEverything();
        }
    }, REFRESH_INTERVAL);
});

/* =========================================================
   API HELPER
   ========================================================= */

async function api(endpoint, options = {}) {
    let response;

    try {
        response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: {
                ...(options.body ? {
                    "Content-Type": "application/json"
                } : {}),
                ...(options.headers || {})
            }
        });
    } catch (error) {
        throw new Error(
            `Cannot connect to backend. Check that the server is running at ${API_BASE}.`
        );
    }

    const contentType = response.headers.get("content-type") || "";
    let data;

    if (contentType.includes("application/json")) {
        data = await response.json();
    } else {
        data = await response.text();
    }

    if (!response.ok) {
        const message =
            data && typeof data === "object"
                ? data.error || data.message
                : null;

        throw new Error(message || `HTTP ${response.status}`);
    }

    return data;
}

function normalizeArray(data, keys = []) {
    if (Array.isArray(data)) return data;

    if (!data || typeof data !== "object") return [];

    for (const key of keys) {
        if (Array.isArray(data[key])) return data[key];
    }

    return [];
}

/* =========================================================
   INITIAL DATA LOAD
   ========================================================= */

async function loadEverything() {
    if (refreshInProgress) return;

    refreshInProgress = true;

    const tasks = [
        ["Backend status", loadBackendStatus],
        ["Orders", loadOrders],
        ["Drivers", loadDrivers],
        ["Disruptions", loadDisruptions],
        ["Warehouse details", loadWarehouse],
        ["Loading bays", loadLoadingBays],
        ["Dispatches", loadDispatches],
        ["Activity history", loadActivityHistory]
    ];

    try {
        const results = await Promise.allSettled(
            tasks.map(([, loader]) => loader())
        );

        const failed = [];

        results.forEach((result, index) => {
            if (result.status === "rejected") {
                failed.push(tasks[index][0]);

                console.error(
                    `[Warehouse] ${tasks[index][0]} failed:`,
                    result.reason
                );
            }
        });

        renderEverything();

        if (failed.length) {
            showToast(
                `Could not load: ${failed.join(", ")}`,
                "warning"
            );
        }
    } finally {
        refreshInProgress = false;
    }
}

/* =========================================================
   BACKEND STATUS
   ========================================================= */

async function loadBackendStatus() {
    try {
        const data = await api("/api/status");
        const online = data?.backend === "ONLINE";

        setText(
            "backendStatus",
            online ? "Backend Online" : "Backend Status Unknown"
        );

        setText(
            "profileBackendStatus",
            online ? "Connected" : "Status Unknown"
        );

        setText(
            "realtimeStatus",
            data?.realtime === "ACTIVE"
                ? "Realtime Ready"
                : "Realtime Waiting"
        );

        setConnectionDot(online);
    } catch (error) {
        setText("backendStatus", "Backend Offline");
        setText("profileBackendStatus", "Offline");
        setText("realtimeStatus", "Backend Offline");
        setConnectionDot(false);
        throw error;
    }
}

function setConnectionDot(online) {
    const dot = document.getElementById("connectionDot");

    if (dot) {
        dot.className = online
            ? "status-dot online"
            : "status-dot offline";
    }
}

/* =========================================================
   ORDERS
   ========================================================= */

async function loadOrders() {
    const data = await api("/api/orders");
    orders = normalizeArray(data, ["orders", "data"]);
}

function renderOrders() {
    const body = document.getElementById("ordersTableBody");
    if (!body) return;

    const search = (
        document.getElementById("orderSearch")?.value || ""
    ).trim().toLowerCase();

    const statusFilter =
        document.getElementById("orderStatusFilter")?.value || "";

    const priorityFilter =
        document.getElementById("orderPriorityFilter")?.value || "";

    const filtered = orders.filter(order => {
        const searchable = [
            order.order_number,
            order.customer,
            order.origin,
            order.destination,
            order.status
        ].join(" ").toLowerCase();

        return (
            (!search || searchable.includes(search)) &&
            (!statusFilter || order.status === statusFilter) &&
            (!priorityFilter || order.priority === priorityFilter)
        );
    });

    body.innerHTML = "";

    if (!filtered.length) {
        body.innerHTML = `
            <tr><td colspan="8">
                <div class="empty-state">No matching orders</div>
            </td></tr>
        `;

        setText("orderRecordCount", "0 orders");
        return;
    }

    filtered.forEach(order => {
        const row = document.createElement("tr");

        row.innerHTML = `
            <td><strong>${escapeHTML(order.order_number || "--")}</strong></td>
            <td>${escapeHTML(order.customer || "--")}</td>
            <td>${escapeHTML(order.origin || "--")}</td>
            <td>${escapeHTML(order.destination || "--")}</td>
            <td>${statusBadge(order.status)}</td>
            <td>${priorityBadge(order.priority)}</td>
            <td>${clampPercent(order.loading_progress)}%</td>
            <td>
                <button class="btn btn-sm"
                    data-order="${escapeHTML(order.order_number || "")}"
                    type="button">View</button>
            </td>
        `;

        row.querySelector("button")?.addEventListener("click", () => {
            openOrder(order.order_number);
        });

        body.appendChild(row);
    });

    setText("orderRecordCount", `${filtered.length} orders`);
}

function renderPriorityOrders() {
    const body = document.getElementById("priorityOrdersBody");
    if (!body) return;

    const priorityOrders = orders
        .filter(order =>
            ["High", "Critical"].includes(order.priority)
        )
        .sort((a, b) =>
            priorityScore(b.priority) - priorityScore(a.priority)
        )
        .slice(0, 5);

    body.innerHTML = "";

    if (!priorityOrders.length) {
        body.innerHTML = `
            <tr><td colspan="5">
                <div class="empty-state">No high-priority orders</div>
            </td></tr>
        `;
        return;
    }

    priorityOrders.forEach(order => {
        const row = document.createElement("tr");

        row.innerHTML = `
            <td><strong>${escapeHTML(order.order_number || "--")}</strong></td>
            <td>${escapeHTML(order.customer || "--")}</td>
            <td>${escapeHTML(order.destination || "--")}</td>
            <td>${priorityBadge(order.priority)}</td>
            <td>${statusBadge(order.status)}</td>
        `;

        body.appendChild(row);
    });
}

/* =========================================================
   DRIVERS AND VEHICLE CAPACITY
   ========================================================= */

async function loadDrivers() {
    const data = await api("/api/drivers");
    drivers = normalizeArray(data, ["drivers", "data"]);
}

function renderDrivers() {
    const container = document.getElementById("vehicleCapacityList");
    if (!container) return;

    container.innerHTML = "";

    if (!drivers.length) {
        container.innerHTML = `
            <div class="empty-state">No vehicle data available</div>
        `;
        return;
    }

    drivers.forEach(driver => {
        const capacity = Number(
            driver.capacity ??
            driver.vehicle_capacity ??
            driver.vehicle?.capacity ??
            0
        );

        const load = Number(
            driver.current_load ??
            driver.load ??
            0
        );

        const percentage = capacity > 0
            ? Math.min(100, Math.max(0, Math.round(load / capacity * 100)))
            : 0;

        const row = document.createElement("div");
        row.className = "vehicle-capacity-row";

        row.innerHTML = `
            <div>
                <strong>${escapeHTML(
                    driver.vehicle_number ||
                    driver.vehicle?.vehicle_number ||
                    "--"
                )}</strong>
                <span>${escapeHTML(
                    driver.name || driver.driver_name || "--"
                )}</span>
            </div>
            <div class="capacity-value">
                <strong>${load} / ${capacity} kg</strong>
                <div class="capacity-bar">
                    <span style="width:${percentage}%"></span>
                </div>
            </div>
        `;

        container.appendChild(row);
    });
}

/* =========================================================
   DISRUPTIONS AND ALERTS
   ========================================================= */

async function loadDisruptions() {
    const data = await api("/api/disruptions");
    disruptions = normalizeArray(data, ["disruptions", "data"]);
}

function renderAlerts() {
    const container = document.getElementById("alertsList");
    if (!container) return;

    const active = disruptions.filter(item =>
        ["Active", "Open"].includes(item.status)
    );

    container.innerHTML = "";

    if (!active.length) {
        container.innerHTML = `
            <div class="empty-state">No active disruptions</div>
        `;
    } else {
        active.forEach(disruption => {
            const row = document.createElement("div");
            row.className = "alert-row";

            row.innerHTML = `
                <div class="alert-icon">!</div>
                <div>
                    <strong>${escapeHTML(disruption.type || "Disruption")}</strong>
                    <p>${escapeHTML(
                        disruption.description || "Operational disruption"
                    )}</p>
                    <small>
                        ${escapeHTML(disruption.location || "Unknown location")}
                        · ${Number(disruption.delay_minutes || 0)} min delay
                    </small>
                </div>
            `;

            container.appendChild(row);
        });
    }

    setText("activeDisruptionCount", active.length);
}

/* =========================================================
   WAREHOUSE DETAILS
   ========================================================= */

async function loadWarehouse() {
    const data = await api("/api/warehouse");

    warehouse = data?.warehouse || data?.data || data;

    if (!warehouse || typeof warehouse !== "object") {
        throw new Error("Warehouse details were not returned by the API");
    }
}

function renderWarehouse() {
    if (!warehouse) return;

    setText("warehouseCode", warehouse.warehouse_code || WAREHOUSE_CODE);
    setText("warehouseName", warehouse.name || "Warehouse");
    setText("warehouseLocation", warehouse.location || "--");
    setText("warehouseStatus", warehouse.status || "Unknown");
}

/* =========================================================
   LOADING BAYS
   ========================================================= */

async function loadLoadingBays() {
    const data = await api("/api/warehouse/bays");

    loadingBays = normalizeArray(data, [
        "bays",
        "loadingBays",
        "loading_bays",
        "data"
    ]);
}

function renderLoadingBays() {
    const container = document.getElementById("loadingBaysContainer");
    if (!container) return;

    container.innerHTML = "";

    if (!loadingBays.length) {
        container.innerHTML = `
            <div class="empty-state">No loading bays available</div>
        `;
        setText("activeLoadingBays", 0);
        return;
    }

    loadingBays.forEach(bay => {
        const card = document.createElement("div");
        card.className = "loading-bay-card";

        const progress = clampPercent(bay.progress);
        const maintenance = bay.status === "Maintenance";
        const assigned = Boolean(bay.order_number);

        card.innerHTML = `
            <div class="bay-header">
                <strong>${escapeHTML(bay.bay_number || bay.name || "--")}</strong>
                ${statusBadge(bay.status)}
            </div>

            <div class="bay-body">
                <div class="bay-order">
                    ${
                        assigned
                            ? `<strong>${escapeHTML(bay.order_number)}</strong>`
                            : `<span>No order assigned</span>`
                    }
                </div>

                <div class="progress">
                    <span style="width:${progress}%"></span>
                </div>

                <div class="progress-text">
                    <span>Loading progress</span>
                    <strong>${progress}%</strong>
                </div>

                ${
                    bay.driver_name
                        ? `<div class="bay-driver">
                            Driver: <strong>${escapeHTML(bay.driver_name)}</strong>
                            ${bay.vehicle_number
                                ? ` · ${escapeHTML(bay.vehicle_number)}`
                                : ""}
                        </div>`
                        : ""
                }
            </div>

            <div class="bay-actions">
                ${
                    maintenance
                        ? `<button class="btn btn-secondary" disabled>
                            Maintenance
                           </button>`
                        : assigned
                            ? `<button class="btn btn-primary bay-progress-btn"
                                type="button">+25%</button>
                               ${
                                   progress >= 100
                                       ? `<button class="btn btn-success bay-complete-btn"
                                            type="button">Complete</button>`
                                       : ""
                               }`
                            : `<button class="btn btn-primary bay-assign-btn"
                                type="button">Assign Order</button>`
                }
            </div>
        `;

        card.querySelector(".bay-progress-btn")?.addEventListener("click", () => {
            updateBayProgress(bay.id);
        });

        card.querySelector(".bay-complete-btn")?.addEventListener("click", () => {
            completeBay(bay.id);
        });

        card.querySelector(".bay-assign-btn")?.addEventListener("click", () => {
            assignBayFromUI(bay.id);
        });

        container.appendChild(card);
    });

    setText(
        "activeLoadingBays",
        loadingBays.filter(bay => bay.status === "Loading").length
    );
}

async function assignBayFromUI(bayId) {
    const availableOrders = orders
        .filter(order => {
            const completed = [
                "Dispatched",
                "Delivered",
                "Cancelled",
                "Completed"
            ].includes(order.status);

            return (
                !completed &&
                Number(order.loading_progress || 0) < 100 &&
                order.status !== "Loading"
            );
        })
        .sort((a, b) =>
            priorityScore(b.priority) - priorityScore(a.priority)
        );

    if (!availableOrders.length) {
        showToast("No order available for loading", "warning");
        return;
    }

    const order = availableOrders[0];

    const driver = drivers.find(item =>
        Number(item.id) === Number(order.driver_id)
    );

    try {
        await api(`/api/warehouse/bays/${encodeURIComponent(bayId)}/assign`, {
            method: "POST",
            body: JSON.stringify({
                order_number: order.order_number,
                driver_id: driver?.id ?? order.driver_id ?? null,
                vehicle_id: driver?.vehicle_id ?? order.vehicle_id ?? null
            })
        });

        showToast(`${order.order_number} assigned to loading bay`, "success");
        await refreshWarehouseData();
    } catch (error) {
        console.error("[Warehouse] Bay assignment failed:", error);
        showToast(error.message, "error");
    }
}

async function updateBayProgress(bayId) {
    const bay = loadingBays.find(item =>
        Number(item.id) === Number(bayId)
    );

    if (!bay) {
        showToast("Loading bay not found", "error");
        return;
    }

    const progress = Math.min(100, Number(bay.progress || 0) + 25);

    try {
        await api(`/api/warehouse/bays/${encodeURIComponent(bayId)}/progress`, {
            method: "PUT",
            body: JSON.stringify({ progress })
        });

        showToast(`Loading progress updated to ${progress}%`, "success");
        await refreshWarehouseData();
    } catch (error) {
        console.error("[Warehouse] Progress update failed:", error);
        showToast(error.message, "error");
    }
}

async function completeBay(bayId) {
    try {
        await api(`/api/warehouse/bays/${encodeURIComponent(bayId)}/complete`, {
            method: "POST"
        });

        showToast("Loading completed successfully", "success");
        await refreshWarehouseData();
    } catch (error) {
        console.error("[Warehouse] Complete loading failed:", error);
        showToast(error.message, "error");
    }
}

/* =========================================================
   DISPATCHES
   ========================================================= */

async function loadDispatches() {
    const data = await api("/api/warehouse/dispatches");

    dispatches = normalizeArray(data, [
        "dispatches",
        "data"
    ]);
}

function renderDispatches() {
    const container = document.getElementById("dispatchList");
    if (!container) return;

    container.innerHTML = "";

    if (!dispatches.length) {
        container.innerHTML = `
            <div class="empty-state">No dispatch records</div>
        `;
        return;
    }

    dispatches.forEach(dispatch => {
        const card = document.createElement("div");
        card.className = "dispatch-card";

        card.innerHTML = `
            <div class="dispatch-header">
                <strong>${escapeHTML(dispatch.order_number || "--")}</strong>
                ${statusBadge(dispatch.status)}
            </div>

            <div class="dispatch-body">
                <p><strong>Destination:</strong>
                    ${escapeHTML(dispatch.destination || "--")}</p>
                <p><strong>Driver:</strong>
                    ${escapeHTML(dispatch.driver_name || "--")}</p>
                <p><strong>Vehicle:</strong>
                    ${escapeHTML(dispatch.vehicle_number || "--")}</p>
                <p><strong>Dispatch time:</strong>
                    ${escapeHTML(formatDate(
                        dispatch.dispatch_time || dispatch.created_at
                    ))}</p>
            </div>
        `;

        container.appendChild(card);
    });
}

async function dispatchOrder(orderNumber) {
    const order = orders.find(item =>
        item.order_number === orderNumber
    );

    if (!order) {
        showToast("Order not found", "error");
        return;
    }

    const progress = Number(order.loading_progress || 0);
    const ready =
        progress >= 100 ||
        ["Ready", "Ready for Dispatch"].includes(order.status);

    if (!ready) {
        showToast("Complete loading before dispatch", "warning");
        return;
    }

    const driver = drivers.find(item =>
        Number(item.id) === Number(order.driver_id)
    );

    try {
        await api("/api/warehouse/dispatch", {
            method: "POST",
            body: JSON.stringify({
                order_number: order.order_number,
                driver_id: driver?.id ?? order.driver_id ?? null,
                vehicle_id: driver?.vehicle_id ?? order.vehicle_id ?? null,
                destination: order.destination,
                notes: `Dispatched from ${WAREHOUSE_CODE}`
            })
        });

        showToast(`${order.order_number} dispatched successfully`, "success");
        closeModal("orderModal");
        await refreshWarehouseData();
    } catch (error) {
        console.error("[Warehouse] Dispatch failed:", error);
        showToast(error.message, "error");
    }
}

/* =========================================================
   ACTIVITY HISTORY
   ========================================================= */

async function loadActivityHistory() {
    const data = await api("/api/warehouse/history");

    activities = normalizeArray(data, [
        "history",
        "activities",
        "data"
    ]);
}

function renderActivityHistory() {
    const container = document.getElementById("activityTimeline");
    if (!container) return;

    container.innerHTML = "";

    if (!activities.length) {
        container.innerHTML = `
            <div class="empty-state">No warehouse activity yet</div>
        `;
        return;
    }

    activities.forEach(activity => {
        const item = document.createElement("div");
        item.className = "timeline-item";

        item.innerHTML = `
            <div class="timeline-dot"></div>
            <div class="timeline-content">
                <strong>${escapeHTML(activity.action || "Activity")}</strong>
                <p>${escapeHTML(activity.description || "")}</p>
                <small>
                    ${escapeHTML(activity.actor || "System")}
                    · ${escapeHTML(formatDate(activity.created_at))}
                </small>
            </div>
        `;

        container.appendChild(item);
    });
}

/* =========================================================
   CAPACITY AND READINESS
   ========================================================= */

function updateCapacityPage() {
    if (!warehouse) return;

    updateCapacity(
        "storageCapacity",
        "storageProgress",
        warehouse.current_storage,
        warehouse.storage_capacity
    );

    updateCapacity(
        "loadingCapacity",
        "loadingProgress",
        warehouse.current_loading,
        warehouse.loading_capacity
    );

    updateCapacity(
        "outboundCapacity",
        "outboundProgress",
        warehouse.current_outbound,
        warehouse.outbound_capacity
    );

    renderDrivers();
}

function updateCapacity(valueId, progressId, currentValue, totalValue) {
    const current = Number(currentValue || 0);
    const total = Number(totalValue || 0);
    const percentage = total > 0
        ? Math.min(100, Math.max(0, Math.round(current / total * 100)))
        : 0;

    setText(valueId, `${current} / ${total} kg`);

    const progress = document.getElementById(progressId);
    if (progress) progress.style.width = `${percentage}%`;
}

function updateReadiness() {
    if (!warehouse) return;

    const usage = (current, capacity) => {
        current = Number(current || 0);
        capacity = Number(capacity || 0);

        return capacity > 0
            ? Math.min(100, Math.max(0, Math.round(current / capacity * 100)))
            : 0;
    };

    const storage = usage(
        warehouse.current_storage,
        warehouse.storage_capacity
    );

    const loading = usage(
        warehouse.current_loading,
        warehouse.loading_capacity
    );

    const outbound = usage(
        warehouse.current_outbound,
        warehouse.outbound_capacity
    );

    const readiness = Math.round(
        ((100 - storage) + (100 - loading) + (100 - outbound)) / 3
    );

    setText("storageValue", `${storage}%`);
    setText("loadingValue", `${loading}%`);
    setText("outboundValue", `${outbound}%`);
    setText("readinessValue", `${readiness}%`);

    setWidth("readinessBar", readiness);
    setText("capStorage", `${storage}%`);
    setText("capLoading", `${loading}%`);
    setText("capOutbound", `${outbound}%`);

    setText(
        "capStorageText",
        `${Number(warehouse.current_storage || 0)} / ${Number(warehouse.storage_capacity || 0)} kg`
    );

    setText(
        "capLoadingText",
        `${Number(warehouse.current_loading || 0)} / ${Number(warehouse.loading_capacity || 0)} kg`
    );

    setText(
        "capOutboundText",
        `${Number(warehouse.current_outbound || 0)} / ${Number(warehouse.outbound_capacity || 0)} kg`
    );

    setWidth("capStorageBar", storage);
    setWidth("capLoadingBar", loading);
    setWidth("capOutboundBar", outbound);
}

function setWidth(id, percentage) {
    const element = document.getElementById(id);
    if (element) {
        element.style.width = `${clampPercent(percentage)}%`;
    }
}

/* =========================================================
   DASHBOARD
   FIX: renderDashboard() WAS MISSING
   ========================================================= */

function renderDashboard() {
    renderPriorityOrders();
    renderAlerts();
    updateReadiness();

    setText("totalOrders", orders.length);
    setText(
        "pendingOrders",
        orders.filter(order =>
            !["Delivered", "Cancelled", "Dispatched", "Completed"]
                .includes(order.status)
        ).length
    );

    setText(
        "completedOrders",
        orders.filter(order =>
            ["Delivered", "Completed"].includes(order.status)
        ).length
    );

    setText(
        "totalDrivers",
        drivers.length
    );

    setText(
        "totalDispatches",
        dispatches.length
    );

    setText(
        "warehouseBayCount",
        loadingBays.length
    );
}

function renderEverything() {
    renderWarehouse();
    renderDashboard();
    renderOrders();
    renderLoadingBays();
    renderDispatches();
    renderActivityHistory();
    renderDrivers();
    updateCapacityPage();
}

/* =========================================================
   ORDER DETAILS MODAL
   ========================================================= */

function openOrder(orderNumber) {
    selectedOrder = orders.find(order =>
        order.order_number === orderNumber
    );

    if (!selectedOrder) {
        showToast("Order not found", "error");
        return;
    }

    setText("modalOrderNumber", selectedOrder.order_number);
    setText("modalCustomer", selectedOrder.customer || "--");
    setText("modalOrigin", selectedOrder.origin || "--");
    setText("modalDestination", selectedOrder.destination || "--");
    setText("modalStatus", selectedOrder.status || "--");
    setText("modalPriority", selectedOrder.priority || "--");
    setText(
        "modalETA",
        selectedOrder.revised_eta || selectedOrder.original_eta || "--"
    );
    setText("modalRisk", selectedOrder.risk || "Low");
    setText("modalProgress", `${clampPercent(selectedOrder.loading_progress)}%`);

    const dispatchButton = document.getElementById("modalDispatchButton");

    if (dispatchButton) {
        const ready =
            clampPercent(selectedOrder.loading_progress) >= 100 ||
            ["Ready", "Ready for Dispatch"].includes(selectedOrder.status);

        dispatchButton.disabled = !ready;
        dispatchButton.onclick = () => {
            if (selectedOrder) dispatchOrder(selectedOrder.order_number);
        };
    }

    openModal("orderModal");
}

async function updateSelectedOrderStatus(status) {
    if (!selectedOrder) {
        showToast("No order selected", "warning");
        return;
    }

    try {
        await api(
            `/api/orders/${encodeURIComponent(selectedOrder.order_number)}`,
            {
                method: "PUT",
                body: JSON.stringify({ status })
            }
        );

        showToast(`${selectedOrder.order_number} → ${status}`, "success");
        closeModal("orderModal");
        await refreshWarehouseData();
    } catch (error) {
        showToast(error.message, "error");
    }
}

/* =========================================================
   CREATE ORDER
   ========================================================= */

function openNewOrder() {
    openModal("newOrderModal");
}

async function createNewOrder() {
    const value = id => document.getElementById(id)?.value.trim() || "";

    const orderNumber = value("newOrderNumber");
    const customer = value("newOrderCustomer");
    const origin = value("newOrderOrigin");
    const destination = value("newOrderDestination");
    const eta = value("newOrderETA");
    const deadline = value("newOrderDeadline");

    const priority =
        document.getElementById("newOrderPriority")?.value || "Medium";

    const weight = Number(
        document.getElementById("newOrderWeight")?.value || 0
    );

    if (!orderNumber || !customer || !origin || !destination) {
        showToast(
            "Order number, customer, origin and destination are required",
            "warning"
        );
        return;
    }

    if (!Number.isFinite(weight) || weight < 0) {
        showToast("Enter a valid non-negative weight", "warning");
        return;
    }

    try {
        const result = await api("/api/orders", {
            method: "POST",
            body: JSON.stringify({
                order_number: orderNumber,
                customer,
                origin,
                destination,
                priority,
                original_eta: eta || null,
                deadline: deadline || null,
                weight,
                warehouse_id: warehouse?.id || 1,
                risk: "Low"
            })
        });

        const createdOrder = result?.order || result?.data || result;

        showToast(
            `Order ${createdOrder?.order_number || orderNumber} created successfully`,
            "success"
        );

        closeModal("newOrderModal");
        clearNewOrderForm();
        await refreshWarehouseData();
    } catch (error) {
        showToast(error.message, "error");
    }
}

function clearNewOrderForm() {
    [
        "newOrderNumber",
        "newOrderCustomer",
        "newOrderOrigin",
        "newOrderDestination",
        "newOrderETA",
        "newOrderDeadline",
        "newOrderWeight"
    ].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = "";
    });

    const priority = document.getElementById("newOrderPriority");
    if (priority) priority.value = "Medium";
}

/* =========================================================
   SEARCH AND FILTERS
   ========================================================= */

function initializeSearch() {
    ["orderSearch"].forEach(id => {
        document.getElementById(id)?.addEventListener("input", renderOrders);
    });

    ["orderStatusFilter", "orderPriorityFilter"].forEach(id => {
        document.getElementById(id)?.addEventListener("change", renderOrders);
    });

    ["baySearch"].forEach(id => {
        document.getElementById(id)?.addEventListener("input", filterBays);
    });

    document.getElementById("dispatchSearch")?.addEventListener(
        "input",
        filterDispatches
    );
}

function filterBays() {
    const query = (
        document.getElementById("baySearch")?.value || ""
    ).trim().toLowerCase();

    const cards = document.querySelectorAll("#loadingBaysContainer .loading-bay-card");

    cards.forEach(card => {
        card.style.display = card.textContent.toLowerCase().includes(query)
            ? ""
            : "none";
    });
}

function filterDispatches() {
    const query = (
        document.getElementById("dispatchSearch")?.value || ""
    ).trim().toLowerCase();

    const cards = document.querySelectorAll("#dispatchList .dispatch-card");

    cards.forEach(card => {
        card.style.display = card.textContent.toLowerCase().includes(query)
            ? ""
            : "none";
    });
}

/* =========================================================
   NAVIGATION
   ========================================================= */

function initializeNavigation() {
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", () => {
            const page = item.dataset.page;
            if (page) switchPage(page);
        });
    });
}

function switchPage(page) {
    currentPage = page;

    document.querySelectorAll(".nav-item").forEach(item => {
        item.classList.toggle("active", item.dataset.page === page);
    });

    document.querySelectorAll(".page").forEach(section => {
        section.classList.toggle("active", section.id === `page-${page}`);
    });

    updatePageTitle(page);

    if (page === "loading") loadLoadingBays().then(renderLoadingBays).catch(showLoadError);
    if (page === "dispatch") loadDispatches().then(renderDispatches).catch(showLoadError);
    if (page === "history") loadActivityHistory().then(renderActivityHistory).catch(showLoadError);
    if (page === "capacity") updateCapacityPage();
    if (page === "alerts") loadDisruptions().then(renderAlerts).catch(showLoadError);
    if (page === "orders") loadOrders().then(renderOrders).catch(showLoadError);
}

function updatePageTitle(page) {
    const titles = {
        dashboard: ["Warehouse Dashboard", "Real-time warehouse operations"],
        orders: ["Incoming Orders", "Manage warehouse orders"],
        loading: ["Loading Operations", "Live loading bay management"],
        dispatch: ["Dispatch Control", "Manage outgoing shipments"],
        capacity: ["Warehouse Capacity", "Live capacity utilization"],
        alerts: ["Warehouse Alerts", "Operational alerts and disruptions"],
        history: ["Activity History", "Warehouse activity timeline"]
    };

    const data = titles[page] || titles.dashboard;
    setText("pageTitle", data[0]);
    setText("pageSubtitle", data[1]);
}

function showLoadError(error) {
    console.error("[Warehouse] Page load failed:", error);
    showToast(error.message || "Could not load page data", "error");
}

/* =========================================================
   SOCKET.IO REAL-TIME UPDATES
   ========================================================= */

function connectRealtime() {
    if (typeof window.io !== "function") {
        console.warn("Socket.IO client not loaded");
        setText("realtimeStatus", "Realtime Unavailable");
        return;
    }

    socket = window.io(SOCKET_URL, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000
    });

    socket.on("connect", () => {
        console.log("[Warehouse] Realtime connected:", socket.id);

        socket.emit("identify", {
            role: "warehouse",
            warehouseCode: WAREHOUSE_CODE
        });

        setText("realtimeStatus", "Realtime Connected");
        setText("backendStatus", "Backend Online");
        setConnectionDot(true);
    });

    socket.on("disconnect", reason => {
        console.warn("[Warehouse] Realtime disconnected:", reason);
        setText("realtimeStatus", "Realtime Offline");
    });

    socket.on("connect_error", error => {
        console.error("[Warehouse] Socket connection error:", error.message);
        setText("realtimeStatus", "Connection Error");
    });

    const reloadOrders = async () => {
        try {
            await loadOrders();
            renderOrders();
            renderDashboard();
        } catch (error) {
            console.error("[Warehouse] Order refresh failed:", error);
        }
    };

    const reloadWarehouse = async () => {
        try {
            await Promise.allSettled([
                loadOrders(),
                loadDrivers(),
                loadDisruptions(),
                loadWarehouse(),
                loadLoadingBays(),
                loadDispatches(),
                loadActivityHistory()
            ]);

            renderEverything();
        } catch (error) {
            console.error("[Warehouse] Realtime refresh failed:", error);
        }
    };

    socket.on("orderCreated", async order => {
        await reloadOrders();
        await loadActivityHistory().catch(() => {});
        renderActivityHistory();

        showToast(
            `New order ${order?.order_number || "received"}`,
            "success"
        );
    });

    socket.on("warehouseOrderCreated", reloadWarehouse);
    socket.on("orderUpdated", reloadOrders);

    socket.on("driverLocationUpdated", data => {
        const driver = drivers.find(item =>
            Number(item.id) === Number(data?.driverId)
        );

        if (driver) {
            driver.latitude = data.latitude;
            driver.longitude = data.longitude;
            driver.speed = data.speed;
            driver.last_location_update = data.timestamp;
            renderDrivers();
        }
    });

    socket.on("newDisruption", disruption => {
        if (disruption) {
            const exists = disruptions.some(item =>
                item.id != null && item.id === disruption.id
            );

            if (!exists) disruptions.unshift(disruption);

            renderAlerts();
            renderDashboard();

            showToast(
                `New ${disruption.type || "disruption"} detected`,
                "warning"
            );
        }
    });

    socket.on("operatorDecision", data => {
        showToast(
            `Operator decision: ${data?.decision || "Updated"}`,
            "info"
        );
    });

    socket.on("loadingBayUpdated", async data => {
        await reloadWarehouse();

        if (data?.order_number) {
            showToast(`${data.order_number} loading bay updated`, "success");
        }
    });

    socket.on("loadingProgressUpdated", reloadWarehouse);

    socket.on("loadingCompleted", async data => {
        await reloadWarehouse();

        showToast(
            `${data?.order_number || "Order"} loading completed`,
            "success"
        );
    });

    socket.on("dispatchCreated", async data => {
        await reloadWarehouse();

        showToast(
            `${data?.order_number || "Order"} dispatched`,
            "success"
        );
    });

    socket.on("dispatchUpdated", async () => {
        try {
            await loadDispatches();
            renderDispatches();
        } catch (error) {
            console.error("[Warehouse] Dispatch refresh failed:", error);
        }
    });

    socket.on("warehouseUpdated", reloadWarehouse);
}

/* =========================================================
   MODALS
   ========================================================= */

function initializeModals() {
    document.querySelectorAll("[data-close-modal]").forEach(button => {
        button.addEventListener("click", () => {
            closeModal(button.dataset.closeModal);
        });
    });

    document.querySelectorAll(".modal").forEach(modal => {
        modal.addEventListener("click", event => {
            if (event.target === modal) {
                modal.classList.remove("active");
            }
        });
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            document.querySelectorAll(".modal.active").forEach(modal => {
                modal.classList.remove("active");
            });
        }
    });
}

function openModal(id) {
    document.getElementById(id)?.classList.add("active");
}

function closeModal(id) {
    document.getElementById(id)?.classList.remove("active");
}

/* =========================================================
   BUTTONS
   ========================================================= */

function initializeButtons() {
    document.getElementById("refreshOrdersBtn")?.addEventListener(
        "click",
        async () => {
            await loadEverything();
            showToast("Warehouse data refreshed", "success");
        }
    );

    document.getElementById("clearAlertsBtn")?.addEventListener(
        "click",
        () => {
            disruptions = disruptions.map(item => ({
                ...item,
                status: "Acknowledged"
            }));

            renderAlerts();
            renderDashboard();
            showToast("Alerts acknowledged in this view", "info");
        }
    );
}

/* =========================================================
   LIVE CLOCK
   ========================================================= */

function initializeClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const element = document.getElementById("liveClock");
    if (!element) return;

    element.textContent = new Date().toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "medium"
    });
}

/* =========================================================
   TOAST NOTIFICATIONS
   ========================================================= */

function showToast(message, type = "info") {
    let container = document.getElementById("toastContainer");

    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = String(message ?? "");

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("hide");
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

/* =========================================================
   BADGES
   ========================================================= */

function statusBadge(status) {
    const safe = status || "Unknown";
    const className = String(safe)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");

    return `
        <span class="status-badge ${className}">
            ${escapeHTML(safe)}
        </span>
    `;
}

function priorityBadge(priority) {
    const safe = priority || "Medium";
    const className = String(safe).toLowerCase();

    return `
        <span class="priority-badge ${className}">
            ${escapeHTML(safe)}
        </span>
    `;
}

function priorityScore(priority) {
    return {
        Critical: 4,
        High: 3,
        Medium: 2,
        Low: 1
    }[priority] || 0;
}

/* =========================================================
   REFRESH WAREHOUSE DATA
   ========================================================= */

async function refreshWarehouseData() {
    const tasks = [
        loadOrders(),
        loadDrivers(),
        loadDisruptions(),
        loadWarehouse(),
        loadLoadingBays(),
        loadDispatches(),
        loadActivityHistory()
    ];

    const results = await Promise.allSettled(tasks);

    results.forEach((result, index) => {
        if (result.status === "rejected") {
            console.error(
                `[Warehouse] Refresh task ${index + 1} failed:`,
                result.reason
            );
        }
    });

    renderEverything();
}

/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value ?? "--";
}

function formatDate(value) {
    if (!value) return "--";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString("en-IN", {
        dateStyle: "short",
        timeStyle: "short"
    });
}

function clampPercent(value) {
    const number = Number(value || 0);

    if (!Number.isFinite(number)) return 0;

    return Math.min(100, Math.max(0, number));
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* =========================================================
   GLOBAL FUNCTIONS
   ========================================================= */

window.switchPage = switchPage;
window.openOrder = openOrder;
window.openNewOrder = openNewOrder;
window.createNewOrder = createNewOrder;
window.clearNewOrderForm = clearNewOrderForm;
window.updateSelectedOrderStatus = updateSelectedOrderStatus;
window.assignBayFromUI = assignBayFromUI;
window.updateBayProgress = updateBayProgress;
window.completeBay = completeBay;
window.dispatchOrder = dispatchOrder;
window.openModal = openModal;
window.closeModal = closeModal;
window.showToast = showToast;
window.loadEverything = loadEverything;
window.refreshWarehouseData = refreshWarehouseData;