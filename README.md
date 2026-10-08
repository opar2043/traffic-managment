# Factory Traffic Management System (Backend)

Backend service for a factory junction traffic control system. It manages signal phases (NS_GREEN → NS_YELLOW → ALL_RED → EW_GREEN → EW_YELLOW), vehicle queues, sensor events, controller acknowledgements, manual override, and emergency preemption — with safety rules enforced centrally and all junction operations serialized per junction.

## Tech Stack
- Node.js + Express.js + TypeScript
- Prisma ORM + PostgreSQL
- Vitest for domain tests
- Simple logger (console)

## Brief Overview

The system controls traffic junctions in a factory using a phase-based state machine:

- **Junctions** are created with a config (phases, timings, conflicts) and run in `AUTOMATIC`, `MANUAL`, or `EMERGENCY` mode.
- **Sensor events** (`VEHICLE_ARRIVED` / `VEHICLE_CLEARED`) feed a per-direction vehicle queue. The scheduler picks the next phase considering priority weights (EMERGENCY > TRUCK > FORKLIFT > EMPLOYEE_VEHICLE), min-green, hysteresis, and starvation limits.
- **Emergency vehicles** immediately preempt: the junction moves through a safe sequence to give green to the emergency direction, and clears when the vehicle departs (or after `EMERGENCY_STALE_MS`).
- **Manual override** lets an operator request green for a direction (`MANUAL_GREEN_REQUEST`) with a TTL, or return to automatic (`RETURN_TO_AUTOMATIC`); both are rejected during EMERGENCY/DEGRADED states.
- **Controller simulator**: desired signal states are sent as commands to a simulated REST controller, which ACKs/NACKs/FAILs; timeouts and retries are handled, and repeated failures drive the junction to `DEGRADED` (all-red safe state).
- **Safety**: conflicting greens are never allowed; every transition passes through YELLOW then ALL_RED. Restart recovery abandons pending commands and resets to a safe state.
- **Concurrency**: per-junction mutex (`runExclusive`) plus optimistic locking via a `version` column.

### Architecture
- Domain (pure TS): `src/domain/` — state machine, safety, scheduler. No DB/HTTP.
- Ports/adapters: interfaces + REST controller simulator.
- Services: `junctionRunner` (serialized per-junction with mutex + optimistic concurrency), `ticker` (1s loop).
- Modules: routes/controllers/services split by feature (`src/modules/*`).
- Safety rules enforced centrally in `safety.ts` and the engine.

## Setup
1. Install dependencies: `npm install`
2. Set environment variables in `.env`:
   - `DATABASE_URL=postgresql://macbookair@localhost:5432/traffic_mgmt?schema=public`
   - `DIRECT_URL=postgresql://macbookair@localhost:5432/traffic_mgmt?schema=public`
   - `PORT=3000` (optional), `NODE_ENV=development`
3. Generate client & run migrations: `npx prisma generate && npx prisma migrate dev`
4. Seed (creates junctions `A` and `B` with demo data): `npx prisma db seed`
5. Run dev: `npm run dev`
6. Run tests: `npm test`
7. Build: `npm run build && npm start`

## Deployment (Render)
`render.yaml` is included. Use either a Blueprint or set manually:
- **Build Command:** `npm install && npx prisma generate && npm run build`
- **Start Command:** `npx prisma migrate deploy && npm start`
- **Env vars:** `DATABASE_URL`, `DIRECT_URL`, `NODE_ENV=production` (`PORT` is injected by Render)
- **Health check path:** `/api/health`

---

## API Endpoints

Base URL: `http://localhost:3000/api` (local) — all responses are JSON of the form `{ success, data?, message? }`.

### Health

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check (used by Render). Returns `{ success: true, data: { status: "ok" } }`. |

