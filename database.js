
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "logix.db");

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("SQLite connection failed:", err.message);
        return;
    }

    console.log("SQLite connected:", dbPath);
});

db.serialize(() => {
    // =====================================================
    // DATABASE TABLES
    // =====================================================

    const tables = [
        `CREATE TABLE IF NOT EXISTS warehouses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            warehouse_code TEXT UNIQUE,
            name TEXT,
            location TEXT,
            storage_capacity REAL DEFAULT 0,
            current_storage REAL DEFAULT 0,
            loading_capacity REAL DEFAULT 0,
            current_loading REAL DEFAULT 0,
            outbound_capacity REAL DEFAULT 0,
            current_outbound REAL DEFAULT 0,
            status TEXT DEFAULT 'Operational',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_number TEXT UNIQUE,
            vehicle_type TEXT,
            capacity REAL DEFAULT 0,
            current_load REAL DEFAULT 0,
            status TEXT DEFAULT 'Available',
            driver_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS drivers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            driver_code TEXT UNIQUE,
            phone TEXT,
            vehicle_id INTEGER,
            status TEXT DEFAULT 'Available',
            latitude REAL,
            longitude REAL,
            speed REAL DEFAULT 0,
            last_location_update DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT UNIQUE NOT NULL,
            customer TEXT,
            origin TEXT,
            destination TEXT,
            status TEXT DEFAULT 'Incoming',
            priority TEXT DEFAULT 'Medium',
            driver_id INTEGER,
            warehouse_id INTEGER,
            original_eta TEXT,
            revised_eta TEXT,
            deadline TEXT,
            risk TEXT DEFAULT 'Low',
            weight REAL DEFAULT 0,
            loading_progress INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS disruptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT,
            severity TEXT,
            location TEXT,
            delay_minutes INTEGER DEFAULT 0,
            description TEXT,
            status TEXT DEFAULT 'Active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operator_name TEXT,
            order_number TEXT,
            decision TEXT,
            reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS loading_bays (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            warehouse_id INTEGER,
            bay_number TEXT,
            status TEXT DEFAULT 'Available',
            order_number TEXT,
            driver_id INTEGER,
            vehicle_id INTEGER,
            progress INTEGER DEFAULT 0,
            started_at DATETIME,
            completed_at DATETIME,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS dispatches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT,
            warehouse_id INTEGER,
            driver_id INTEGER,
            vehicle_id INTEGER,
            status TEXT DEFAULT 'Pending',
            dispatch_time DATETIME,
            destination TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS activity_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module TEXT,
            action TEXT,
            reference_id TEXT,
            description TEXT,
            actor TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    ];

    tables.forEach((sql) => {
        db.run(sql, (err) => {
            if (err) {
                console.error("Table initialization error:", err.message);
            }
        });
    });

    // =====================================================
    // SEED INITIAL WAREHOUSE
    // =====================================================

    db.run(
        `INSERT OR IGNORE INTO warehouses
        (
            warehouse_code, name, location,
            storage_capacity, current_storage,
            loading_capacity, current_loading,
            outbound_capacity, current_outbound, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            "WH-CBE-01",
            "Coimbatore Central",
            "Coimbatore",
            10000,
            6200,
            5000,
            2100,
            8000,
            3100,
            "Operational"
        ],
        function (err) {
            if (err) {
                console.error("Warehouse seed error:", err.message);
                return;
            }

            seedVehiclesAndDrivers();
        }
    );
});

// =====================================================
// VEHICLES AND DRIVERS
// =====================================================

function seedVehiclesAndDrivers() {
    const vehicles = [
        ["TN 38 AB 1234", "Heavy Cargo Truck", 5000, 1800],
        ["TN 37 CD 5678", "Cargo Truck", 3000, 1200],
        ["TN 38 EF 9012", "Light Commercial Vehicle", 1500, 400]
    ];

    let index = 0;

    function insertNextVehicle() {
        if (index >= vehicles.length) {
            seedDrivers();
            return;
        }

        const vehicle = vehicles[index++];

        db.run(
            `INSERT OR IGNORE INTO vehicles
            (vehicle_number, vehicle_type, capacity, current_load, status)
            VALUES (?, ?, ?, ?, 'Available')`,
            vehicle,
            (err) => {
                if (err) {
                    console.error("Vehicle seed error:", err.message);
                }
                insertNextVehicle();
            }
        );
    }

    insertNextVehicle();
}

