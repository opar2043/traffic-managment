export type Direction = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

export type SignalState = 'RED' | 'YELLOW' | 'GREEN' | 'UNKNOWN';

export type Phase = 'NS_GREEN' | 'NS_YELLOW' | 'ALL_RED' | 'EW_GREEN' | 'EW_YELLOW';

export type Mode = 'AUTOMATIC' | 'MANUAL' | 'EMERGENCY' | 'DEGRADED';

export type VehicleType = 'EMERGENCY' | 'TRUCK' | 'FORKLIFT' | 'EMPLOYEE_VEHICLE';

export type EventResult =
  | 'APPLIED'
  | 'DUPLICATE'
  | 'REJECTED_INVALID'
  | 'REJECTED_NO_ARRIVAL'
  | 'REJECTED_OUT_OF_ORDER'
  | 'REJECTED_STALE'
  | 'REJECTED_DUPLICATE_VEHICLE';

export type ControllerStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'UNKNOWN';

export type CommandStatus = 'PENDING' | 'ACKED' | 'FAILED' | 'TIMED_OUT' | 'ABANDONED_ON_RESTART';

export type SensorStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'UNKNOWN';

export type VehicleWeight = {
  [key in VehicleType]: number;
};

export interface PhaseDef {
  name: Phase;
  directions: Direction[];
  signal: SignalState;
}

export interface JunctionConfig {
  phases: PhaseDef[];
  conflicts: { NS: Direction[]; EW: Direction[] };
  timings: {
    GREEN_MS: number;
    YELLOW_MS: number;
    ALL_RED_MS: number;
    MIN_GREEN_MS: number;
    ACK_TIMEOUT_MS: number;
    MAX_RETRIES: number;
    MANUAL_TTL_MS: number;
    EMERGENCY_STALE_MS: number;
    MAX_WAIT_MS: number;
  };
}

export interface SignalMap {
  NORTH: SignalState;
  SOUTH: SignalState;
  EAST: SignalState;
  WEST: SignalState;
}

export interface QueueVehicleState {
  id: string;
  junctionId: string;
  direction: Direction;
  vehicleId: string;
  vehicleType: VehicleType;
  status: 'WAITING' | 'CLEARED';
  arrivedAt: Date;
  receivedAt: Date;
  clearedAt: Date | null;
}

export interface DirectionSensorStateType {
  junctionId: string;
  direction: Direction;
  lastSequenceNo: number;
  sensorStatus: SensorStatus;
}

export interface ControllerCommandState {
  id: string;
  junctionId: string;
  direction: Direction | null;
  requestedState: SignalState | null;
  status: CommandStatus;
  attempts: number;
  sentAt: Date;
  ackedAt: Date | null;
  actualState: SignalState | null;
}

export interface JunctionState {
  id: string;
  name: string;
  config: JunctionConfig;
  mode: Mode;
  phase: Phase;
  desiredSignals: SignalMap;
  actualSignals: SignalMap;
  controllerStatus: ControllerStatus;
  phaseStartedAt: Date;
  phaseEndsAt: Date | null;
  nextPhaseTarget: Phase | null;
  manualUntil: Date | null;
  manualDirection: Direction | null;
  emergencyDirection: Direction | null;
  emergencySince: Date | null;
  version: number;
  lastTickAt: Date;
}

export type DomainEventType =
  | 'PHASE_ADVANCED'
  | 'MODE_CHANGED'
  | 'MANUAL_REQUESTED'
  | 'MANUAL_ENDED'
  | 'EMERGENCY_STARTED'
  | 'EMERGENCY_QUEUED'
  | 'EMERGENCY_CLEARED'
  | 'CONTROLLER_COMMAND_SENT'
  | 'CONTROLLER_ACK'
  | 'CONTROLLER_NACK'
  | 'CONTROLLER_TIMEOUT'
  | 'CONTROLLER_MISMATCH'
  | 'CONTROLLER_OFFLINE'
  | 'CONTROLLER_ONLINE'
  | 'VEHICLE_ARRIVED'
  | 'VEHICLE_CLEARED'
  | 'RESTART_RECOVERY'
  | 'STATE_MISMATCH'
  | 'SENSOR_OFFLINE'
  | 'SENSOR_ONLINE'
  | 'ABANDONED_ON_RESTART'
  | 'DUPLICATE_EVENT_REJECTED'
  | 'CLEARED_WITHOUT_ARRIVAL'
  | 'OUT_OF_ORDER'
  | 'DUPLICATE_VEHICLE'
  | 'TTL_EXPIRED'
  | 'SAFETY_ASSERTION'
  | 'RETURN_TO_AUTOMATIC';

export interface AuditEvent {
  eventType: DomainEventType;
  direction?: Direction;
  previousState?: Partial<SignalMap> | SignalMap;
  newState?: Partial<SignalMap> | SignalMap;
  commandId?: string;
  reason?: string;
  details?: any;
}

export interface EngineResult {
  state: JunctionState;
  commands: ControllerCommandState[];
  audits: AuditEvent[];
}
