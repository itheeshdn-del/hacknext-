"""SQLite persistence: fleet, deliveries, the live plan, active disruptions, action log."""
import json
import os
import sqlite3

import engine

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = """
CREATE TABLE IF NOT EXISTS vehicles(id TEXT PRIMARY KEY, name TEXT, color TEXT, role TEXT, capacity INTEGER, start_delay INTEGER);
CREATE TABLE IF NOT EXISTS deliveries(id INTEGER PRIMARY KEY, customer TEXT, address TEXT, lat REAL, lng REAL,
  priority INTEGER, perishable INTEGER, service_min INTEGER, deadline REAL, planned_eta REAL,
  vehicle_id TEXT, seq INTEGER, notified INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS disruptions(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, vehicle_id TEXT,
  delivery_id INTEGER, lat REAL, lng REAL, radius_m REAL, minutes REAL, clock INTEGER);
CREATE TABLE IF NOT EXISTS log(id INTEGER PRIMARY KEY AUTOINCREMENT, clock INTEGER, text TEXT);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
"""


def connect(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    if not conn.execute("SELECT 1 FROM vehicles LIMIT 1").fetchone():
        seed(conn)
    return conn


def seed(conn):
    for t in ("vehicles", "deliveries", "disruptions", "log", "meta"):
        conn.execute(f"DELETE FROM {t}")
    s = json.load(open(os.path.join(HERE, "seed.json"), encoding="utf-8"))
    conn.execute("INSERT INTO meta VALUES('depot',?)", (json.dumps(s["depot"]),))
    conn.execute("INSERT INTO meta VALUES('clock','0')")
    for v in s["vehicles"]:
        conn.execute("INSERT INTO vehicles VALUES(?,?,?,?,?,?)",
                     (v["id"], v["name"], v["color"], v["role"], v["capacity"], v["start_delay"]))
    seq = {}
    for d in s["deliveries"]:
        seq[d["vehicle"]] = seq.get(d["vehicle"], 0) + 1
        conn.execute("INSERT INTO deliveries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)",
                     (d["id"], d["customer"], d["address"], d["lat"], d["lng"], d["priority"], d["perishable"],
                      6, d["slack"], 0, d["vehicle"], seq[d["vehicle"]]))
    conn.commit()
    # planned ETA comes from the engine; deadline = planned ETA + slack
    w, plan = load(conn)
    ev = engine.evaluate(w, plan)
    for did, r in ev["deliveries"].items():
        conn.execute("UPDATE deliveries SET planned_eta=?, deadline=? WHERE id=?",
                     (r["eta"], r["eta"] + w["deliveries"][did]["deadline"], did))
    log(conn, "Plan loaded: 12 deliveries, 4 vehicles + 2 standby, all on track.")
    conn.commit()


def load(conn):
    depot = json.loads(conn.execute("SELECT value FROM meta WHERE key='depot'").fetchone()[0])
    vehicles = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM vehicles")}
    deliveries = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM deliveries")}
    plan = {vid: [] for vid in vehicles}
    for r in conn.execute("SELECT id, vehicle_id FROM deliveries ORDER BY seq"):
        plan[r["vehicle_id"]].append(r["id"])
    dis = [dict(r) for r in conn.execute("SELECT * FROM disruptions ORDER BY id")]
    return {"depot": depot, "vehicles": vehicles, "deliveries": deliveries, "disruptions": dis}, plan


def clock(conn):
    return int(conn.execute("SELECT value FROM meta WHERE key='clock'").fetchone()[0])


def tick(conn, n=4):
    conn.execute("UPDATE meta SET value=? WHERE key='clock'", (str(clock(conn) + n),))


def log(conn, text):
    conn.execute("INSERT INTO log(clock,text) VALUES(?,?)", (clock(conn), text))


def save_plan(conn, plan):
    for vid, route in plan.items():
        for i, did in enumerate(route):
            conn.execute("UPDATE deliveries SET vehicle_id=?, seq=? WHERE id=?", (vid, i + 1, did))


# ------------------------------------------------------------- mutations
class BadRequest(Exception):
    pass


def add_disruption(conn, b):
    w, plan = load(conn)
    t = b.get("type")
    row = dict(type=t, vehicle_id=None, delivery_id=None, lat=None, lng=None, radius_m=None, minutes=None)
    if t in ("road_closure", "weather"):
        try:
            row.update(lat=float(b["lat"]), lng=float(b["lng"]), radius_m=float(b.get("radius_m", 900)),
                       minutes=float(b.get("minutes", 25 if t == "road_closure" else 15)))
        except (KeyError, TypeError, ValueError):
            raise BadRequest("lat and lng are required numbers")
        what = "Road closure" if t == "road_closure" else "Severe weather"
        text = f"{what} reported (radius {round(row['radius_m'])} m, +{round(row['minutes'])} min on affected legs)."
    elif t == "vehicle_breakdown":
        vid = b.get("vehicle_id")
        if vid not in w["vehicles"]:
            raise BadRequest("unknown vehicle")
        if engine.is_down(w, vid):
            raise BadRequest(f"{vid} is already broken down")
        row["vehicle_id"] = vid
        text = f"{vid} broke down. {len(plan[vid])} deliveries have no vehicle."
    elif t == "customer_change":
        try:
            did = int(b["delivery_id"])
        except (KeyError, TypeError, ValueError):
            raise BadRequest("delivery_id required")
        if did not in w["deliveries"]:
            raise BadRequest("unknown delivery")
        row.update(delivery_id=did, minutes=float(b.get("minutes", 40)))
        text = f"{w['deliveries'][did]['customer']} asked for delivery {round(row['minutes'])} min earlier."
    else:
        raise BadRequest("unknown disruption type")
    tick(conn)
    cur = conn.execute("INSERT INTO disruptions(type,vehicle_id,delivery_id,lat,lng,radius_m,minutes,clock) "
                       "VALUES(?,?,?,?,?,?,?,?)",
                       (row["type"], row["vehicle_id"], row["delivery_id"], row["lat"], row["lng"],
                        row["radius_m"], row["minutes"], clock(conn)))
    log(conn, f"⚠️ {text}")
    conn.commit()
    return cur.lastrowid


def resolve_disruption(conn, did):
    r = conn.execute("SELECT type FROM disruptions WHERE id=?", (did,)).fetchone()
    if not r:
        raise BadRequest("unknown disruption")
    conn.execute("DELETE FROM disruptions WHERE id=?", (did,))
    tick(conn)
    log(conn, f"✔️ Disruption #{did} ({r['type'].replace('_', ' ')}) resolved.")
    conn.commit()


def apply_action(conn, b):
    w, plan = load(conn)
    try:
        asg = {str(k): [int(x) for x in v] for k, v in b["assignment"].items()}
    except (KeyError, TypeError, ValueError, AttributeError):
        raise BadRequest("assignment required")
    if set(asg) != set(w["vehicles"]):
        raise BadRequest("assignment must list every vehicle")
    flat = [i for r in asg.values() for i in r]
    if sorted(flat) != sorted(w["deliveries"]):
        raise BadRequest("every delivery must be assigned exactly once")
    for vid, route in asg.items():
        if len(route) > w["vehicles"][vid]["capacity"]:
            raise BadRequest(f"{vid} over capacity")
        if engine.is_down(w, vid) and not set(route) <= set(plan[vid]):
            raise BadRequest(f"{vid} is down and cannot take new deliveries")
    save_plan(conn, asg)
    if b.get("notify"):
        w2, p2 = load(conn)
        ev = engine.evaluate(w2, p2)
        for did, r in ev["deliveries"].items():
            if r["status"] in ("late", "stranded"):
                conn.execute("UPDATE deliveries SET notified=1 WHERE id=?", (did,))
    tick(conn)
    log(conn, f"✅ Action applied: {str(b.get('title', 'plan update'))[:80]}.")
    conn.commit()
