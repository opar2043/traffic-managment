import { PrismaClient, Direction, Phase, Mode, ControllerStatus, SensorStatus, SignalState, VehicleType, CommandStatus, EventResult } from '@prisma/client';

const prisma = new PrismaClient();

const JUNCTIONS = [
  { id: 'A', name: 'Junction A' },
  { id: 'B', name: 'Junction B' },
];

const config = {
  phases: [
    { name: 'NS_GREEN', directions: ['NORTH', 'SOUTH'], signal: 'GREEN' },
    { name: 'NS_YELLOW', directions: ['NORTH', 'SOUTH'], signal: 'YELLOW' },
    { name: 'ALL_RED', directions: ['NORTH', 'SOUTH', 'EAST', 'WEST'], signal: 'RED' },
    { name: 'EW_GREEN', directions: ['EAST', 'WEST'], signal: 'GREEN' },
    { name: 'EW_YELLOW', directions: ['EAST', 'WEST'], signal: 'YELLOW' },
  ],
  conflicts: { NS: ['NORTH', 'SOUTH'], EW: ['EAST', 'WEST'] },
  timings: {
    GREEN_MS: 30000,
    YELLOW_MS: 5000,
    ALL_RED_MS: 2000,
    MIN_GREEN_MS: 10000,
    ACK_TIMEOUT_MS: 5000,
    MAX_RETRIES: 1,
    MANUAL_TTL_MS: 300000,
    EMERGENCY_STALE_MS: 60000,
    MAX_WAIT_MS: 90000,
  },
};

const allRed = {
  NORTH: SignalState.RED,
  SOUTH: SignalState.RED,
  EAST: SignalState.RED,
  WEST: SignalState.RED,
};

async function seedJunction(id: string, name: string) {
  const now = new Date();

  await prisma.junction.upsert({
    where: { id },
    update: { name, config: config as any },
    create: {
      id,
      name,
      config: config as any,
      mode: Mode.AUTOMATIC,
      phase: Phase.ALL_RED,
      desiredSignals: allRed as any,
      actualSignals: allRed as any,
      controllerStatus: ControllerStatus.ONLINE,
      version: 0,
    },
  });

  for (const dir of [Direction.NORTH, Direction.SOUTH, Direction.EAST, Direction.WEST]) {
    await prisma.directionSensorState.upsert({
      where: { junctionId_direction: { junctionId: id, direction: dir } },
      update: { lastSequenceNo: 2, sensorStatus: SensorStatus.ONLINE },
      create: { junctionId: id, direction: dir, lastSequenceNo: 2, sensorStatus: SensorStatus.ONLINE },
    });
  }

  const queue = [
    {
      id: `qv-${id}-1`,
      junctionId: id,
      direction: Direction.NORTH,
      vehicleId: `${id}-VEH-001`,
      vehicleType: VehicleType.TRUCK,
      status: 'WAITING',
      arrivedAt: new Date(now.getTime() - 60_000),
      receivedAt: new Date(now.getTime() - 60_000),
      clearedAt: null,
    },
    {
      id: `qv-${id}-2`,
      junctionId: id,
      direction: Direction.EAST,
      vehicleId: `${id}-VEH-002`,
      vehicleType: VehicleType.EMPLOYEE_VEHICLE,
      status: 'CLEARED',
      arrivedAt: new Date(now.getTime() - 180_000),
      receivedAt: new Date(now.getTime() - 180_000),
      clearedAt: new Date(now.getTime() - 120_000),
    },
  ];
  for (const q of queue) {
    await prisma.queueVehicle.upsert({ where: { id: q.id }, update: q, create: q });
  }

  const events = [
    { eventId: `${id}-EVT-001`, junctionId: id, direction: Direction.NORTH, sequenceNo: 1, result: EventResult.APPLIED, receivedAt: new Date(now.getTime() - 60_000) },
    { eventId: `${id}-EVT-002`, junctionId: id, direction: Direction.EAST, sequenceNo: 2, result: EventResult.APPLIED, receivedAt: new Date(now.getTime() - 120_000) },
  ];
  for (const e of events) {
    await prisma.processedEvent.upsert({ where: { eventId: e.eventId }, update: e, create: { id: `pe-${e.eventId}`, ...e } });
  }

  const audits = [
    {
      id: `al-${id}-1`,
      junctionId: id,
      eventType: 'SENSOR_ONLINE',
      direction: Direction.NORTH,
      reason: 'Sensor ONLINE',
      details: { seeded: true },
      timestamp: new Date(now.getTime() - 300_000),
    },
    {
      id: `al-${id}-2`,
      junctionId: id,
      eventType: 'VEHICLE_ARRIVED',
      direction: Direction.NORTH,
      reason: 'Vehicle arrived',
      details: { vehicle_id: `${id}-VEH-001`, vehicle_type: 'TRUCK', seeded: true },
      timestamp: new Date(now.getTime() - 60_000),
    },
  ];
  for (const a of audits) {
    await prisma.auditLog.upsert({ where: { id: a.id }, update: a, create: a });
  }

  const commands = [
    {
      id: `${id}-CMD-001`,
      junctionId: id,
      direction: Direction.NORTH,
      requestedState: SignalState.GREEN,
      status: CommandStatus.ACKED,
      attempts: 1,
      sentAt: new Date(now.getTime() - 120_000),
      ackedAt: new Date(now.getTime() - 119_000),
      actualState: SignalState.GREEN,
    },
    {
      id: `${id}-CMD-002`,
      junctionId: id,
      direction: Direction.EAST,
      requestedState: SignalState.RED,
      status: CommandStatus.FAILED,
      attempts: 1,
      sentAt: new Date(now.getTime() - 90_000),
      ackedAt: null,
      actualState: null,
    },
  ];
  for (const c of commands) {
    await prisma.controllerCommand.upsert({ where: { id: c.id }, update: c, create: c });
  }
}

async function main() {
  for (const j of JUNCTIONS) {
    await seedJunction(j.id, j.name);
  }

  const [junctions, queues, events, audits, commands, sensors] = await Promise.all([
    prisma.junction.count(),
    prisma.queueVehicle.count(),
    prisma.processedEvent.count(),
    prisma.auditLog.count(),
    prisma.controllerCommand.count(),
    prisma.directionSensorState.count(),
  ]);
  console.log(
    `Seed complete -> junctions:${junctions} queueVehicles:${queues} processedEvents:${events} auditLogs:${audits} controllerCommands:${commands} sensorStates:${sensors}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
