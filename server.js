const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const db = require("./database");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT"]
    }
});

app.use(cors());
app.use(express.json());
const path = require("path");

// Serve the frontend portals
app.use("/customer", express.static(
    path.join(__dirname, "../Customer")
));

app.use("/driver", express.static(
    path.join(__dirname, "../driver")
));

app.use("/operator", express.static(
    path.join(__dirname, "../operator")
));

app.use("/warehouse", express.static(
    path.join(__dirname, "../warehouse")
));

const PORT = 3000;


// =====================================================
// HELPER FUNCTIONS
// =====================================================

function now() {
    return new Date().toISOString();
}

function logActivity(
    module,
    action,
    referenceId,
    description,
    actor = "System"
) {
    db.run(
        `
        INSERT INTO activity_history
        (
            module,
            action,
            reference_id,
            description,
            actor
        )
        VALUES (?, ?, ?, ?, ?)
        `,
        [
            module,
            action,
            String(referenceId || ""),
            description,
            actor
        ],
        (err) => {
            if (err) {
                console.error(
                    "Activity history error:",
                    err.message
                );
            }
        }
    );
}


// =====================================================
// BASIC SERVER
// =====================================================

app.get("/", (req, res) => {

    res.json({
        system: "LOGIX AI",
        status: "ONLINE",
        message: "Real-time logistics backend running",
        timestamp: now()
    });

});


// =====================================================
// SYSTEM STATUS
// =====================================================

app.get("/api/status", (req, res) => {

    res.json({
        system: "LOGIX AI",
        backend: "ONLINE",
        realtime: "ACTIVE",
        database: "CONNECTED",
        timestamp: now()
    });

});


// =====================================================
// ORDERS
// =====================================================

// GET ALL ORDERS

app.get("/api/orders", (req, res) => {

    db.all(
        `
        SELECT *
        FROM orders
        ORDER BY id DESC
        `,
        [],
        (err, rows) => {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            res.json(rows);

        }
    );

});


// GET SINGLE ORDER

app.get("/api/orders/:orderNumber", (req, res) => {

    db.get(
        `
        SELECT *
        FROM orders
        WHERE order_number = ?
        `,
        [req.params.orderNumber],
        (err, row) => {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            if (!row) {

                return res.status(404).json({
                    error: "Order not found"
                });

            }

            res.json(row);

        }
    );

});


// CREATE NEW ORDER

