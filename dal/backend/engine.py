"""Disruption-aware logistics engine (pure Python, zero dependencies).

Answers the three questions:
  evaluate()/explain()  -> What changed? What is affected, and why?
  options()             -> What should we do next?
All times are minutes after 09:00.  A "world" is a dict:
  {depot, vehicles{id}, deliveries{id}, disruptions[]}
A "plan" is {vehicle_id: [delivery ids in visiting order]}.
"""
import math

BASE_HOUR = 9
ROAD_FACTOR = 1.35      # straight-line km -> road km
SPEED_KMH = 28.0        # average urban speed
RISK_MARGIN = 10        # minutes of slack below which a stop is "at risk"


def fmt(t):
    m = int(round(t))
    return f"{BASE_HOUR + m // 60:02d}:{m % 60:02d}"


# ---------------------------------------------------------------- geometry
def hav_km(a, b):
    R = 6371.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))


def road_km(a, b):
    return hav_km(a, b) * ROAD_FACTOR


def travel_min(a, b):
    return road_km(a, b) / SPEED_KMH * 60


def seg_dist_m(a, b, p):
    """Distance in metres from point p to segment a-b (local flat approximation)."""
    kx, ky = 111320 * math.cos(math.radians(p[0])), 110540
    ax, ay = (a[1] - p[1]) * kx, (a[0] - p[0]) * ky
    bx, by = (b[1] - p[1]) * kx, (b[0] - p[0]) * ky
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, -(ax * dx + ay * dy) / L))
    return math.hypot(ax + t * dx, ay + t * dy)


# ------------------------------------------------------------ world helpers
def pt(o):
    return (o["lat"], o["lng"])


def is_down(w, vid):
    return any(d["type"] == "vehicle_breakdown" and d["vehicle_id"] == vid for d in w["disruptions"])


def eff_deadline(w, did):
    shift = sum(x["minutes"] for x in w["disruptions"]
                if x["type"] == "customer_change" and x["delivery_id"] == did)
    return w["deliveries"][did]["deadline"] - shift


def dlabel(x):
    n = {"road_closure": "Road closure", "weather": "Severe weather",
         "customer_change": "Customer change"}.get(x["type"])
    if x["type"] == "vehicle_breakdown":
        n = f"{x['vehicle_id']} breakdown"
    return f"{n} #{x['id']}"


def leg_causes(w, a, b):
    """Disruptions whose area touches the road leg a->b (this is the dependency link)."""
    out = []
    for x in w["disruptions"]:
        if x["type"] in ("road_closure", "weather") and x["lat"] is not None:
            if seg_dist_m(a, b, (x["lat"], x["lng"])) <= x["radius_m"]:
                out.append({"disruption_id": x["id"], "type": x["type"],
                            "minutes": x["minutes"], "label": dlabel(x)})
    return out


# ---------------------------------------------------------------- evaluate
def _row(w, did, vid, i, n, eta, dl, causes, upstream, status):
    d = w["deliveries"][did]
    dl = eff_deadline(w, did) if dl is None else dl
    late = None if eta is None else eta - dl
    r = {"vehicle": vid, "seq": i, "eta": eta, "deadline": dl, "late_by": late,
         "status": status, "causes": causes, "upstream": upstream, "downstream": n - 1 - i}
    sc = (d["priority"] * 18 + (20 if d["perishable"] else 0)
          + (min(30, max(0, late)) if late is not None else 0)
          + (30 if status == "stranded" else 0) + r["downstream"] * 4
          - (10 if status == "risk" else 0))
    r["score"] = round(sc)
    r["urgency"] = "Critical" if sc >= 80 else "High" if sc >= 55 else "Medium"
    return r


def evaluate(w, plan):
    dep = pt(w["depot"])
    out, km = {}, 0.0
    for vid, route in plan.items():
        v = w["vehicles"][vid]
        if is_down(w, vid):
            for i, did in enumerate(route):
                out[did] = _row(w, did, vid, i, len(route), None, None, [], [], "stranded")
            continue
        t = float(v["start_delay"]) if route else 0.0
        prev, upstream = dep, []
        for i, did in enumerate(route):
            p = pt(w["deliveries"][did])
            causes = leg_causes(w, prev, p)
            extra = sum(c["minutes"] for c in causes)
            km += road_km(prev, p)
            t += travel_min(prev, p) + extra
            dl = eff_deadline(w, did)
            late = t - dl
            st = "late" if late > 0 else "risk" if late > -RISK_MARGIN else "ok"
            out[did] = _row(w, did, vid, i, len(route), t, dl, causes, list(upstream), st)
            if extra:
                upstream.append({"delivery_id": did, "minutes": extra})
            t += w["deliveries"][did]["service_min"]
            prev = p
    return {"deliveries": out, "km": km}


