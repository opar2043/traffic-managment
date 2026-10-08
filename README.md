# Factory Traffic Management System (Backend)

A simple, readable backend-only implementation of a factory junction traffic control system.

## Tech Stack
- Node.js + Express.js + TypeScript
- Prisma ORM + PostgreSQL
- Vitest for domain tests
- Simple logger (console)

## Setup
1. Install dependencies: `npm install`
2. Set environment variables in `.env`:
   - `DATABASE_URL=postgresql://macbookair@localhost:5432/traffic_mgmt?schema=public`
   - `DIRECT_URL=postgresql://macbookair@localhost:5432/traffic_mgmt?schema=public`
3. Generate client & run migrations: `npx prisma generate && npx prisma migrate dev`
4. Seed: `npx prisma db seed`
5. Run dev: `npm run dev`
6. Run tests: `npm test`
7. Build: `npm run build && npm start`

## Architecture
- Domain (pure TS): `src/domain/` - state machine, safety, scheduler. No DB/HTTP.
- Ports/adapters: interfaces + REST controller simulator.
- Services: `junctionRunner` (serialized per-junction with mutex + optimistic concurrency), `ticker` (1s).
- Modules: routes/controllers/services split by feature.
- Safety rules enforced centrally in `safety.ts` and engine.

## State Transition Table (key)
Phases: NS_GREEN, NS_YELLOW, ALL_RED, EW_GREEN, EW_YELLOW.
Transitions: GREEN -> YELLOW (5s) -> ALL_RED (2s) -> other GREEN (enforced). Requests never skip this.

## Concurrency Strategy
- Per-junction mutex via `runExclusive` in `junctionRunner.ts` (Map of promises). All junction operations serialized.
- Optimistic concurrency using `version` column (update where id+version, increment).
- Works for single instance; multi-instance would need SELECT FOR UPDATE/DB locks.

## Restart Recovery
On boot: abandon PENDING commands (mark ABANDONED_ON_RESTART), set actualSignals to UNKNOWN, move to DEGRADED/AUTOMATIC safe state (ALL_RED), log RESTART_RECOVERY.

## Polling vs SSE
Polling every 2s is simple, reliable, easy to test (used here). SSE is lower latency but adds connection mgmt; chosen for simplicity.

## API Endpoints (summary)
- GET /api/health
- GET/POST /api/junctions
- GET /api/junctions/:id/status
- POST /api/junctions/:id/commands {command, direction?}
- POST /api/sensor-events
- POST /api/controller-events
- POST /api/device-status
- GET /api/junctions/:id/history
- GET /api/junctions/:id/queues

## Demo Scenarios (curl examples)
1. Normal traffic: POST sensor-events (ARRIVED) for vehicles; status polls.
2. Priority traffic: TRUCK/weights considered; hysteresis/min-green/starvation apply.
3. Emergency preemption: ARRIVED with vehicle_type EMERGENCY -> moves to safe sequence.
4. Manual override: POST /commands with MANUAL_GREEN_REQUEST (rejected if EMERGENCY/DEGRADED).
5. Duplicate event: same event_id -> 200 DUPLICATE.
6. Vehicle clearance: VEHICLE_CLEARED -> moves vehicle to CLEARED.
7. Controller failure: device-status/controller timeout -> DEGRADED.
8. Restart: server restart -> recovery to safe state.
9. Concurrent events: run `npm run simulate`.

## Assumptions / Questions / Requirement Issues
- Enforced conservative safety: any GREEN in NS and any GREEN in EW is conflicting (safe). 
- Emergency overrides manual; manual cannot resume automatically; return rejected in EMERGENCY/DEGRADED.
- Emergency stale timeout auto-clears (EMERGENCY_STALE_MS). 
- Queue never negative; CLEARED without ARRIVAL -> 409. Duplicate vehicle while WAITING -> rejected.
- sequence_no ordering: only move lastSequenceNo forward; out of order events still processed if logically valid (per rules).
- Clock skew handled conservatively with receivedAt checks conceptually; sensor timestamp used for wait time.
- "EMERGENCY vehicle type is in priority list" (weight 100) but sensor spec lists 4 types - included as EMERGENCY in types/weights.

## Major Architectural Decisions
- Pure domain (no side effects) for testability.
- Single mutex per junction + version for simplicity.
- REST controller simulator (no MQTT). 
- All side effects in junctionRunner inside transaction.

## AI / Tool Usage
- Built iteratively using tools; kept code simple and readable.

## Not implemented / next steps
- MQTT controller
- SSE for status
- Auth
- Multi-instance locking (DB row locks)
- Event replay
- More comprehensive domain tests (starvation, hysteresis, min-green)