### Junctions

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/junctions` | List all junctions. |
| GET | `/api/junctions/:id` | Get one junction (404 if not found). |
| POST | `/api/junctions` | Create a junction. **201** |

**POST `/api/junctions`** body:
```json
{
  "id": "C",
  "name": "Junction C",
  "config": { "timings": { "GREEN_MS": 30000, "YELLOW_MS": 5000, "ALL_RED_MS": 2000 } }
}
```
`id` is required; `config` is normalized with defaults if omitted. Junction starts in `AUTOMATIC` / `ALL_RED`.

### Status

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/junctions/:id/status` | Current status snapshot for polling. **404** if unknown. |

Returns: `mode`, `phase`, `desiredSignals`, `actualSignals`, `controllerStatus`, `phaseStartedAt`, `phaseEndsAt`, `nextPhaseTarget`, `manual { active, until, direction }`, `emergency { active, direction, since }`, `pendingCommand`, `alerts[]` (e.g. `Controller OFFLINE`, `STATE_MISMATCH`), `transitionStep`.

### Commands (manual control)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/junctions/:id/commands` | Send a control command. **202** accepted, **400** unknown/invalid, **409** rejected. |

Body:
```json
{ "command": "MANUAL_GREEN_REQUEST", "direction": "NORTH" }
```
```json
{ "command": "RETURN_TO_AUTOMATIC" }
```
- `MANUAL_GREEN_REQUEST`: `direction` required (`NORTH|SOUTH|EAST|WEST`). Rejected (409) while in EMERGENCY or DEGRADED.
- `RETURN_TO_AUTOMATIC`: exits manual mode. Rejected (409) while in EMERGENCY/DEGRADED.

### Sensor Events

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/sensor-events` | Ingest a vehicle event. **201** applied, **200** duplicate, **409** rejected, **400** invalid, **404** unknown junction. |

Body:
```json
{
  "event_id": "EVT-100",
  "junction_id": "A",
  "direction": "NORTH",
  "event_type": "VEHICLE_ARRIVED",
  "vehicle_id": "A-VEH-007",
  "vehicle_type": "TRUCK",
  "sequence_no": 3,
  "timestamp": "2026-10-08T07:00:00.000Z"
}
```
- `event_type`: `VEHICLE_ARRIVED` | `VEHICLE_CLEARED`
- `vehicle_type` (required for ARRIVED): `EMERGENCY` | `TRUCK` | `FORKLIFT` | `EMPLOYEE_VEHICLE`
- `sequence_no`: integer; only moves the per-direction sequence forward
- Outcomes:
  - `201 { status: "APPLIED" }` — vehicle enqueued (ARRIVED) or marked CLEARED
  - `200 { status: "DUPLICATE" }` — `event_id` already processed (idempotent)
  - `409 REJECTED_DUPLICATE_VEHICLE` — same vehicle already WAITING in that direction
  - `409 CLEARED_WITHOUT_ARRIVAL` — CLEARED with no matching waiting vehicle
- `EMERGENCY` ARRIVED triggers preemption; its CLEARED releases the emergency.

### Controller Events (acks from signal controller)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/controller-events` | Report command acknowledgement. **200**, **400** invalid, **404** unknown command. |

Body:
```json
{ "command_id": "A-CMD-003", "junction_id": "A", "status": "ACK", "actual_state": "GREEN" }
```
- `status`: `ACK` | `NACK` | `FAILED`
- Duplicate acks return `200 { duplicate: true }`.

### Device Status

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/device-status` | Report device health. **200**, **400** invalid. |

Body:
```json
{ "junction_id": "A", "device": "SIGNAL_CONTROLLER", "status": "OFFLINE" }
```
- `device`: `SIGNAL_CONTROLLER` | `SENSOR`
- `status`: `ONLINE` | `OFFLINE` | `DEGRADED`
- `SIGNAL_CONTROLLER` OFFLINE/DEGRADED → junction mode becomes `DEGRADED` (all-red safe state) and an audit log is written.

### Controller

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/controller` | Simulator/controller service probe. |

### History & Queues

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/junctions/:id/history` | Audit log, newest first. Query: `limit` (default 100, max 500), `eventType` (filter). |
| GET | `/api/junctions/:id/queues` | Vehicles for the junction ordered by `arrivedAt`. |

### Simulation

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/simulation` | Placeholder. Use `npm run simulate` to run concurrent-event simulation. |