def kpis(w, plan, ev):
    c = {"ok": 0, "risk": 0, "late": 0, "stranded": 0}
    for r in ev["deliveries"].values():
        c[r["status"]] += 1
    c["vehicles_active"] = sum(1 for vid, rt in plan.items() if rt and not is_down(w, vid))
    c["vehicles_total"] = sum(1 for v in w["vehicles"].values() if v["role"] == "fleet")
    return c


def problems(w, plan, scope=None):
    ev = evaluate(w, plan)
    ids = [i for i, r in ev["deliveries"].items()
           if r["status"] in ("late", "stranded") and (scope is None or i in scope)]
    return sorted(ids, key=lambda i: -ev["deliveries"][i]["score"])


# ------------------------------------------------------------------ explain
def explain_stop(w, plan, ev, did):
    r, d = ev["deliveries"][did], w["deliveries"][did]
    v = w["vehicles"][r["vehicle"]]
    R = []
    if r["status"] == "stranded":
        R.append(f"{v['name']} has broken down, so no vehicle can reach this delivery. It must be reassigned.")
    else:
        for c in r["causes"]:
            ic = "🚧" if c["type"] == "road_closure" else "🌧️"
            R.append(f"{ic} {c['label']} lies on the road leg into this stop: +{round(c['minutes'])} min.")
        up = sum(u["minutes"] for u in r["upstream"])
        if up:
            names = ", ".join(w["deliveries"][u["delivery_id"]]["customer"] for u in r["upstream"])
            R.append(f"⛓️ Dependency: {v['name']} is already delayed {round(up)} min at {names}, "
                     f"and that delay carries forward to this stop.")
        if v["start_delay"] and v["role"] == "standby":
            R.append(f"🚐 {v['name']} is a standby vehicle that leaves the depot {v['start_delay']} min late.")
        sh = sum(x["minutes"] for x in w["disruptions"]
                 if x["type"] == "customer_change" and x["delivery_id"] == did)
        if sh:
            R.append(f"📝 The customer moved the deadline {round(sh)} min earlier, to {fmt(r['deadline'])}.")
        explained = sum(c["minutes"] for c in r["causes"]) + up + (v["start_delay"] if v["role"] == "standby" else 0)
        resid = r["eta"] - d["planned_eta"] - explained
        if resid > 2:
            R.append(f"🔀 Route changes (different stops or longer travel before it) add about {round(resid)} min.")
        if not R:
            R.append("No disruption currently touches this delivery.")
        verdict = f"{round(r['late_by'])} min late" if r["status"] == "late" else "within its deadline"
        R.append(f"Result: ETA {fmt(r['eta'])} against deadline {fmt(r['deadline'])} ({verdict}).")
    return {"type": "stop", "id": did, "title": f"{did}. {d['customer']}", "status": r["status"],
            "vehicle": r["vehicle"], "eta": None if r["eta"] is None else fmt(r["eta"]),
            "deadline": fmt(r["deadline"]), "planned": fmt(d["planned_eta"]),
            "reasons": R, "chain": _chain(w, plan, ev, did)}


def _chain(w, plan, ev, did):
    """Dependency chain: root disruption -> affected stops downstream of it."""
    r, route = ev["deliveries"][did], plan[ev["deliveries"][did]["vehicle"]]
    nodes = []

    def dnode(x):
        return {"kind": "disruption", "label": dlabel(x)}

    if r["status"] == "stranded":
        for x in w["disruptions"]:
            if x["type"] == "vehicle_breakdown" and x["vehicle_id"] == r["vehicle"]:
                nodes.append(dnode(x))
    else:
        for x in w["disruptions"]:
            if x["type"] == "customer_change" and x["delivery_id"] == did:
                nodes.append(dnode(x))
        src = [j for j in range(r["seq"] + 1) if ev["deliveries"][route[j]]["causes"]]
        if src:
            j0 = src[0]
            seen = set()
            for c in ev["deliveries"][route[j0]]["causes"]:
                if c["disruption_id"] not in seen:
                    seen.add(c["disruption_id"])
                    nodes.append(dnode(next(x for x in w["disruptions"] if x["id"] == c["disruption_id"])))
            for j in range(j0, r["seq"] + 1):
                nodes.append({"kind": "stop", "id": route[j], "status": ev["deliveries"][route[j]]["status"],
                              "label": w["deliveries"][route[j]]["customer"]})
            return nodes
    nodes.append({"kind": "stop", "id": did, "status": r["status"], "label": w["deliveries"][did]["customer"]})
    return nodes


