import { prisma } from '../lib/prisma';
import { JunctionState, SignalMap, Direction, Phase, Mode, ControllerStatus, SensorStatus, CommandStatus, AuditEvent, ControllerCommandState, QueueVehicleState } from '../domain/types';
import { handleTick, requestManualGreen, returnToAutomatic, onEmergency, clearEmergency, onAck } from '../domain/trafficEngine';
import { normalizeConfig } from '../domain/junctionConfig';
import { logger } from '../lib/logger';
import { constants } from '../config/constants';
import { RestControllerSimulator } from '../adapters/restControllerSimulator';

const mutexMap = new Map<string, Promise<any>>();

function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = mutexMap.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => fn());
  mutexMap.set(key, next.catch(() => {}));
  return next;
}

function mapJunctionToState(j: any): JunctionState {
  return {
    id: j.id,
    name: j.name,
    config: normalizeConfig(j.config),
    mode: j.mode as Mode,
    phase: j.phase as Phase,
    desiredSignals: j.desiredSignals as SignalMap,
    actualSignals: j.actualSignals as SignalMap,
    controllerStatus: j.controllerStatus as ControllerStatus,
    phaseStartedAt: new Date(j.phaseStartedAt),
    phaseEndsAt: j.phaseEndsAt ? new Date(j.phaseEndsAt) : null,
    nextPhaseTarget: j.nextPhaseTarget as Phase | null,
    manualUntil: j.manualUntil ? new Date(j.manualUntil) : null,
    manualDirection: j.manualDirection as Direction | null,
    emergencyDirection: j.emergencyDirection as Direction | null,
    emergencySince: j.emergencySince ? new Date(j.emergencySince) : null,
    version: j.version,
    lastTickAt: new Date(j.lastTickAt),
  };
}

function queueInfoFromVehicles(vehicles: QueueVehicleState[], now: Date) {
  const dirs: Direction[] = ['NORTH', 'SOUTH', 'EAST', 'WEST'];
  return dirs.map((d) => {
    const waiting = vehicles.filter((v) => v.direction === d && v.status === 'WAITING');
    let weightSum = 0;
    let oldest = 0;
    for (const w of waiting) {
      const wt: any = { EMERGENCY: 100, TRUCK: 3, FORKLIFT: 2, EMPLOYEE_VEHICLE: 1 };
      weightSum += wt[w.vehicleType] || 1;
      const wait = now.getTime() - new Date(w.arrivedAt).getTime();
      if (wait > oldest) oldest = wait;
    }
    return { direction: d, size: waiting.length, weightSum, oldestWaitMs: oldest };
  });
}

const simulator = new RestControllerSimulator();

export class JunctionRunner {
  tick(junctionId: string) {
    return runExclusive(junctionId, async () => {
      const now = new Date();
      const j = await prisma.junction.findUnique({ where: { id: junctionId } });
      if (!j) return null;
      const state = mapJunctionToState(j);
      const vehicles = await prisma.queueVehicle.findMany({ where: { junctionId } });
      const queues = queueInfoFromVehicles(vehicles as any, now);
      const res = handleTick({ state, now, queues, waitingVehicles: vehicles as any });
      await this.persistAndSend(res, junctionId, state.version);
      return res.state;
    });
  }

  manualGreen(junctionId: string, direction: Direction) {
    return runExclusive(junctionId, async () => {
      const now = new Date();
      const j = await prisma.junction.findUnique({ where: { id: junctionId } });
      if (!j) return { state: null, rejected: false };
      const state = mapJunctionToState(j);
      const res = requestManualGreen({ state, now, direction });
      if (j && (j.mode === 'EMERGENCY' || j.mode === 'DEGRADED')) {
        return { state: null, rejected: true };
      }
      await this.persistAndSend(res, junctionId, state.version);
      return { state: res.state, rejected: false };
    });
  }

  returnToAuto(junctionId: string) {
    return runExclusive(junctionId, async () => {
      const now = new Date();
      const j = await prisma.junction.findUnique({ where: { id: junctionId } });
      if (!j) return { state: null, rejected: true };
      const state = mapJunctionToState(j);
      const res = returnToAutomatic({ state, now });
      if (j && (j.mode === 'EMERGENCY' || j.mode === 'DEGRADED')) {
        return { state: null, rejected: true };
      }
      await this.persistAndSend(res, junctionId, state.version);
      return { state: res.state, rejected: false };
    });
  }

  emergencyActive(junctionId: string, direction: Direction, vehicleId: string) {
    return runExclusive(junctionId, async () => {
      const now = new Date();
      const j = await prisma.junction.findUnique({ where: { id: junctionId } });
      if (!j) return null;
      const state = mapJunctionToState(j);
      const res = onEmergency({ state, now, direction, vehicleId, active: true });
      await this.persistAndSend(res, junctionId, state.version);
      return res.state;
    });
  }

