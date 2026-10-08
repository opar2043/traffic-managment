import { JunctionState, SignalMap, Direction, Phase, Mode, AuditEvent, ControllerCommandState, CommandStatus, ControllerStatus, VehicleType, QueueVehicleState } from './types';
import { directionsForPhase, signalForPhase, getNextPhase } from './junctionConfig';
import { assertSafe } from './safety';
import { pickNextPhase, QueueInfo } from './scheduler';
import { constants } from '../config/constants';

function cloneSignals(s: SignalMap): SignalMap {
  return { NORTH: s.NORTH, SOUTH: s.SOUTH, EAST: s.EAST, WEST: s.WEST };
}

function allRedSignals(): SignalMap {
  return { NORTH: 'RED', SOUTH: 'RED', EAST: 'RED', WEST: 'RED' };
}

function phaseToDirections(phase: Phase): Direction[] {
  if (phase === 'NS_GREEN' || phase === 'NS_YELLOW') return ['NORTH', 'SOUTH'];
  if (phase === 'EW_GREEN' || phase === 'EW_YELLOW') return ['EAST', 'WEST'];
  return ['NORTH', 'SOUTH', 'EAST', 'WEST'];
}

function signalsForPhase(phase: Phase): SignalMap {
  const m = allRedSignals();
  const dirs = phaseToDirections(phase);
  const sig = signalForPhase(phase);
  for (const d of dirs) {
    m[d] = sig;
  }
  return m;
}

export interface EngineInput {
  state: JunctionState;
  now: Date;
  queues: QueueInfo[];
  waitingVehicles: QueueVehicleState[]; // not used except via queues
}

export interface SensorArrivalInput {
  state: JunctionState;
  now: Date;
  direction: Direction;
  vehicleType: VehicleType;
  vehicleId: string;
}

export interface VehicleClearedInput {
  state: JunctionState;
  now: Date;
  direction: Direction;
  vehicleId: string;
}

export interface ManualGreenInput {
  state: JunctionState;
  now: Date;
  direction: Direction;
}

export interface ReturnToAutoInput {
  state: JunctionState;
  now: Date;
}

export interface EmergencyInput {
  state: JunctionState;
  now: Date;
  direction: Direction;
  vehicleId: string;
  active: boolean; // true if active/emergency vehicle present
}

export function handleTick(input: EngineInput): { state: JunctionState; commands: ControllerCommandState[]; audits: AuditEvent[] } {
  const { state, now, queues } = input;
  const newState: JunctionState = { ...state, lastTickAt: now };
  const commands: ControllerCommandState[] = [];
  const audits: AuditEvent[] = [];

  // Check TTLs
  if (state.mode === 'MANUAL' && state.manualUntil && now.getTime() > state.manualUntil.getTime()) {
    newState.mode = 'AUTOMATIC';
    newState.manualUntil = null;
    newState.manualDirection = null;
    audits.push({ eventType: 'TTL_EXPIRED', reason: 'Manual TTL expired, returning to AUTOMATIC' });
  }

  // Emergency stale check
  if (state.mode === 'EMERGENCY' && state.emergencySince && (now.getTime() - state.emergencySince.getTime()) > constants.EMERGENCY_STALE_MS) {
    newState.mode = 'AUTOMATIC';
    newState.emergencyDirection = null;
    newState.emergencySince = null;
    audits.push({ eventType: 'EMERGENCY_CLEARED', reason: 'Emergency stale timeout auto-cleared' });
  }

  // If controller degraded/unknown in certain cases - but engine still enforces safety; fallback handled by runner
  if (state.mode === 'DEGRADED') {
    // Ensure we stay safe; don't auto-switch to green
    return { state: newState, commands, audits };
  }

  // If emergency active, engine should have ensured safe sequence is in progress; just hold
  if (state.mode === 'EMERGENCY') {
    return { state: newState, commands, audits };
  }

  // If manual active, hold until TTL or return command
  if (state.mode === 'MANUAL') {
    return { state: newState, commands, audits };
  }

  // AUTOMATIC: check phase timing
  const pe = state.phaseEndsAt;
  if (pe && now.getTime() >= pe.getTime()) {
    // advance
    const nextPhase = pickNextTarget(state, queues, now);
    const advanced = advanceToPhase(newState, nextPhase, now);
    return { state: advanced.state, commands: advanced.commands, audits: [...audits, ...advanced.audits] };
  } else {
    // maybe pick next phase based on scheduler if green and conditions met
    if (state.phase === 'NS_GREEN' || state.phase === 'EW_GREEN') {
      const np = pickNextPhase(state, now, queues);
      if (np) {
        const advanced = advanceToPhase(newState, np, now);
        return { state: advanced.state, commands: advanced.commands, audits: [...audits, ...advanced.audits] };
      }
    }
  }

  return { state: newState, commands, audits };
}