---

## State Transition Table (key)
Phases: `NS_GREEN`, `NS_YELLOW`, `ALL_RED`, `EW_GREEN`, `EW_YELLOW`.
Transitions: GREEN → YELLOW (5s) → ALL_RED (2s) → other GREEN (enforced). Requests never skip this.

## Concurrency Strategy
- Per-junction mutex via `runExclusive` in `junctionRunner.ts` (Map of promises). All junction operations serialized.
- Optimistic concurrency using `version` column (update where id+version, increment).
- Works for single instance; multi-instance would need SELECT FOR UPDATE/DB locks.

## Restart Recovery
On boot: abandon PENDING commands (mark `ABANDONED_ON_RESTART`), set `actualSignals` to UNKNOWN, move to DEGRADED/AUTOMATIC safe state (ALL_RED), log `RESTART_RECOVERY`.

## Polling vs SSE
Polling every 2s is simple, reliable, easy to test (used here). SSE is lower latency but adds connection management; chosen for simplicity.

## Demo Scenarios (curl examples)
1. **Normal traffic:** `POST /api/sensor-events` (ARRIVED) for vehicles; poll `/api/junctions/A/status`.
2. **Priority traffic:** TRUCK/weights considered; hysteresis/min-green/starvation apply.
3. **Emergency preemption:** ARRIVED with `vehicle_type: "EMERGENCY"` → moves to safe sequence.
4. **Manual override:** `POST /api/junctions/A/commands` with `MANUAL_GREEN_REQUEST` (rejected if EMERGENCY/DEGRADED).
5. **Duplicate event:** same `event_id` → `200 DUPLICATE`.
6. **Vehicle clearance:** `VEHICLE_CLEARED` → vehicle moved to CLEARED.
7. **Controller failure:** `device-status`/controller timeout → DEGRADED.
8. **Restart:** server restart → recovery to safe state.
9. **Concurrent events:** run `npm run simulate`.

```bash
# Health
curl http://localhost:3000/api/health

# Vehicle arrives (north, truck)
curl -X POST http://localhost:3000/api/sensor-events \
  -H 'Content-Type: application/json' \
  -d '{"event_id":"EVT-1","junction_id":"A","direction":"NORTH","event_type":"VEHICLE_ARRIVED","vehicle_id":"A-VEH-010","vehicle_type":"TRUCK","sequence_no":10}'

# Poll status
curl http://localhost:3000/api/junctions/A/status

# Manual green
curl -X POST http://localhost:3000/api/junctions/A/commands \
  -H 'Content-Type: application/json' \
  -d '{"command":"MANUAL_GREEN_REQUEST","direction":"NORTH"}'

# Queues
curl http://localhost:3000/api/junctions/A/queues
```

## Assumptions / Questions / Requirement Issues
- Enforced conservative safety: any GREEN in NS and any GREEN in EW is conflicting (safe).
- Emergency overrides manual; manual cannot resume automatically; returns rejected in EMERGENCY/DEGRADED.
- Emergency stale timeout auto-clears (`EMERGENCY_STALE_MS`).
- Queue never negative; CLEARED without ARRIVAL → 409; duplicate vehicle while WAITING → rejected.
- `sequence_no` ordering: only move `lastSequenceNo` forward; out-of-order events still processed if logically valid.
- Clock skew handled conservatively with `receivedAt`; sensor timestamp used for wait time.
- `EMERGENCY` vehicle type is in the priority list (weight 100) even though the sensor spec lists 4 types.

## Major Architectural Decisions
- Pure domain (no side effects) for testability.
- Single mutex per junction + version for simplicity.
- REST controller simulator (no MQTT).
- All side effects in `junctionRunner` inside a transaction.

## AI / Tool Usage
- Built iteratively using tools; kept code simple and readable.

## Not implemented / next steps
- MQTT controller
- SSE for status
- Auth
- Multi-instance locking (DB row locks)
- Event replay
- More comprehensive domain tests (starvation, hysteresis, min-green)
