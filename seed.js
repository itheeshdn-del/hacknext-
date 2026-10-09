const db = require("./database");

console.log("");
console.log("======================================");
console.log("       LOGIX AI OPERATIONAL SEED");
console.log("======================================");


// =====================================================
// HELPERS
// =====================================================

function getColumns(table) {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${table})`, [], (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(rows.map(row => row.name));
        });
    });
}


function getRow(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(row);
        });
    });
}


function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
                return;
            }

            resolve({
                lastID: this.lastID,
                changes: this.changes
            });
        });
    });
}


async function insertUsingAvailableColumns(table, data) {

    const columns = await getColumns(table);

    const usable = Object.keys(data)
        .filter(column => columns.includes(column));

    if (usable.length === 0) {
        throw new Error(
            `No matching columns found for table ${table}`
        );
    }

    const placeholders = usable.map(() => "?").join(", ");

    const sql = `
        INSERT INTO ${table}
        (${usable.join(", ")})
        VALUES (${placeholders})
    `;

    const values = usable.map(column => data[column]);

    return run(sql, values);
}


async function updateUsingAvailableColumns(
    table,
    data,
    whereColumn,
    whereValue
) {

    const columns = await getColumns(table);

    const usable = Object.keys(data)
        .filter(column => columns.includes(column));

    if (usable.length === 0) {
        return;
    }

    const setClause = usable
        .map(column => `${column} = ?`)
        .join(", ");

    const sql = `
        UPDATE ${table}
        SET ${setClause}
        WHERE ${whereColumn} = ?
    `;

    const values = [
        ...usable.map(column => data[column]),
        whereValue
    ];

    await run(sql, values);
}


// =====================================================
// MAIN SEED
// =====================================================

async function seed() {

    try {

        // -------------------------------------------------
        // 1. CHECK VEHICLES
        // -------------------------------------------------

        let vehicle = await getRow(
            `
            SELECT *
            FROM vehicles
            WHERE vehicle_number = ?
            LIMIT 1
            `,
            ["TN 38 AB 1234"]
        );


        if (!vehicle) {

            console.log("Creating vehicle...");

            await insertUsingAvailableColumns(
                "vehicles",
                {
                    vehicle_number: "TN 38 AB 1234",
                    vehicle_type: "Heavy Cargo Truck",
                    capacity: 5000,
                    current_load: 3600
                }
            );

            vehicle = await getRow(
                `
                SELECT *
                FROM vehicles
                WHERE vehicle_number = ?
                LIMIT 1
                `,
                ["TN 38 AB 1234"]
            );
        }


        console.log(
            `Vehicle: ${vehicle.vehicle_number} (ID ${vehicle.id})`
        );


        // -------------------------------------------------
        // 2. CREATE / UPDATE DRIVER
        // -------------------------------------------------

        let driver = await getRow(
            `
            SELECT *
            FROM drivers
            WHERE name = ?
            LIMIT 1
            `,
            ["Arjun Kumar"]
        );


        const driverData = {

            name: "Arjun Kumar",

            vehicle_id: vehicle.id,

            status: "On Trip",

            latitude: 11.0168,

            longitude: 76.9558,

            speed: 0,

            last_location_update:
                new Date().toISOString()
        };


        if (!driver) {

            console.log("Creating driver...");

            await insertUsingAvailableColumns(
                "drivers",
                driverData
            );

            driver = await getRow(
                `
                SELECT *
                FROM drivers
                WHERE name = ?
                LIMIT 1
                `,
                ["Arjun Kumar"]
            );

        } else {

            console.log(
                `Driver already exists: ${driver.name}`
            );

            await updateUsingAvailableColumns(
                "drivers",
                driverData,
                "id",
                driver.id
            );

            driver = await getRow(
                `
                SELECT *
                FROM drivers
                WHERE id = ?
                `,
                [driver.id]
            );
        }


        console.log(
            `Driver: ${driver.name} (ID ${driver.id})`
        );


        // -------------------------------------------------
        // 3. CREATE ORDER
        // -------------------------------------------------

        let order = await getRow(
            `
            SELECT *
            FROM orders
            WHERE order_number = ?
            LIMIT 1
            `,
            ["LOG-1001"]
        );


        const orderData = {

            order_number: "LOG-1001",

            customer: "ABC Manufacturing",

            origin: "Coimbatore Central Warehouse",

            destination: "Tiruppur Industrial Estate",

            status: "In Transit",

            priority: "High",

            driver_id: driver.id,

            warehouse_id: 1,

            original_eta: "10 Oct 2026 10:30",

            revised_eta: "10 Oct 2026 10:45",

            deadline: "10 Oct 2026 12:00",

            risk: "Low",

            weight: 3600,

            loading_progress: 100
        };


        if (!order) {

            console.log("Creating order...");

            await insertUsingAvailableColumns(
                "orders",
                orderData
            );

            order = await getRow(
                `
                SELECT *
                FROM orders
                WHERE order_number = ?
                LIMIT 1
                `,
                ["LOG-1001"]
            );

        } else {

            console.log(
                `Order already exists: ${order.order_number}`
            );

            await updateUsingAvailableColumns(
                "orders",
                orderData,
                "order_number",
                "LOG-1001"
            );

            order = await getRow(
                `
                SELECT *
                FROM orders
                WHERE order_number = ?
                `,
                ["LOG-1001"]
            );
        }


        console.log(
            `Order: ${order.order_number}`
        );


        // -------------------------------------------------
        // 4. CREATE DISPATCH
        // -------------------------------------------------

        let dispatch = await getRow(
            `
            SELECT *
            FROM dispatches
            WHERE order_number = ?
            LIMIT 1
            `,
            ["LOG-1001"]
        );


        if (!dispatch) {

            console.log("Creating active dispatch...");

            await insertUsingAvailableColumns(
                "dispatches",
                {
                    order_number: "LOG-1001",

                    warehouse_id: 1,

                    driver_id: driver.id,

                    vehicle_id: vehicle.id,

                    status: "Dispatched",

                    dispatch_time:
                        new Date().toISOString(),

                    destination:
                        "Tiruppur Industrial Estate",

                    notes:
                        "Live prototype dispatch"
                }
            );

        }


        // -------------------------------------------------
        // 5. UPDATE DRIVER
        // -------------------------------------------------

        await updateUsingAvailableColumns(
            "drivers",
            {
                vehicle_id: vehicle.id,
                status: "On Trip",
                latitude: 11.0168,
                longitude: 76.9558,
                speed: 0,
                last_location_update:
                    new Date().toISOString()
            },
            "id",
            driver.id
        );


        // -------------------------------------------------
        // 6. UPDATE VEHICLE LOAD
        // -------------------------------------------------

        await updateUsingAvailableColumns(
            "vehicles",
            {
                current_load: 3600
            },
            "id",
            vehicle.id
        );


        // -------------------------------------------------
        // 7. UPDATE ORDER
        // -------------------------------------------------

        await updateUsingAvailableColumns(
            "orders",
            {
                status: "In Transit",
                driver_id: driver.id,
                warehouse_id: 1,
                loading_progress: 100
            },
            "order_number",
            "LOG-1001"
        );


        // -------------------------------------------------
        // 8. SHOW FINAL DATA
        // -------------------------------------------------

        const finalDriver = await getRow(
            `
            SELECT
                drivers.*,
                vehicles.vehicle_number,
                vehicles.vehicle_type,
                vehicles.capacity,
                vehicles.current_load
            FROM drivers
            LEFT JOIN vehicles
                ON drivers.vehicle_id = vehicles.id
            WHERE drivers.id = ?
            `,
            [driver.id]
        );


        const finalOrder = await getRow(
            `
            SELECT *
            FROM orders
            WHERE order_number = ?
            `,
            ["LOG-1001"]
        );


        console.log("");
        console.log("======================================");
        console.log("       SEED COMPLETED SUCCESSFULLY");
        console.log("======================================");

        console.log("");
        console.log("DRIVER");
        console.log("--------------------------------------");

        console.log(
            `ID          : ${finalDriver.id}`
        );

        console.log(
            `Name        : ${finalDriver.name}`
        );

        console.log(
            `Status      : ${finalDriver.status}`
        );

        console.log(
            `Vehicle     : ${finalDriver.vehicle_number}`
        );

        console.log(
            `Vehicle Type: ${finalDriver.vehicle_type}`
        );

        console.log(
            `Load        : ${finalDriver.current_load} kg`
        );


        console.log("");
        console.log("ORDER");
        console.log("--------------------------------------");

        console.log(
            `Order       : ${finalOrder.order_number}`
        );

        console.log(
            `Customer    : ${finalOrder.customer}`
        );

        console.log(
            `Origin      : ${finalOrder.origin}`
        );

        console.log(
            `Destination : ${finalOrder.destination}`
        );

        console.log(
            `Status      : ${finalOrder.status}`
        );

        console.log(
            `Priority    : ${finalOrder.priority}`
        );

        console.log(
            `Weight      : ${finalOrder.weight} kg`
        );


        console.log("");
        console.log("======================================");
        console.log("Driver and order are ready.");
        console.log("======================================");
        console.log("");


        process.exit(0);

    } catch (error) {

        console.error("");
        console.error("======================================");
        console.error("          SEED FAILED");
        console.error("======================================");

        console.error(error);

        process.exit(1);
    }
}


seed();