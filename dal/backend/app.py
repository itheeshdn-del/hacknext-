"""Disruption-Aware Logistics Planner: HTTP server (standard library only).
Run:  python backend/app.py   ->  http://localhost:8000
"""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import db
import engine

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get("DB_PATH", os.path.join(ROOT, "data", "logistics.db"))
STATIC = os.path.join(ROOT, "frontend")
LOCK = threading.Lock()
TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json"}


def snapshot(conn):
    w, plan = db.load(conn)
    ev = engine.evaluate(w, plan)
    dels = []
    for did, d in w["deliveries"].items():
        r = ev["deliveries"][did]
        dels.append({"id": did, "customer": d["customer"], "address": d["address"], "lat": d["lat"], "lng": d["lng"],
                     "priority": d["priority"], "perishable": d["perishable"], "planned_eta": d["planned_eta"],
                     "notified": d["notified"], "vehicle": r["vehicle"], "seq": r["seq"], "eta": r["eta"],
                     "deadline": r["deadline"], "late_by": r["late_by"], "status": r["status"], "score": r["score"],
                     "urgency": r["urgency"], "downstream": r["downstream"],
                     "changed": any(x["type"] == "customer_change" and x["delivery_id"] == did
                                    for x in w["disruptions"]),
                     "causes": r["causes"], "upstream": r["upstream"]})
    vehs = [{"id": vid, "name": v["name"], "color": v["color"], "role": v["role"], "capacity": v["capacity"],
             "start_delay": v["start_delay"], "down": engine.is_down(w, vid), "route": plan[vid]}
            for vid, v in w["vehicles"].items()]
    dis = [dict(x, label=engine.dlabel(x)) for x in w["disruptions"]]
    log = [{"clock": r["clock"], "text": r["text"]}
           for r in conn.execute("SELECT clock,text FROM log ORDER BY id DESC LIMIT 40")]
    return {"clock": db.clock(conn), "depot": w["depot"], "vehicles": vehs, "deliveries": dels,
            "disruptions": dis, "kpis": engine.kpis(w, plan, ev), "log": log,
            "messages": engine.messages(w, plan, ev), "km": round(ev["km"], 1)}


def parse_scope(s):
    if not s:
        return None
    kind, _, ident = s.partition(":")
    return kind, ident


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        if os.environ.get("QUIET") != "1":
            super().log_message(fmt, *a)

    def _send(self, code, obj, ctype="application/json"):
        body = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def _run(self, fn):
        try:
            with LOCK:
                conn = db.connect(DB_PATH)
                try:
                    out = fn(conn)
                finally:
                    conn.close()
            self._send(200, out)
        except db.BadRequest as e:
            self._send(400, {"error": str(e)})
        except (ValueError, KeyError) as e:
            self._send(400, {"error": f"bad request: {e}"})

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/api/state":
            return self._run(snapshot)
        if u.path == "/api/recommendations":
            def f(conn):
                w, plan = db.load(conn)
                sc = parse_scope(q.get("scope"))
                ids = None
                if sc and sc[0] == "stop":
                    ids = [int(sc[1])]
                elif sc and sc[0] == "vehicle":
                    ids = list(plan[sc[1]])
                return {"scope": q.get("scope"), "options": engine.options(w, plan, ids)}
            return self._run(f)
        if u.path == "/api/explain":
            def f(conn):
                w, plan = db.load(conn)
                ev = engine.evaluate(w, plan)
                if q.get("type") == "vehicle":
                    return engine.explain_vehicle(w, plan, ev, q["id"])
                return engine.explain_stop(w, plan, ev, int(q["id"]))
            return self._run(f)
        # static files
        rel = "index.html" if u.path in ("/", "") else u.path.lstrip("/")
        fp = os.path.normpath(os.path.join(STATIC, rel))
        if not fp.startswith(STATIC) or not os.path.isfile(fp):
            return self._send(404, {"error": "not found"})
        with open(fp, "rb") as f:
            data = f.read()
        self._send(200, data, TYPES.get(os.path.splitext(fp)[1], "application/octet-stream"))

    def do_POST(self):
        p = urlparse(self.path).path
        try:
            b = self._body()
        except json.JSONDecodeError:
            return self._send(400, {"error": "invalid JSON"})
        if p == "/api/disruptions":
            return self._run(lambda c: {"id": db.add_disruption(c, b)})
        if p == "/api/actions/apply":
            return self._run(lambda c: (db.apply_action(c, b), {"ok": True})[1])
        if p == "/api/reset":
            return self._run(lambda c: (db.seed(c), {"ok": True})[1])
        self._send(404, {"error": "not found"})

    def do_DELETE(self):
        p = urlparse(self.path).path
        if p.startswith("/api/disruptions/"):
            try:
                did = int(p.rsplit("/", 1)[1])
            except ValueError:
                return self._send(400, {"error": "bad id"})
            return self._run(lambda c: (db.resolve_disruption(c, did), {"ok": True})[1])
        self._send(404, {"error": "not found"})


def main():
    port = int(os.environ.get("PORT", 8000))
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Disruption-Aware Logistics Planner running on http://localhost:{port}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