  emergencyClear(junctionId: string, direction: Direction, vehicleId: string) {
    return runExclusive(junctionId, async () => {
      const now = new Date();
      const j = await prisma.junction.findUnique({ where: { id: junctionId } });
      if (!j) return null;
      const state = mapJunctionToState(j);
      const res = clearEmergency({ state, now, direction, vehicleId, active: false });
      await this.persistAndSend(res, junctionId, state.version);
      return res.state;
    });
  }

  async persistAndSend(res: { state: JunctionState; commands: ControllerCommandState[]; audits: AuditEvent[] }, junctionId: string, version: number) {
    await prisma.$transaction(async (tx) => {
      // update junction with optimistic concurrency
      try {
        await tx.junction.update({
          where: { id: junctionId, version },
          data: {
            mode: res.state.mode,
            phase: res.state.phase,
            desiredSignals: res.state.desiredSignals as any,
            actualSignals: res.state.actualSignals as any,
            phaseStartedAt: res.state.phaseStartedAt,
            phaseEndsAt: res.state.phaseEndsAt,
            nextPhaseTarget: res.state.nextPhaseTarget,
            manualUntil: res.state.manualUntil,
            manualDirection: res.state.manualDirection,
            emergencyDirection: res.state.emergencyDirection,
            emergencySince: res.state.emergencySince,
            version: version + 1,
            lastTickAt: res.state.lastTickAt,
          },
        });
      } catch (e) {
        // optimistic lock failed; ignore in simple impl
      }
      // create commands
      for (const c of res.commands) {
        await tx.controllerCommand.upsert({
          where: { id: c.id },
          update: { status: c.status as any, attempts: c.attempts, sentAt: c.sentAt },
          create: {
            id: c.id,
            junctionId,
            direction: c.direction,
            requestedState: c.requestedState,
            status: c.status as any,
            attempts: c.attempts,
            sentAt: c.sentAt,
          },
        });
        await simulator.sendCommand(c);
      }
      // create audits
      for (const a of res.audits) {
        await tx.auditLog.create({
          data: {
            junctionId,
            eventType: a.eventType,
            direction: a.direction,
            previousState: a.previousState as any,
            newState: a.newState as any,
            commandId: a.commandId,
            reason: a.reason,
            details: a.details as any,
          },
        });
      }
    });
  }

  async handleAck(commandId: string, status: 'ACK' | 'NACK' | 'FAILED', actualState?: string) {
    return runExclusive(commandId, async () => {
      const cmd = await prisma.controllerCommand.findUnique({ where: { id: commandId } });
      if (!cmd) return { ok: false, reason: 'UNKNOWN_COMMAND' };
      const j = await prisma.junction.findUnique({ where: { id: cmd.junctionId } });
      if (!j) return { ok: false };
      if (cmd.status === 'ACKED' && status === 'ACK') {
        await prisma.auditLog.create({ data: { junctionId: j.id, eventType: 'CONTROLLER_ACK', commandId, reason: 'Duplicate ACK ignored', details: { status } } });
        return { ok: true, duplicate: true };
      }
      await prisma.$transaction(async (tx) => {
        await tx.controllerCommand.update({
          where: { id: commandId },
          data: { status: (status === 'ACK' ? 'ACKED' : status === 'NACK' ? 'FAILED' : 'FAILED') as any, ackedAt: status === 'ACK' ? new Date() : cmd.ackedAt, actualState: (actualState as any) || cmd.actualState },
        });
        await tx.auditLog.create({ data: { junctionId: j.id, eventType: status === 'ACK' ? 'CONTROLLER_ACK' : (status === 'NACK' ? 'CONTROLLER_NACK' : 'CONTROLLER_FAILED'), commandId, reason: status } });
      });
      return { ok: true };
    });
  }

  async handleTimeouts() {
    const now = new Date();
    const pending = await prisma.controllerCommand.findMany({ where: { status: 'PENDING' } });
    for (const c of pending) {
      const age = now.getTime() - new Date(c.sentAt).getTime();
      if (age > constants.ACK_TIMEOUT_MS) {
        const attempts = c.attempts + 1;
        if (attempts <= constants.MAX_RETRIES) {
          // retry
          await prisma.controllerCommand.update({ where: { id: c.id }, data: { attempts, sentAt: now } });
          await prisma.auditLog.create({ data: { junctionId: c.junctionId, eventType: 'CONTROLLER_TIMEOUT', commandId: c.id, reason: `Retry attempt ${attempts}` } });
          // send again
          await simulator.sendCommand({ ...c, attempts, sentAt: now } as any);
        } else {
          // timeout
          await prisma.$transaction(async (tx) => {
            await tx.controllerCommand.update({ where: { id: c.id }, data: { status: 'TIMED_OUT' } });
            await tx.junction.updateMany({ where: { id: c.junctionId, controllerStatus: { not: 'DEGRADED' } }, data: { controllerStatus: 'DEGRADED', mode: 'DEGRADED' } });
            await tx.auditLog.create({ data: { junctionId: c.junctionId, eventType: 'CONTROLLER_TIMEOUT', commandId: c.id, reason: 'Command TIMED_OUT' } });
          });
        }
      }
    }
  }
}

export const junctionRunner = new JunctionRunner();