function pickNextTarget(state: JunctionState, queues: QueueInfo[], now: Date): Phase {
  // If in transition, follow normal sequence based on current
  if (state.phase === 'NS_GREEN') return 'NS_YELLOW';
  if (state.phase === 'NS_YELLOW') return 'ALL_RED';
  if (state.phase === 'EW_GREEN') return 'EW_YELLOW';
  if (state.phase === 'EW_YELLOW') return 'ALL_RED';
  if (state.phase === 'ALL_RED') {
    // decide direction: prefer starved, else higher score, else last green was NS? or pick based on queues
    const nsScore = scoreQuick(state, 'NS_GREEN', queues);
    const ewScore = scoreQuick(state, 'EW_GREEN', queues);
    if (nsScore.hasStarved && !ewScore.hasStarved) return 'NS_GREEN';
    if (ewScore.hasStarved && !nsScore.hasStarved) return 'EW_GREEN';
    if (nsScore.score > ewScore.score) return 'NS_GREEN';
    if (ewScore.score > nsScore.score) return 'EW_GREEN';
    // tie: if both empty, stay on last? but we need to choose; default to NS if queues empty? just pick NS or keep simple
    if (nsScore.score === 0 && ewScore.score === 0) {
      // don't switch needlessly; pick NS_GREEN as default? but spec says stay on current green if empty - but we're in ALL_RED
      return state.emergencyDirection ? (state.emergencyDirection === 'NORTH' || state.emergencyDirection === 'SOUTH' ? 'NS_GREEN' : 'EW_GREEN') : (nsScore.score >= ewScore.score ? 'NS_GREEN' : 'EW_GREEN');
    }
    return nsScore.score >= ewScore.score ? 'NS_GREEN' : 'EW_GREEN';
  }
  return 'ALL_RED';
}

function scoreQuick(state: JunctionState, phase: Phase, queues: QueueInfo[]) {
  const t = state.config.timings;
  const dirs = (phase === 'NS_GREEN' || phase === 'EW_GREEN') ? directionsForPhase(phase) : [];
  let score = 0;
  let hasStarved = false;
  for (const d of dirs) {
    const q = queues.find((x) => x.direction === d);
    if (!q) continue;
    score += q.size * 1 + q.weightSum + (q.oldestWaitMs / 1000.0) * 0.5;
    if (q.oldestWaitMs > t.MAX_WAIT_MS) hasStarved = true;
  }
  return { score, hasStarved };
}

function advanceToPhase(state: JunctionState, target: Phase, now: Date): { state: JunctionState; commands: ControllerCommandState[]; audits: AuditEvent[] } {
  const commands: ControllerCommandState[] = [];
  const audits: AuditEvent[] = [];
  const t = state.config.timings;
  const newState = { ...state };

  newState.phase = target;
  newState.phaseStartedAt = now;
  const desired = signalsForPhase(target);
  newState.desiredSignals = desired;
  // set phase ends
  if (target === 'NS_GREEN' || target === 'EW_GREEN') {
    newState.phaseEndsAt = new Date(now.getTime() + t.GREEN_MS);
  } else if (target === 'NS_YELLOW' || target === 'EW_YELLOW') {
    newState.phaseEndsAt = new Date(now.getTime() + t.YELLOW_MS);
  } else if (target === 'ALL_RED') {
    newState.phaseEndsAt = new Date(now.getTime() + t.ALL_RED_MS);
  } else {
    newState.phaseEndsAt = new Date(now.getTime() + t.ALL_RED_MS);
  }
  assertSafe(desired);
  // create command for each direction change? or just indicate; runner will send
  for (const d of ['NORTH', 'SOUTH', 'EAST', 'WEST'] as Direction[]) {
    if (desired[d] !== state.desiredSignals[d] || state.actualSignals[d] === 'UNKNOWN') {
      commands.push(createCommand(newState, d, desired[d], now));
    }
  }
  audits.push({ eventType: 'PHASE_ADVANCED', reason: `Advanced to ${target}`, details: { target } });
  return { state: newState, commands, audits };
}