function seedDrivers() {
    const driverSeeds = [
        ["Arun Kumar", "DRV-001", "9000000001", "TN 38 AB 1234"],
        ["Bala Kumar", "DRV-002", "9000000002", "TN 37 CD 5678"],
        ["Karthik Raj", "DRV-003", "9000000003", "TN 38 EF 9012"]
    ];

    let index = 0;

    function insertNextDriver() {
        if (index >= driverSeeds.length) {
            seedOrders();
            return;
        }

        const [name, code, phone, vehicleNumber] = driverSeeds[index++];

        db.get(
            `SELECT id FROM vehicles WHERE vehicle_number = ?`,
            [vehicleNumber],
            (vehicleErr, vehicle) => {
                if (vehicleErr) {
                    console.error(vehicleErr.message);
                    insertNextDriver();
                    return;
                }

                db.run(
                    `INSERT OR IGNORE INTO drivers
                    (name, driver_code, phone, vehicle_id, status)
                    VALUES (?, ?, ?, ?, 'Available')`,
                    [name, code, phone, vehicle ? vehicle.id : null],
                    (driverErr) => {
                        if (driverErr) {
                            console.error("Driver seed error:", driverErr.message);
                        }
                        insertNextDriver();
                    }
                );
            }
        );
    }

    insertNextDriver();
}

// =====================================================
// DEMO ORDERS
// Existing orders are preserved.
// =====================================================

