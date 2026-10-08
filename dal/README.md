# Disruption-Aware Logistics Planner (HackNext'26 PS02)

A working prototype that helps logistics operators answer three questions when a plan breaks:

**What changed? → What is affected? → What should we do next?**

Zero dependencies for the backend: Python 3.9+ (standard library only). The map uses Leaflet + OpenStreetMap from a CDN, so the browser needs internet for map tiles.

## Run it
```bash
python backend/app.py          # then open http://localhost:8000
python tests/test_engine.py    # 9 tests: engine, persistence, API
```
Optional: `PORT=9000 python backend/app.py`. State lives in `data/logistics.db` (SQLite). Use **Reset demo data** in the UI to restore the sample plan.

## Demo script (60 seconds)
1. Left panel: choose **Road closure**, pick vehicle V2, click **Report disruption** (or click the map to place it yourself).
2. The most urgent delivery is selected. See the **dependency chain** (closure → stop → stop) and **why** it is affected.
3. Right panel: read the options, each with before/after numbers. Click **Apply this action** on the one marked *Recommended*.
4. Report a **Vehicle breakdown** on V3, then use **Fix ALL problems**: standby vehicles V5/V6 are dispatched.
5. Copy a ready-made **customer message**. Press **Resolve** on a disruption to undo it.

## How it works
| Layer | File | What it does |
|---|---|---|
| Data | `backend/db.py`, `backend/seed.json` | SQLite tables: vehicles, deliveries, live plan, disruptions, log |
| Logic | `backend/engine.py` | ETA model, geographic impact analysis, dependency chains, urgency score, recovery options |
| API | `backend/app.py` | JSON REST API + static file server |
| UI | `frontend/index.html` | Leaflet map, KPI tiles, vehicle timeline, affected list, explanations, fixes, messages |

**Impact analysis.** Each road leg (previous stop → stop) is checked against each disruption's area (point-to-segment distance). A hit adds delay to that leg; the delay then carries to every later stop on the same route (the dependency). A breakdown strands all stops of that vehicle. A customer change moves a deadline earlier.

**Urgency score** = priority×18 + perishable 20 + minutes late (max 30) + 30 if no vehicle + 4 per blocked later stop. Critical ≥ 80, High ≥ 55.

**Recovery options** (all computed by cost search, shown with before/after metrics): reassign stops (cheapest insertion), re-sequence by deadline, dispatch a standby vehicle, a **full recovery plan** (all combined, then notify), and notify-only. Costs weight late/unserved stops by priority and perishability, plus extra km. Applying an action is validated server-side (every delivery assigned once, capacity respected, no new stops on a broken vehicle).

## API
| Method & path | Purpose |
|---|---|
| `GET /api/state` | Everything the dashboard needs: vehicles, deliveries with ETA/status/score, disruptions, KPIs, log, messages |
| `GET /api/explain?type=stop\|vehicle&id=` | Why it is affected + dependency chain |
| `GET /api/recommendations[?scope=stop:4\|vehicle:V2]` | Ranked fixes with before/after metrics |
| `POST /api/disruptions` | `road_closure`/`weather` {lat,lng,radius_m,minutes}, `vehicle_breakdown` {vehicle_id}, `customer_change` {delivery_id,minutes} |
| `DELETE /api/disruptions/<id>` | Resolve a disruption |
| `POST /api/actions/apply` | Apply a recommended assignment {assignment, notify, title} |
| `POST /api/reset` | Restore sample data |

## Make it your own
- Edit `backend/seed.json` (depot, vehicles, deliveries, coordinates), delete `data/logistics.db`, restart.
- Travel time uses straight-line distance × 1.35 at 28 km/h (`engine.py` constants). To use real road times, replace `travel_min()` with an OSRM/OpenRouteService call.
- Stronger optimisation: swap `reassign()` for Google OR-Tools while keeping the same plan format.
- Production next steps: live traffic and weather feeds, driver mobile app, WebSocket push, authentication, multi-depot support.

## Known limits (honest list)
- Sample data and the speed model are simulated; no live traffic/weather feed.
- Plan time advances by a fixed step per event, not real time; vehicles do not move.
- Recovery search is greedy (fast and explainable), not guaranteed optimal.