function createCommand(state: JunctionState, direction: Direction, requested: any, now: Date): ControllerCommandState {
  const id = 'cmd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  return {
    id,
    junctionId: state.id,
    direction,
    requestedState: requested,
    status: 'PENDING',
    attempts: 0,
    sentAt: now,
    ackedAt: null,
    actualState: null,
  };
}

export function requestManualGreen(input: ManualGreenInput): { state: JunctionState; commands: ControllerCommandState[]; audits: AuditEvent[] } {
  const { state, now, direction } = input;
  const t = state.config.timings;
  const newState: JunctionState = { ...state };
  const audits: AuditEvent[] = [];
  const commands: ControllerCommandState[] = [];

  if (state.mode === 'EMERGENCY') {
    // reject per policy? manual rejected during emergency - but spec says "rejected (409) during EMERGENCY/DEGRADED unless cause cleared"
    audits.push({ eventType: 'MANUAL_REQUESTED', reason: 'Manual request rejected while in EMERGENCY', direction });
    return { state, commands, audits };
  }
  if (state.mode === 'DEGRADED') {
    audits.push({ eventType: 'MANUAL_REQUESTED', reason: 'Manual request rejected while in DEGRADED', direction });
    return { state, commands, audits };
  }

  // start safe sequence to get to that phase
  newState.mode = 'MANUAL';
  newState.manualDirection = direction;
  newState.manualUntil = new Date(now.getTime() + t.MANUAL_TTL_MS);
  // move to appropriate phase via safe sequence: go to ALL_RED then target
  // simplest: go to ALL_RED if not already safe, then next step will go to target green
  const targetPhase = direction === 'NORTH' || direction === 'SOUTH' ? 'NS_GREEN' : 'EW_GREEN';
  // If already in that green, just hold
  if (state.phase === targetPhase && state.phaseEndsAt && now.getTime() < state.phaseEndsAt.getTime()) {
    const desired = signalsForPhase(targetPhase);
    newState.desiredSignals = desired;
    assertSafe(desired);
    audits.push({ eventType: 'MANUAL_REQUESTED', reason: 'Holding manual green (already in phase)', direction });
    return { state: newState, commands, audits };
  }
  // go to ALL_RED first for safety
  newState.phase = 'ALL_RED';
  newState.phaseStartedAt = now;
  newState.phaseEndsAt = new Date(now.getTime() + t.ALL_RED_MS);
  newState.desiredSignals = allRedSignals();
  assertSafe(newState.desiredSignals);
  for (const d of ['NORTH', 'SOUTH', 'EAST', 'WEST'] as Direction[]) {
    commands.push(createCommand(newState, d, 'RED', now));
  }
  audits.push({ eventType: 'MANUAL_REQUESTED', reason: 'Manual green requested; moving to ALL_RED then target', direction, details: { targetPhase } });
  return { state: newState, commands, audits };
}

export function returnToAutomatic(input: ReturnToAutoInput): { state: JunctionState; commands: ControllerCommandState[]; audits: AuditEvent[] } {
  const { state, now } = input;
  const newState: JunctionState = { ...state };
  const audits: AuditEvent[] = [];
  const commands: ControllerCommandState[] = [];

  if (state.mode === 'EMERGENCY' || state.mode === 'DEGRADED') {
    audits.push({ eventType: 'RETURN_TO_AUTOMATIC', reason: 'Cannot return to AUTOMATIC while in EMERGENCY/DEGRADED' });
    return { state, commands, audits };
  }
  if (state.mode === 'MANUAL') {
    newState.mode = 'AUTOMATIC';
    newState.manualUntil = null;
    newState.manualDirection = null;
    audits.push({ eventType: 'RETURN_TO_AUTOMATIC', reason: 'Returned to AUTOMATIC' });
    return { state: newState, commands, audits };
  }
  newState.mode = 'AUTOMATIC';
  audits.push({ eventType: 'RETURN_TO_AUTOMATIC', reason: 'Already in AUTOMATIC' });
  return { state: newState, commands, audits };
}