def explain_vehicle(w, plan, ev, vid):
    v, route = w["vehicles"][vid], plan[vid]
    R = []
    if is_down(w, vid):
        R.append(f"{v['name']} has broken down. All {len(route)} of its stops need another vehicle.")
    else:
        for did in route:
            for c in ev["deliveries"][did]["causes"]:
                R.append(f"{c['label']} affects the leg into {w['deliveries'][did]['customer']}: +{round(c['minutes'])} min.")
        if v["start_delay"] and v["role"] == "standby" and route:
            R.append(f"Standby vehicle, leaves the depot {v['start_delay']} min late.")
        if not R:
            R.append("No disruption on this route.")
    return {"type": "vehicle", "id": vid, "title": f"Vehicle {v['name']}", "down": is_down(w, vid), "reasons": R,
            "stops": [{"id": i, "label": w["deliveries"][i]["customer"], "status": ev["deliveries"][i]["status"]}
                      for i in route]}


# -------------------------------------------------------------- recovery
def cost(w, plan, ev=None):
    ev = ev or evaluate(w, plan)
    c = ev["km"]
    for did, r in ev["deliveries"].items():
        d = w["deliveries"][did]
        wt = 1 + d["priority"] * 0.5 + (1 if d["perishable"] else 0)
        if r["status"] == "stranded":
            c += 4000 * wt
        elif r["status"] == "late":
            c += (500 + r["late_by"] * 8) * wt
        elif r["status"] == "risk":
            c += 40 * wt
    return c


def _copy(plan):
    return {k: list(v) for k, v in plan.items()}


def _where(plan, did):
    return next((vid for vid, rt in plan.items() if did in rt), None)


def move(plan, did, to, pos):
    p = _copy(plan)
    p[_where(plan, did)].remove(did)
    p[to].insert(pos, did)
    return p


def _targets(w, plan):
    return [vid for vid, v in w["vehicles"].items()
            if not is_down(w, vid) and (v["role"] == "fleet" or plan[vid])]


def reassign(w, plan, ids, moves):
    for did in ids:
        cur = _where(plan, did)
        if cur is None:
            continue
        best, bc, bt = None, cost(w, plan), None
        for vid in _targets(w, plan):
            if vid != cur and len(plan[vid]) >= w["vehicles"][vid]["capacity"]:
                continue
            for pos in range(len(plan[vid]) + 1):
                t = move(plan, did, vid, pos)
                c = cost(w, t)
                if c < bc - 1e-6:
                    best, bc, bt = t, c, vid
        if best:
            nm = w["deliveries"][did]["customer"]
            moves.append(f"{nm} earlier on {bt}" if bt == cur else f"{nm} → {bt}")
            plan = best
    return plan


def seq_all(w, plan):
    for vid, route in list(plan.items()):
        if is_down(w, vid) or len(route) < 2:
            continue
        t = _copy(plan)
        t[vid] = sorted(route, key=lambda i: eff_deadline(w, i))
        if t[vid] != route and cost(w, t) < cost(w, plan):
            plan = t
    return plan


def add_backup(w, plan, ids):
    free = [vid for vid, v in w["vehicles"].items()
            if v["role"] == "standby" and not plan[vid] and not is_down(w, vid)]
    if not free or not ids:
        return None
    vid, p = free[0], _copy(plan)
    for did in sorted(ids, key=lambda i: eff_deadline(w, i))[:w["vehicles"][vid]["capacity"]]:
        p = move(p, did, vid, len(p[vid]))
    return p, vid