app.post("/api/orders", (req, res) => {

    const {
        order_number,
        customer,
        origin,
        destination,
        priority,
        original_eta,
        revised_eta,
        deadline,
        risk,
        weight,
        driver_id,
        warehouse_id
    } = req.body;

    if (!order_number) {

        return res.status(400).json({
            error: "order_number is required"
        });

    }

    db.run(
        `
        INSERT INTO orders
        (
            order_number,
            customer,
            origin,
            destination,
            status,
            priority,
            driver_id,
            warehouse_id,
            original_eta,
            revised_eta,
            deadline,
            risk,
            weight,
            loading_progress
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            order_number,
            customer || "",
            origin || "",
            destination || "",
            "Incoming",
            priority || "Medium",
            driver_id || null,
            warehouse_id || null,
            original_eta || "",
            revised_eta || original_eta || "",
            deadline || "",
            risk || "Low",
            Number(weight) || 0,
            0
        ],
        function (err) {

            if (err) {

                if (
                    err.message &&
                    err.message.includes("UNIQUE")
                ) {

                    return res.status(409).json({
                        error: "Order number already exists"
                    });

                }

                return res.status(500).json({
                    error: err.message
                });

            }

            const orderId = this.lastID;

            db.get(
                `
                SELECT *
                FROM orders
                WHERE id = ?
                `,
                [orderId],
                (selectErr, order) => {

                    if (selectErr) {

                        return res.status(500).json({
                            error: selectErr.message
                        });

                    }

                    logActivity(
                        "Warehouse",
                        "Order Created",
                        order_number,
                        `Order ${order_number} created`,
                        "Warehouse"
                    );

                    io.emit(
                        "orderCreated",
                        order
                    );

                    io.emit(
                        "warehouseOrderCreated",
                        order
                    );

                    io.emit(
                        "warehouseUpdated",
                        {
                            type: "orderCreated",
                            order
                        }
                    );

                    res.status(201).json(
                        order
                    );

                }
            );

        }
    );

});


// UPDATE ORDER

app.put("/api/orders/:orderNumber", (req, res) => {

    const orderNumber =
        req.params.orderNumber;

    const {
        status,
        revised_eta,
        risk,
        priority,
        driver_id,
        warehouse_id,
        loading_progress
    } = req.body;

    db.run(
        `
        UPDATE orders
        SET

            status =
                COALESCE(?, status),

            revised_eta =
                COALESCE(?, revised_eta),

            risk =
                COALESCE(?, risk),

            priority =
                COALESCE(?, priority),

            driver_id =
                COALESCE(?, driver_id),

            warehouse_id =
                COALESCE(?, warehouse_id),

            loading_progress =
                COALESCE(?, loading_progress),

            updated_at =
                CURRENT_TIMESTAMP

        WHERE order_number = ?
        `,
        [
            status,
            revised_eta,
            risk,
            priority,
            driver_id,
            warehouse_id,
            loading_progress,
            orderNumber
        ],
        function (err) {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            if (this.changes === 0) {

                return res.status(404).json({
                    error: "Order not found"
                });

            }

            db.get(
                `
                SELECT *
                FROM orders
                WHERE order_number = ?
                `,
                [orderNumber],
                (selectErr, order) => {

                    if (selectErr) {

                        return res.status(500).json({
                            error: selectErr.message
                        });

                    }

                    const updateData = {

                        orderNumber,

                        status:
                            order.status,

                        revised_eta:
                            order.revised_eta,

                        risk:
                            order.risk,

                        priority:
                            order.priority,

                        driver_id:
                            order.driver_id,

                        warehouse_id:
                            order.warehouse_id,

                        loading_progress:
                            order.loading_progress,

                        timestamp:
                            now()

                    };

                    logActivity(
                        "Orders",
                        "Order Updated",
                        orderNumber,
                        `Order ${orderNumber} updated`,
                        "System"
                    );

                    io.emit(
                        "orderUpdated",
                        updateData
                    );

                    res.json({

                        success: true,

                        data: updateData,

                        order

                    });

                }
            );

        }
    );

});


// =====================================================
// DRIVERS
// =====================================================

app.get("/api/drivers", (req, res) => {

    db.all(
        `
        SELECT
            drivers.*,
            vehicles.vehicle_number,
            vehicles.vehicle_type AS type,
            vehicles.capacity,
            vehicles.current_load

        FROM drivers

        LEFT JOIN vehicles
        ON drivers.vehicle_id = vehicles.id

        ORDER BY drivers.id
        `,
        [],
        (err, rows) => {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            res.json(rows);

        }
    );

});


// =====================================================
// DRIVER LOCATION
// =====================================================

app.post("/api/drivers/:id/location", (req, res) => {

    const driverId =
        Number(req.params.id);

    const {
        latitude,
        longitude,
        speed
    } = req.body;

    if (
        typeof latitude !== "number" ||
        typeof longitude !== "number"
    ) {

        return res.status(400).json({
            error:
                "Valid latitude and longitude required"
        });

    }

    db.run(
        `
        UPDATE drivers
        SET
            latitude = ?,
            longitude = ?,
            speed = ?,
            last_location_update =
                CURRENT_TIMESTAMP,
            status =
                CASE
                    WHEN ? > 0
                    THEN 'On Trip'
                    ELSE status
                END

        WHERE id = ?
        `,
        [
            latitude,
            longitude,
            Number(speed) || 0,
            Number(speed) || 0,
            driverId
        ],
        function (err) {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            if (this.changes === 0) {

                return res.status(404).json({
                    error: "Driver not found"
                });

            }

            const locationData = {

                driverId,

                latitude,

                longitude,

                speed:
                    Number(speed) || 0,

                timestamp:
                    now()

            };

            io.emit(
                "driverLocationUpdated",
                locationData
            );

            res.json({

                success: true,

                message:
                    "Driver location updated",

                data:
                    locationData

            });

        }
    );

});


// =====================================================
// DISRUPTIONS
// =====================================================

app.post("/api/disruptions", (req, res) => {

    const {
        type,
        severity,
        location,
        delay_minutes,
        description
    } = req.body;

    db.run(
        `
        INSERT INTO disruptions
        (
            type,
            severity,
            location,
            delay_minutes,
            description
        )
        VALUES (?, ?, ?, ?, ?)
        `,
        [
            type || "Other",
            severity || "Medium",
            location || "",
            Number(delay_minutes) || 0,
            description || ""
        ],
        function (err) {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            const disruption = {

                id: this.lastID,

                type:
                    type || "Other",

                severity:
                    severity || "Medium",

                location:
                    location || "",

                delay_minutes:
                    Number(delay_minutes) || 0,

                description:
                    description || "",

                status:
                    "Active",

                timestamp:
                    now()

            };

            logActivity(
                "Operations",
                "Disruption Reported",
                disruption.id,
                `${disruption.type} disruption reported at ${disruption.location}`,
                "System"
            );

            io.emit(
                "newDisruption",
                disruption
            );

            res.status(201).json(
                disruption
            );

        }
    );

});


app.get("/api/disruptions", (req, res) => {

    db.all(
        `
        SELECT *
        FROM disruptions
        WHERE status = 'Active'
        ORDER BY id DESC
        `,
        [],
        (err, rows) => {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            res.json(rows);

        }
    );

});


// =====================================================
// OPERATOR DECISIONS
// =====================================================

app.post("/api/decisions", (req, res) => {

    const {
        operator_name,
        order_number,
        decision,
        reason
    } = req.body;

    db.run(
        `
        INSERT INTO decisions
        (
            operator_name,
            order_number,
            decision,
            reason
        )
        VALUES (?, ?, ?, ?)
        `,
        [
            operator_name || "Operator",
            order_number || "",
            decision || "",
            reason || ""
        ],
        function (err) {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            const decisionData = {

                id:
                    this.lastID,

                operator_name:
                    operator_name || "Operator",

                order_number:
                    order_number || "",

                decision:
                    decision || "",

                reason:
                    reason || "",

                timestamp:
                    now()

            };

            logActivity(
                "Operator",
                "Decision",
                order_number,
                `${decisionData.decision} for ${order_number}`,
                decisionData.operator_name
            );

            io.emit(
                "operatorDecision",
                decisionData
            );

            res.status(201).json(
                decisionData
            );

        }
    );

});


// =====================================================
// WAREHOUSE
// =====================================================


// GET WAREHOUSE

app.get("/api/warehouse", (req, res) => {

    db.get(
        `
        SELECT *
        FROM warehouses
        WHERE warehouse_code = 'WH-CBE-01'
        LIMIT 1
        `,
        [],
        (err, warehouse) => {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            if (!warehouse) {

                return res.status(404).json({
                    error: "Warehouse not found"
                });

            }

            res.json(warehouse);

        }
    );

});


// GET LOADING BAYS

app.get("/api/warehouse/bays", (req, res) => {

    db.all(
        `
        SELECT
            loading_bays.*,

            orders.customer,
            orders.destination,
            orders.priority,

            drivers.name AS driver_name,

            vehicles.vehicle_number

        FROM loading_bays

        LEFT JOIN orders
        ON loading_bays.order_number =
           orders.order_number

        LEFT JOIN drivers
        ON loading_bays.driver_id =
           drivers.id

        LEFT JOIN vehicles
        ON loading_bays.vehicle_id =
           vehicles.id

        ORDER BY loading_bays.id
        `,
        [],
        (err, rows) => {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            res.json(rows);

        }
    );

});


// UPDATE BAY

app.put("/api/warehouse/bays/:id", (req, res) => {

    const bayId =
        Number(req.params.id);

    const {
        status,
        order_number,
        driver_id,
        vehicle_id,
        progress
    } = req.body;

    db.run(
        `
        UPDATE loading_bays
        SET

            status =
                COALESCE(?, status),

            order_number =
                COALESCE(?, order_number),

            driver_id =
                COALESCE(?, driver_id),

            vehicle_id =
                COALESCE(?, vehicle_id),

            progress =
                COALESCE(?, progress),

            updated_at =
                CURRENT_TIMESTAMP

        WHERE id = ?
        `,
        [
            status,
            order_number,
            driver_id,
            vehicle_id,
            progress,
            bayId
        ],
        function (err) {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            if (this.changes === 0) {

                return res.status(404).json({
                    error: "Loading bay not found"
                });

            }

            db.get(
                `
                SELECT *
                FROM loading_bays
                WHERE id = ?
                `,
                [bayId],
                (selectErr, bay) => {

                    if (selectErr) {

                        return res.status(500).json({
                            error:
                                selectErr.message
                        });

                    }

                    io.emit(
                        "loadingBayUpdated",
                        bay
                    );

                    io.emit(
                        "warehouseUpdated",
                        {
                            type:
                                "loadingBayUpdated",

                            bay
                        }
                    );

                    res.json(bay);

                }
            );

        }
    );

});


// ASSIGN BAY

app.post("/api/warehouse/bays/:id/assign", (req, res) => {

    const bayId =
        Number(req.params.id);

    const {
        order_number,
        driver_id,
        vehicle_id
    } = req.body;

    if (!order_number) {

        return res.status(400).json({
            error:
                "order_number is required"
        });

    }

    db.get(
        `
        SELECT *
        FROM loading_bays
        WHERE id = ?
        `,
        [bayId],
        (bayErr, bay) => {

            if (bayErr) {

                return res.status(500).json({
                    error: bayErr.message
                });

            }

            if (!bay) {

                return res.status(404).json({
                    error:
                        "Loading bay not found"
                });

            }

            if (
                bay.status === "Maintenance"
            ) {

                return res.status(409).json({
                    error:
                        "Bay is under maintenance"
                });

            }

            if (
                bay.status === "Loading" &&
                bay.order_number &&
                bay.order_number !== order_number
            ) {

                return res.status(409).json({
                    error:
                        "Bay is already occupied"
                });

            }

            db.run(
                `
                UPDATE loading_bays

                SET

                    status = 'Loading',

                    order_number = ?,

                    driver_id = ?,

                    vehicle_id = ?,

                    progress =
                        COALESCE(progress, 0),

                    started_at =
                        COALESCE(
                            started_at,
                            CURRENT_TIMESTAMP
                        ),

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE id = ?
                `,
                [
                    order_number,
                    driver_id || null,
                    vehicle_id || null,
                    bayId
                ],
                function (err) {

                    if (err) {

                        return res.status(500).json({
                            error:
                                err.message
                        });

                    }

                    db.run(
                        `
                        UPDATE orders
                        SET

                            status =
                                'Loading',

                            driver_id =
                                COALESCE(
                                    ?,
                                    driver_id
                                ),

                            loading_progress =
                                COALESCE(
                                    loading_progress,
                                    0
                                ),

                            updated_at =
                                CURRENT_TIMESTAMP

                        WHERE order_number = ?
                        `,
                        [
                            driver_id || null,
                            order_number
                        ],
                        (orderErr) => {

                            if (orderErr) {

                                console.error(
                                    "Order bay assignment update:",
                                    orderErr.message
                                );

                            }

                            db.get(
                                `
                                SELECT *
                                FROM loading_bays
                                WHERE id = ?
                                `,
                                [bayId],
                                (selectErr, updatedBay) => {

                                    if (selectErr) {

                                        return res.status(500).json({
                                            error:
                                                selectErr.message
                                        });

                                    }

                                    logActivity(
                                        "Warehouse",
                                        "Bay Assigned",
                                        order_number,
                                        `${order_number} assigned to ${updatedBay.bay_number}`,
                                        "Warehouse"
                                    );

                                    io.emit(
                                        "loadingBayUpdated",
                                        updatedBay
                                    );

                                    io.emit(
                                        "warehouseUpdated",
                                        {
                                            type:
                                                "bayAssigned",

                                            bay:
                                                updatedBay
                                        }
                                    );

                                    io.emit(
                                        "orderUpdated",
                                        {
                                            orderNumber:
                                                order_number,

                                            status:
                                                "Loading",

                                            loading_progress:
                                                updatedBay.progress,

                                            timestamp:
                                                now()
                                        }
                                    );

                                    res.json(
                                        updatedBay
                                    );

                                }
                            );

                        }
                    );

                }
            );

        }
    );

});


// UPDATE LOADING PROGRESS

app.put("/api/warehouse/bays/:id/progress", (req, res) => {

    const bayId =
        Number(req.params.id);

    let progress =
        Number(req.body.progress);

    if (!Number.isFinite(progress)) {

        return res.status(400).json({
            error:
                "Valid progress required"
        });

    }

    progress =
        Math.max(
            0,
            Math.min(
                100,
                Math.round(progress)
            )
        );

    db.get(
        `
        SELECT *
        FROM loading_bays
        WHERE id = ?
        `,
        [bayId],
        (err, bay) => {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            if (!bay) {

                return res.status(404).json({
                    error:
                        "Loading bay not found"
                });

            }

            db.run(
                `
                UPDATE loading_bays
                SET

                    progress = ?,

                    status =
                        CASE
                            WHEN ? >= 100
                            THEN 'Ready'
                            ELSE 'Loading'
                        END,

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE id = ?
                `,
                [
                    progress,
                    progress,
                    bayId
                ],
                function (updateErr) {

                    if (updateErr) {

                        return res.status(500).json({
                            error:
                                updateErr.message
                        });

                    }

                    if (
                        bay.order_number
                    ) {

                        db.run(
                            `
                            UPDATE orders
                            SET

                                loading_progress = ?,

                                status =
                                    CASE
                                        WHEN ? >= 100
                                        THEN 'Ready for Loading'
                                        ELSE 'Loading'
                                    END,

                                updated_at =
                                    CURRENT_TIMESTAMP

                            WHERE order_number = ?
                            `,
                            [
                                progress,
                                progress,
                                bay.order_number
                            ]
                        );

                    }

                    db.get(
                        `
                        SELECT *
                        FROM loading_bays
                        WHERE id = ?
                        `,
                        [bayId],
                        (selectErr, updatedBay) => {

                            if (selectErr) {

                                return res.status(500).json({
                                    error:
                                        selectErr.message
                                });

                            }

                            io.emit(
                                "loadingProgressUpdated",
                                updatedBay
                            );

                            io.emit(
                                "loadingBayUpdated",
                                updatedBay
                            );

                            io.emit(
                                "warehouseUpdated",
                                {
                                    type:
                                        "loadingProgressUpdated",

                                    bay:
                                        updatedBay
                                }
                            );

                            if (
                                updatedBay.order_number
                            ) {

                                io.emit(
                                    "orderUpdated",
                                    {
                                        orderNumber:
                                            updatedBay.order_number,

                                        status:
                                            updatedBay.progress >= 100
                                                ? "Ready for Loading"
                                                : "Loading",

                                        loading_progress:
                                            updatedBay.progress,

                                        timestamp:
                                            now()
                                    }
                                );

                            }

                            res.json(
                                updatedBay
                            );

                        }
                    );

                }
            );

        }
    );

});


// COMPLETE BAY

app.post("/api/warehouse/bays/:id/complete", (req, res) => {

    const bayId =
        Number(req.params.id);

    db.get(
        `
        SELECT *
        FROM loading_bays
        WHERE id = ?
        `,
        [bayId],
        (err, bay) => {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            if (!bay) {

                return res.status(404).json({
                    error:
                        "Loading bay not found"
                });

            }

            if (!bay.order_number) {

                return res.status(400).json({
                    error:
                        "No order assigned to this bay"
                });

            }

            const orderNumber =
                bay.order_number;

            db.run(
                `
                UPDATE loading_bays

                SET

                    progress = 100,

                    status = 'Ready',

                    completed_at =
                        CURRENT_TIMESTAMP,

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE id = ?
                `,
                [bayId],
                (updateErr) => {

                    if (updateErr) {

                        return res.status(500).json({
                            error:
                                updateErr.message
                        });

                    }

                    db.run(
                        `
                        UPDATE orders
                        SET

                            loading_progress = 100,

                            status =
                                'Ready for Loading',

                            updated_at =
                                CURRENT_TIMESTAMP

                        WHERE order_number = ?
                        `,
                        [orderNumber],
                        (orderErr) => {

                            if (orderErr) {

                                console.error(
                                    "Order completion update:",
                                    orderErr.message
                                );

                            }

                            db.get(
                                `
                                SELECT *
                                FROM loading_bays
                                WHERE id = ?
                                `,
                                [bayId],
                                (selectErr, updatedBay) => {

                                    if (selectErr) {

                                        return res.status(500).json({
                                            error:
                                                selectErr.message
                                        });

                                    }

                                    logActivity(
                                        "Warehouse",
                                        "Loading Completed",
                                        orderNumber,
                                        `${orderNumber} loading completed at ${updatedBay.bay_number}`,
                                        "Warehouse"
                                    );

                                    io.emit(
                                        "loadingCompleted",
                                        updatedBay
                                    );

                                    io.emit(
                                        "loadingBayUpdated",
                                        updatedBay
                                    );

                                    io.emit(
                                        "orderUpdated",
                                        {
                                            orderNumber,

                                            status:
                                                "Ready for Loading",

                                            loading_progress:
                                                100,

                                            timestamp:
                                                now()
                                        }
                                    );

                                    io.emit(
                                        "warehouseUpdated",
                                        {
                                            type:
                                                "loadingCompleted",

                                            bay:
                                                updatedBay
                                        }
                                    );

                                    res.json(
                                        updatedBay
                                    );

                                }
                            );

                        }
                    );

                }
            );

        }
    );

});


// =====================================================
// WAREHOUSE DISPATCH
// =====================================================


// GET DISPATCHES

app.get("/api/warehouse/dispatches", (req, res) => {

    db.all(
        `
        SELECT

            dispatches.*,

            orders.customer,
            orders.origin,
            orders.priority,
            orders.risk,
            orders.revised_eta,

            drivers.name AS driver_name,

            vehicles.vehicle_number,
            vehicles.vehicle_type

        FROM dispatches

        LEFT JOIN orders
        ON dispatches.order_number =
           orders.order_number

        LEFT JOIN drivers
        ON dispatches.driver_id =
           drivers.id

        LEFT JOIN vehicles
        ON dispatches.vehicle_id =
           vehicles.id

        ORDER BY dispatches.id DESC
        `,
        [],
        (err, rows) => {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            res.json(rows);

        }
    );

});


// CREATE DISPATCH

app.post("/api/warehouse/dispatch", (req, res) => {

    const {
        order_number,
        driver_id,
        vehicle_id,
        notes
    } = req.body;

    if (!order_number) {

        return res.status(400).json({
            error:
                "order_number is required"
        });

    }

    db.get(
        `
        SELECT *
        FROM orders
        WHERE order_number = ?
        `,
        [order_number],
        (orderErr, order) => {

            if (orderErr) {

                return res.status(500).json({
                    error:
                        orderErr.message
                });

            }

            if (!order) {

                return res.status(404).json({
                    error:
                        "Order not found"
                });

            }

            const selectedDriver =
                driver_id ||
                order.driver_id ||
                null;

            let selectedVehicle =
                vehicle_id ||
                null;

            const insertDispatch = () => {

                db.run(
                    `
                    INSERT INTO dispatches
                    (
                        order_number,
                        warehouse_id,
                        driver_id,
                        vehicle_id,
                        status,
                        dispatch_time,
                        destination,
                        notes
                    )
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
                    `,
                    [
                        order_number,
                        order.warehouse_id || 1,
                        selectedDriver,
                        selectedVehicle,
                        "Dispatched",
                        order.destination || "",
                        notes || ""
                    ],
                    function (err) {

                        if (err) {

                            return res.status(500).json({
                                error:
                                    err.message
                            });

                        }

                        const dispatchId =
                            this.lastID;

                        db.run(
                            `
                            UPDATE orders
                            SET

                                status =
                                    'In Transit',

                                driver_id =
                                    COALESCE(
                                        ?,
                                        driver_id
                                    ),

                                loading_progress =
                                    CASE
                                        WHEN loading_progress < 100
                                        THEN 100
                                        ELSE loading_progress
                                    END,

                                updated_at =
                                    CURRENT_TIMESTAMP

                            WHERE order_number = ?
                            `,
                            [
                                selectedDriver,
                                order_number
                            ],
                            (updateErr) => {

                                if (updateErr) {

                                    console.error(
                                        "Dispatch order update:",
                                        updateErr.message
                                    );

                                }

                                if (
                                    selectedDriver
                                ) {

                                    db.run(
                                        `
                                        UPDATE drivers
                                        SET status =
                                            'On Trip'
                                        WHERE id = ?
                                        `,
                                        [
                                            selectedDriver
                                        ]
                                    );

                                }

                                db.get(
                                    `
                                    SELECT *
                                    FROM dispatches
                                    WHERE id = ?
                                    `,
                                    [dispatchId],
                                    (selectErr, dispatch) => {

                                        if (selectErr) {

                                            return res.status(500).json({
                                                error:
                                                    selectErr.message
                                            });

                                        }

                                        logActivity(
                                            "Warehouse",
                                            "Order Dispatched",
                                            order_number,
                                            `${order_number} dispatched to ${order.destination}`,
                                            "Warehouse"
                                        );

                                        io.emit(
                                            "dispatchCreated",
                                            dispatch
                                        );

                                        io.emit(
                                            "orderUpdated",
                                            {
                                                orderNumber:
                                                    order_number,

                                                status:
                                                    "In Transit",

                                                driver_id:
                                                    selectedDriver,

                                                timestamp:
                                                    now()
                                            }
                                        );

                                        io.emit(
                                            "warehouseUpdated",
                                            {
                                                type:
                                                    "dispatchCreated",

                                                dispatch
                                            }
                                        );

                                        res.status(201).json(
                                            dispatch
                                        );

                                    }
                                );

                            }
                        );

                    }
                );

            };


            if (!selectedVehicle && selectedDriver) {

                db.get(
                    `
                    SELECT vehicle_id
                    FROM drivers
                    WHERE id = ?
                    `,
                    [selectedDriver],
                    (driverErr, driver) => {

                        if (
                            driverErr
                        ) {

                            return res.status(500).json({
                                error:
                                    driverErr.message
                            });

                        }

                        selectedVehicle =
                            driver
                                ? driver.vehicle_id
                                : null;

                        insertDispatch();

                    }
                );

            } else {

                insertDispatch();

            }

        }
    );

});


// UPDATE DISPATCH

app.put("/api/warehouse/dispatch/:id", (req, res) => {

    const dispatchId =
        Number(req.params.id);

    const {
        status,
        notes
    } = req.body;

    db.run(
        `
        UPDATE dispatches
        SET

            status =
                COALESCE(?, status),

            notes =
                COALESCE(?, notes)

        WHERE id = ?
        `,
        [
            status,
            notes,
            dispatchId
        ],
        function (err) {

            if (err) {

                return res.status(500).json({
                    error: err.message
                });

            }

            if (this.changes === 0) {

                return res.status(404).json({
                    error:
                        "Dispatch not found"
                });

            }

            db.get(
                `
                SELECT *
                FROM dispatches
                WHERE id = ?
                `,
                [dispatchId],
                (selectErr, dispatch) => {

                    if (selectErr) {

                        return res.status(500).json({
                            error:
                                selectErr.message
                        });

                    }

                    io.emit(
                        "dispatchUpdated",
                        dispatch
                    );

                    io.emit(
                        "warehouseUpdated",
                        {
                            type:
                                "dispatchUpdated",

                            dispatch
                        }
                    );

                    res.json(
                        dispatch
                    );

                }
            );

        }
    );

});


// =====================================================
// WAREHOUSE CAPACITY
// =====================================================

app.get("/api/warehouse/capacity", (req, res) => {

    db.get(
        `
        SELECT
            id,
            warehouse_code,
            name,
            storage_capacity,
            current_storage,
            loading_capacity,
            current_loading,
            outbound_capacity,
            current_outbound,
            status
        FROM warehouses
        WHERE warehouse_code = 'WH-CBE-01'
        `,
        [],
        (err, warehouse) => {

            if (err) {

                return res.status(500).json({
                    error:
                        err.message
                });

            }

            res.json(warehouse);

        }
    );

});


app.put("/api/warehouse/capacity", (req, res) => {

    const {
        current_storage,
        current_loading,
        current_outbound
    } = req.body;

    db.run(
        `
        UPDATE warehouses
        SET

            current_storage =
                COALESCE(?, current_storage),

            current_loading =
                COALESCE(?, current_loading),

            current_outbound =
                COALESCE(?, current_outbound),

            updated_at =
                CURRENT_TIMESTAMP

        WHERE warehouse_code =
            'WH-CBE-01'
        `,
        [
            current_storage,
            current_loading,
            current_outbound
        ],
        function (err) {

            if (err) {

                return res.status(500).json({
                    error:
                        err.message
                });

            }

            db.get(
                `
                SELECT *
                FROM warehouses
                WHERE warehouse_code =
                    'WH-CBE-01'
                `,
                [],
                (selectErr, warehouse) => {

                    if (selectErr) {

                        return res.status(500).json({
                            error:
                                selectErr.message
                        });

                    }

                    io.emit(
                        "warehouseUpdated",
                        {
                            type:
                                "capacityUpdated",

                            warehouse
                        }
                    );

                    res.json(
                        warehouse
                    );

                }
            );

        }
    );

});


// =====================================================
// WAREHOUSE ACTIVITY HISTORY
// =====================================================

app.get("/api/warehouse/history", (req, res) => {

    db.all(
        `
        SELECT *

        FROM activity_history

        WHERE module =
            'Warehouse'

        ORDER BY id DESC

        LIMIT 100
        `,
        [],
        (err, rows) => {

            if (err) {

                return res.status(500).json({
                    error:
                        err.message
                });

            }

            res.json(rows);

        }
    );

});


// =====================================================
// SOCKET.IO
// =====================================================

io.on("connection", (socket) => {

    console.log(
        "Client connected:",
        socket.id
    );

    socket.emit(
        "connectionStatus",
        {
            connected: true,

            message:
                "Connected to LOGIX AI real-time server",

            timestamp:
                now()
        }
    );


    socket.on(
        "identify",
        (data) => {

            console.log(
                "Client identified:",
                data
            );

            socket.join(
                data.role || "unknown"
            );

        }
    );


    socket.on(
        "disconnect",
        () => {

            console.log(
                "Client disconnected:",
                socket.id
            );

        }
    );

});


// =====================================================
// START SERVER
// =====================================================

server.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "======================================"
        );

        console.log(
            "        LOGIX AI BACKEND"
        );

        console.log(
            "======================================"
        );

        console.log(
            `Server: http://localhost:${PORT}`
        );

        console.log(
            `API:    http://localhost:${PORT}/api/status`
        );

        console.log(
            "Realtime: Socket.IO ACTIVE"
        );

        console.log(
            "Database: SQLite"
        );

        console.log(
            "Warehouse APIs: ACTIVE"
        );

        console.log(
            "======================================"
        );

    }
);