import json, os, sys, tempfile, threading, unittest, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import app, db, engine


def fresh():
    p = os.path.join(tempfile.mkdtemp(), "t.db")
    return db.connect(p), p


def mid(w, a, b):
    A, B = w["deliveries"][a], w["deliveries"][b]
    return (A["lat"] + B["lat"]) / 2, (A["lng"] + B["lng"]) / 2


class EngineTests(unittest.TestCase):
    def test_baseline_all_on_time(self):
        c, _ = fresh(); w, plan = db.load(c); ev = engine.evaluate(w, plan)
        self.assertEqual(engine.kpis(w, plan, ev)["ok"], 12)
        self.assertEqual(engine.options(w, plan), [])

    def test_closure_delays_leg_and_propagates(self):
        c, _ = fresh(); w, plan = db.load(c)
        lat, lng = mid(w, 4, 5)                      # closure between stop 4 and 5 (V2)
        db.add_disruption(c, {"type": "road_closure", "lat": lat, "lng": lng, "radius_m": 600, "minutes": 30})
        w, plan = db.load(c); ev = engine.evaluate(w, plan)
        self.assertTrue(ev["deliveries"][5]["causes"])                 # leg into 5 is hit
        self.assertEqual(ev["deliveries"][4]["causes"], [])            # earlier stop is not
        self.assertTrue(ev["deliveries"][6]["upstream"])               # stop 6 inherits the delay
        self.assertEqual(ev["deliveries"][1]["status"], "ok")          # other vehicles unaffected
        why = engine.explain_stop(w, plan, ev, 6)
        self.assertTrue(any("Dependency" in r for r in why["reasons"]))
        self.assertEqual(why["chain"][0]["kind"], "disruption")

    def test_breakdown_strands_and_full_plan_recovers(self):
        c, _ = fresh(); db.add_disruption(c, {"type": "vehicle_breakdown", "vehicle_id": "V3"})
        w, plan = db.load(c); ev = engine.evaluate(w, plan)
        self.assertEqual(engine.kpis(w, plan, ev)["stranded"], 3)
        opts = engine.options(w, plan)
        full = next(o for o in opts if o["key"] == "full")
        self.assertEqual(full["m"]["left"], 0)
        db.apply_action(c, {"assignment": full["assignment"], "notify": True, "title": full["title"]})
        w, plan = db.load(c); ev = engine.evaluate(w, plan)
        k = engine.kpis(w, plan, ev)
        self.assertEqual((k["late"], k["stranded"]), (0, 0))

    def test_two_breakdowns_cleared_with_standby(self):
        c, _ = fresh()
        for v in ("V2", "V3"):
            db.add_disruption(c, {"type": "vehicle_breakdown", "vehicle_id": v})
        w, plan = db.load(c)
        o = next(o for o in engine.options(w, plan) if o["key"] == "full")
        self.assertEqual(o["m"]["left"], 0)
        self.assertTrue(any(plan_[1] for k, plan_ in o["assignment"].items() if k in ("V5", "V6")))

    def test_customer_change_and_scope(self):
        c, _ = fresh(); db.add_disruption(c, {"type": "customer_change", "delivery_id": 1, "minutes": 60})
        w, plan = db.load(c); ev = engine.evaluate(w, plan)
        self.assertEqual(ev["deliveries"][1]["status"], "late")
        opts = engine.options(w, plan, [1])
        self.assertTrue(opts and opts[0]["m"]["scope_before"] == 1)

    def test_apply_validation(self):
        c, _ = fresh(); w, plan = db.load(c)
        bad = {k: list(v) for k, v in plan.items()}; bad["V1"].pop()
        with self.assertRaises(db.BadRequest):
            db.apply_action(c, {"assignment": bad})
        db.add_disruption(c, {"type": "vehicle_breakdown", "vehicle_id": "V1"})
        w, plan = db.load(c); sneaky = {k: list(v) for k, v in plan.items()}
        sneaky["V1"].append(sneaky["V2"].pop())
        with self.assertRaises(db.BadRequest):
            db.apply_action(c, {"assignment": sneaky})

    def test_resolve_restores_plan(self):
        c, _ = fresh(); i = db.add_disruption(c, {"type": "vehicle_breakdown", "vehicle_id": "V4"})
        db.resolve_disruption(c, i); w, plan = db.load(c)
        self.assertEqual(engine.kpis(w, plan, engine.evaluate(w, plan))["ok"], 12)


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["QUIET"] = "1"
        app.DB_PATH = os.path.join(tempfile.mkdtemp(), "api.db")
        cls.srv = app.ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def call(self, path, method="GET", body=None):
        req = urllib.request.Request(self.base + path, method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_full_flow(self):
        self.call("/api/reset", "POST", {})
        s, st = self.call("/api/state"); self.assertEqual(s, 200); self.assertEqual(st["kpis"]["ok"], 12)
        s, r = self.call("/api/disruptions", "POST", {"type": "vehicle_breakdown", "vehicle_id": "V2"})
        self.assertEqual(s, 200)
        s, st = self.call("/api/state"); self.assertEqual(st["kpis"]["stranded"], 3)
        s, ex = self.call("/api/explain?type=stop&id=4"); self.assertEqual(ex["status"], "stranded")
        s, rec = self.call("/api/recommendations?scope=stop:4")
        self.assertTrue(any(o.get("recommended") for o in rec["options"]))
        full = next(o for o in rec["options"] if o.get("all"))
        s, _ = self.call("/api/actions/apply", "POST", {"assignment": full["assignment"], "notify": True, "title": full["title"]})
        self.assertEqual(s, 200)
        s, st = self.call("/api/state"); self.assertEqual(st["kpis"]["stranded"], 0)
        self.assertEqual(self.call("/api/disruptions", "POST", {"type": "nope"})[0], 400)
        self.assertEqual(self.call("/api/disruptions/999", "DELETE")[0], 400)
        self.assertEqual(self.call("/api/state")[0], 200)

    def test_static(self):
        with urllib.request.urlopen(self.base + "/") as r:
            self.assertIn(b"Logistics", r.read())


if __name__ == "__main__":
    unittest.main(verbosity=2)