def full_plan(w, plan, ids):
    p = seq_all(w, reassign(w, plan, ids, []))
    for _ in range(2):
        rem = problems(w, p, set(ids))
        r = add_backup(w, p, rem)
        if not r:
            break
        p = seq_all(w, reassign(w, r[0], ids, []))
    return p


def summarize(w, plan, new, scope):
    a, b = evaluate(w, plan), evaluate(w, new)
    cnt = lambda ev, s: sum(1 for r in ev["deliveries"].values() if r["status"] == s)
    bad = lambda ev, ids: sum(1 for i in ids if ev["deliveries"][i]["status"] in ("late", "stranded"))
    m = {"late_before": cnt(a, "late"), "late_after": cnt(b, "late"),
         "stranded_before": cnt(a, "stranded"), "stranded_after": cnt(b, "stranded"),
         "km_delta": round(b["km"] - a["km"], 1)}
    m["left"] = m["late_after"] + m["stranded_after"]
    if scope is not None:
        m["scope_before"], m["scope_after"] = bad(a, scope), bad(b, scope)
        if len(scope) == 1 and scope[0] in b["deliveries"]:
            r = b["deliveries"][scope[0]]
            m["one"] = {"status": r["status"], "eta": None if r["eta"] is None else fmt(r["eta"])}
    return m


def options(w, plan, scope=None):
    """Ranked recovery options. scope=None -> all problems; scope=[ids] -> just those deliveries."""
    ids, gl, out = problems(w, plan, set(scope) if scope is not None else None), problems(w, plan), []
    if not gl and not ids:
        return out

    def add(key, title, desc, new, **kw):
        out.append({"key": key, "title": title, "desc": desc, "assignment": new,
                    "m": summarize(w, plan, new, scope), "cost": cost(w, new), **kw})

    if ids:
        mv = []
        p = reassign(w, plan, ids, mv)
        if mv:
            add("reassign", "Reassign to better positions", "Move " + ", ".join(mv) + ".", p)
        sq = seq_all(w, plan)
        if sq != plan:
            add("resequence", "Re-sequence stops by deadline",
                "Visit the most time-critical deliveries first on each route.", sq)
        r = add_backup(w, plan, ids)
        if r:
            n = len(r[0][r[1]])
            add("backup", f"Dispatch standby vehicle ({r[1]})",
                f"Send {r[1]} from the depot (ready in {w['vehicles'][r[1]]['start_delay']} min) "
                f"to take {n} deliver{'y' if n == 1 else 'ies'}.", r[0])
        fp = full_plan(w, plan, ids)
        if fp != plan:
            add("full", "Full recovery plan",
                "Combines reassignment, re-sequencing and standby vehicles where needed, then notifies "
                "customers about anything still late.", fp, notify=True, full=True)
    if scope is not None and gl and (not ids or set(gl) - set(scope)):
        add("all", "Fix ALL problems (full recovery plan)",
            f"Handles all {len(gl)} late or unserved deliveries together, then notifies customers "
            f"about anything still late.", full_plan(w, plan, gl), notify=True, full=True, all=True)
    add("notify", "Keep plan & notify customers",
        "No route change. Tell affected customers their new arrival time.", _copy(plan), notify=True, keep=True)
    base, best = cost(w, plan), None
    for o in out:
        if o.get("keep") or o.get("all"):
            continue
        if o["cost"] < base and (best is None or o["cost"] < best["cost"]):
            best = o
    (best or out[-1])["recommended"] = True
    return out


def messages(w, plan, ev):
    out = []
    for did, r in ev["deliveries"].items():
        if r["status"] == "ok":
            continue
        d = w["deliveries"][did]
        if r["status"] == "stranded":
            tx = (f"Hello {d['customer']}, your delivery is being reassigned to another vehicle after a "
                  f"transport issue. We will confirm the new arrival time shortly. Sorry for the inconvenience.")
        elif r["status"] == "late":
            tx = (f"Hello {d['customer']}, due to a transport disruption your delivery is now expected around "
                  f"{fmt(r['eta'])} (originally {fmt(d['planned_eta'])}). We apologise for the delay.")
        else:
            tx = (f"Hello {d['customer']}, your delivery may arrive slightly later than planned "
                  f"(about {fmt(r['eta'])}). We will keep you updated.")
        out.append({"delivery_id": did, "customer": d["customer"], "status": r["status"], "text": tx})
    return out