function seedOrders() {
    db.get(
        `SELECT id FROM warehouses WHERE warehouse_code = ?`,
        ["WH-CBE-01"],
        (warehouseErr, warehouse) => {
            if (warehouseErr || !warehouse) {
                console.error("Warehouse lookup failed:", warehouseErr?.message);
                return;
            }

            db.all(
                `SELECT d.id AS driver_id, d.vehicle_id,
                        v.vehicle_number
                 FROM drivers d
                 LEFT JOIN vehicles v ON v.id = d.vehicle_id
                 ORDER BY d.id`,
                [],
                (driverErr, drivers) => {
                    if (driverErr) {
                        console.error("Driver lookup failed:", driverErr.message);
                        return;
                    }

                    const driver1 = drivers[0] || {};
                    const driver2 = drivers[1] || {};
                    const driver3 = drivers[2] || {};

                    const eta = (hours) =>
                        new Date(Date.now() + hours * 3600000).toISOString();

                    const orders = [
                        {
                            number: "LGX-1001",
                            customer: "ABC Manufacturing",
                            origin: "Coimbatore Warehouse",
                            destination: "Tiruppur",
                            status: "Incoming",
                            priority: "High",
                            driver: null,
                            progress: 0,
                            weight: 1200
                        },
                        {
                            number: "LGX-1002",
                            customer: "South Textiles",
                            origin: "Coimbatore Warehouse",
                            destination: "Erode",
                            status: "Loading",
                            priority: "Medium",
                            driver: driver1,
                            progress: 65,
                            weight: 1800
                        },
                        {
                            number: "LGX-1003",
                            customer: "Prime Retail",
                            origin: "Coimbatore Warehouse",
                            destination: "Salem",
                            status: "In Transit",
                            priority: "High",
                            driver: driver2,
                            progress: 100,
                            weight: 900
                        },
                        {
                            number: "LGX-1004",
                            customer: "Green Foods",
                            origin: "Coimbatore Warehouse",
                            destination: "Pollachi",
                            status: "Incoming",
                            priority: "Low",
                            driver: driver3,
                            progress: 0,
                            weight: 600
                        }
                    ];

                    let index = 0;

                    function insertNextOrder() {
                        if (index >= orders.length) {
                            seedBaysAndDispatches(warehouse.id, orders, drivers);
                            return;
                        }

                        const order = orders[index++];

                        db.run(
                            `INSERT OR IGNORE INTO orders
                            (
                                order_number, customer, origin, destination,
                                status, priority, driver_id, warehouse_id,
                                original_eta, revised_eta, deadline,
                                risk, weight, loading_progress
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                order.number,
                                order.customer,
                                order.origin,
                                order.destination,
                                order.status,
                                order.priority,
                                order.driver?.driver_id || null,
                                warehouse.id,
                                eta(4),
                                eta(4),
                                eta(6),
                                "Low",
                                order.weight,
                                order.progress
                            ],
                            (err) => {
                                if (err) {
                                    console.error("Order seed error:", err.message);
                                }
                                insertNextOrder();
                            }
                        );
                    }

                    insertNextOrder();
                }
            );
        }
    );
}

// =====================================================
// LOADING BAYS, DISPATCH, AND INITIAL HISTORY
// =====================================================

function seedBaysAndDispatches(warehouseId, orders, drivers) {
    const bays = [
        {
            number: "Bay 01",
            status: "Available",
            order: null,
            progress: 0
        },
        {
            number: "Bay 02",
            status: "Loading",
            order: "LGX-1002",
            progress: 65
        },
        {
            number: "Bay 03",
            status: "Available",
            order: null,
            progress: 0
        },
        {
            number: "Bay 04",
            status: "Maintenance",
            order: null,
            progress: 0
        }
    ];

    let index = 0;

    function insertNextBay() {
        if (index >= bays.length) {
            seedDispatch();
            return;
        }

        const bay = bays[index++];

        const assignedOrder = orders.find(
            (order) => order.number === bay.order
        );

        db.get(
            `SELECT id FROM orders WHERE order_number = ?`,
            [bay.order || ""],
            (orderErr, orderRow) => {
                if (orderErr) {
                    console.error(orderErr.message);
                }

                db.get(
                    `SELECT id FROM drivers WHERE id = ?`,
                    [assignedOrder?.driver?.driver_id || -1],
                    (driverErr, driverRow) => {
                        db.get(
                            `SELECT id FROM vehicles WHERE id = ?`,
                            [assignedOrder?.driver?.vehicle_id || -1],
                            (vehicleErr, vehicleRow) => {
                                db.run(
                                    `INSERT INTO loading_bays
                                    (
                                        warehouse_id, bay_number, status,
                                        order_number, driver_id, vehicle_id, progress
                                    )
                                    SELECT ?, ?, ?, ?, ?, ?, ?
                                    WHERE NOT EXISTS (
                                        SELECT 1 FROM loading_bays
                                        WHERE warehouse_id = ? AND bay_number = ?
                                    )`,
                                    [
                                        warehouseId,
                                        bay.number,
                                        bay.status,
                                        orderRow ? bay.order : null,
                                        driverRow ? driverRow.id : null,
                                        vehicleRow ? vehicleRow.id : null,
                                        bay.progress,
                                        warehouseId,
                                        bay.number
                                    ],
                                    (err) => {
                                        if (err) {
                                            console.error("Bay seed error:", err.message);
                                        }
                                        insertNextBay();
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    }

    insertNextBay();

    function seedDispatch() {
        db.get(
            `SELECT id FROM dispatches WHERE order_number = ?`,
            ["LGX-1003"],
            (err, existing) => {
                if (err) {
                    console.error("Dispatch lookup error:", err.message);
                    return;
                }

                if (existing) {
                    seedInitialHistory();
                    return;
                }

                db.get(
                    `SELECT * FROM orders WHERE order_number = ?`,
                    ["LGX-1003"],
                    (orderErr, order) => {
                        if (orderErr || !order) {
                            seedInitialHistory();
                            return;
                        }

                        db.run(
                            `INSERT INTO dispatches
                            (
                                order_number, warehouse_id, driver_id,
                                vehicle_id, status, dispatch_time,
                                destination, notes
                            )
                            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
                            [
                                order.order_number,
                                warehouseId,
                                order.driver_id,
                                drivers[1]?.vehicle_id || null,
                                "Dispatched",
                                order.destination,
                                "Initial demonstration dispatch"
                            ],
                            (insertErr) => {
                                if (insertErr) {
                                    console.error("Dispatch seed error:", insertErr.message);
                                }
                                seedInitialHistory();
                            }
                        );
                    }
                );
            }
        );
    }

    function seedInitialHistory() {
        db.get(
            `SELECT id FROM activity_history WHERE module = 'Warehouse' LIMIT 1`,
            [],
            (err, existing) => {
                if (err || existing) return;

                db.run(
                    `INSERT INTO activity_history
                    (module, action, reference_id, description, actor)
                    VALUES (?, ?, ?, ?, ?)`,
                    [
                        "Warehouse",
                        "System Initialized",
                        "WH-CBE-01",
                        "Warehouse demonstration data initialized",
                        "System"
                    ]
                );
            }
        );
    }
}

// =====================================================
// OPTIONAL DEMONSTRATION DISRUPTION
// Only insert if no disruptions exist.
// =====================================================

db.get(
    `SELECT COUNT(*) AS count FROM disruptions`,
    [],
    (err, row) => {
        if (err || !row || row.count > 0) return;

        db.run(
            `INSERT INTO disruptions
            (type, severity, location, delay_minutes, description, status)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                "Traffic Congestion",
                "Medium",
                "Coimbatore - Avinashi Road",
                25,
                "Demonstration traffic delay for dashboard testing",
                "Active"
            ],
            (insertErr) => {
                if (insertErr) {
                    console.error("Disruption seed error:", insertErr.message);
                }
            }
        );
    }
);

module.exports = db;