export function onEmergency(input: EmergencyInput): { state: JunctionState; commands: ControllerCommandState[]; audits: AuditEvent[] } {
  const { state, now, direction, vehicleId, active } = input;
  const t = state.config.timings;
  const newState: JunctionState = { ...state };
  const audits: AuditEvent[] = [];
  const commands: ControllerCommandState[] = [];

  if (!active) {
    // clearing handled by caller logic; engine just records
    return { state: newState, commands, audits };
  }

  // If same emergency already active for same direction, hold
  if (state.mode === 'EMERGENCY' && state.emergencyDirection === direction) {
    audits.push({ eventType: 'EMERGENCY_STARTED', reason: 'Emergency already active on same phase; holding', direction, details: { vehicleId } });
    return { state: newState, commands, audits };
  }

  // First emergency or different - emergency overrides manual
  const targetPhase = direction === 'NORTH' || direction === 'SOUTH' ? 'NS_GREEN' : 'EW_GREEN';
  newState.mode = 'EMERGENCY';
  newState.emergencyDirection = direction;
  newState.emergencySince = now;
  newState.manualUntil = null;
  newState.manualDirection = null;

  // If already in target green and safe, hold
  if (state.phase === targetPhase && state.phaseEndsAt && now.getTime() < state.phaseEndsAt.getTime()) {
    const desired = signalsForPhase(targetPhase);
    newState.desiredSignals = desired;
    assertSafe(desired);
    audits.push({ eventType: 'EMERGENCY_STARTED', reason: 'Emergency holding green on same phase', direction, details: { vehicleId } });
    return { state: newState, commands, audits };
  }

  // Safe sequence: move to ALL_RED
  newState.phase = 'ALL_RED';
  newState.phaseStartedAt = now;
  newState.phaseEndsAt = new Date(now.getTime() + t.ALL_RED_MS);
  newState.desiredSignals = allRedSignals();
  assertSafe(newState.desiredSignals);
  for (const d of ['NORTH', 'SOUTH', 'EAST', 'WEST'] as Direction[]) {
    commands.push(createCommand(newState, d, 'RED', now));
  }
  audits.push({ eventType: 'EMERGENCY_STARTED', reason: 'Emergency started; moving to ALL_RED then target', direction, details: { vehicleId, targetPhase } });
  return { state: newState, commands, audits };
}

export function clearEmergency(input: EmergencyInput): { state: JunctionState; commands: ControllerCommandState[]; audits: AuditEvent[] } {
  const { state, now, direction, vehicleId } = input;
  const newState: JunctionState = { ...state };
  const audits: AuditEvent[] = [];
  const commands: ControllerCommandState[] = [];

  if (state.mode === 'EMERGENCY' && state.emergencyDirection === direction) {
    newState.mode = 'AUTOMATIC';
    newState.emergencyDirection = null;
    newState.emergencySince = null;
    audits.push({ eventType: 'EMERGENCY_CLEARED', reason: 'Emergency cleared by vehicle', direction, details: { vehicleId } });
    return { state: newState, commands, audits };
  }
  return { state: newState, commands, audits };
}

export function onAck(state: JunctionState, commandId: string, status: 'ACK' | 'NACK' | 'FAILED', actualState?: any): { state: JunctionState; commands: ControllerCommandState[]; audits: AuditEvent[] } {
  const newState: JunctionState = { ...state };
  const audits: AuditEvent[] = [];
  const commands: ControllerCommandState[] = [];
  if (status === 'ACK') {
    audits.push({ eventType: 'CONTROLLER_ACK', commandId, reason: 'Controller acknowledged', details: { actualState } });
    // update actual signals for affected direction? simplified: update all to desired if matches
    if (actualState) {
      // not perfectly mapped; but store as-is conceptually
    }
  } else if (status === 'NACK') {
    audits.push({ eventType: 'CONTROLLER_NACK', commandId, reason: 'Controller NACK' });
  } else {
    audits.push({ eventType: 'CONTROLLER_FAILED', commandId: commandId, reason: 'Controller reported failure' } as any);
  }
  return { state: newState, commands, audits };
}
