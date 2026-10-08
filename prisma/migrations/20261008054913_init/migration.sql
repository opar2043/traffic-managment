-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('NORTH', 'SOUTH', 'EAST', 'WEST');

-- CreateEnum
CREATE TYPE "SignalState" AS ENUM ('RED', 'YELLOW', 'GREEN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('NS_GREEN', 'NS_YELLOW', 'ALL_RED', 'EW_GREEN', 'EW_YELLOW');

-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('AUTOMATIC', 'MANUAL', 'EMERGENCY', 'DEGRADED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('EMERGENCY', 'TRUCK', 'FORKLIFT', 'EMPLOYEE_VEHICLE');

-- CreateEnum
CREATE TYPE "EventResult" AS ENUM ('APPLIED', 'DUPLICATE', 'REJECTED_INVALID', 'REJECTED_NO_ARRIVAL', 'REJECTED_OUT_OF_ORDER', 'REJECTED_STALE', 'REJECTED_DUPLICATE_VEHICLE');

-- CreateEnum
CREATE TYPE "ControllerStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('PENDING', 'ACKED', 'FAILED', 'TIMED_OUT', 'ABANDONED_ON_RESTART');

-- CreateEnum
CREATE TYPE "SensorStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Junction" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "mode" "Mode" NOT NULL DEFAULT 'AUTOMATIC',
    "phase" "Phase" NOT NULL DEFAULT 'ALL_RED',
    "desiredSignals" JSONB NOT NULL,
    "actualSignals" JSONB NOT NULL,
    "controllerStatus" "ControllerStatus" NOT NULL DEFAULT 'UNKNOWN',
    "phaseStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phaseEndsAt" TIMESTAMP(3),
    "nextPhaseTarget" "Phase",
    "manualUntil" TIMESTAMP(3),
    "manualDirection" "Direction",
    "emergencyDirection" "Direction",
    "emergencySince" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "lastTickAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Junction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueVehicle" (
    "id" TEXT NOT NULL,
    "junctionId" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "arrivedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "QueueVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "junctionId" TEXT NOT NULL,
    "direction" "Direction",
    "sequenceNo" INTEGER,
    "result" "EventResult" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectionSensorState" (
    "junctionId" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "lastSequenceNo" INTEGER NOT NULL DEFAULT 0,
    "sensorStatus" "SensorStatus" NOT NULL DEFAULT 'UNKNOWN',

    CONSTRAINT "DirectionSensorState_pkey" PRIMARY KEY ("junctionId","direction")
);

-- CreateTable
CREATE TABLE "ControllerCommand" (
    "id" TEXT NOT NULL,
    "junctionId" TEXT NOT NULL,
    "direction" "Direction",
    "requestedState" "SignalState",
    "status" "CommandStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedAt" TIMESTAMP(3),
    "actualState" "SignalState",

    CONSTRAINT "ControllerCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "junctionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "direction" "Direction",
    "previousState" JSONB,
    "newState" JSONB,
    "commandId" TEXT,
    "reason" TEXT,
    "details" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Junction_mode_idx" ON "Junction"("mode");

-- CreateIndex
CREATE INDEX "Junction_controllerStatus_idx" ON "Junction"("controllerStatus");

-- CreateIndex
CREATE INDEX "QueueVehicle_junctionId_direction_status_idx" ON "QueueVehicle"("junctionId", "direction", "status");

-- CreateIndex
CREATE INDEX "QueueVehicle_junctionId_status_idx" ON "QueueVehicle"("junctionId", "status");

-- CreateIndex
CREATE INDEX "QueueVehicle_vehicleId_idx" ON "QueueVehicle"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedEvent_eventId_key" ON "ProcessedEvent"("eventId");

-- CreateIndex
CREATE INDEX "ProcessedEvent_junctionId_receivedAt_idx" ON "ProcessedEvent"("junctionId", "receivedAt");

-- CreateIndex
CREATE INDEX "DirectionSensorState_junctionId_idx" ON "DirectionSensorState"("junctionId");

-- CreateIndex
CREATE INDEX "ControllerCommand_junctionId_status_idx" ON "ControllerCommand"("junctionId", "status");

-- CreateIndex
CREATE INDEX "ControllerCommand_status_sentAt_idx" ON "ControllerCommand"("status", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ControllerCommand_id_key" ON "ControllerCommand"("id");

-- CreateIndex
CREATE INDEX "AuditLog_junctionId_timestamp_idx" ON "AuditLog"("junctionId", "timestamp");

-- AddForeignKey
ALTER TABLE "QueueVehicle" ADD CONSTRAINT "QueueVehicle_junctionId_fkey" FOREIGN KEY ("junctionId") REFERENCES "Junction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedEvent" ADD CONSTRAINT "ProcessedEvent_junctionId_fkey" FOREIGN KEY ("junctionId") REFERENCES "Junction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectionSensorState" ADD CONSTRAINT "DirectionSensorState_junctionId_fkey" FOREIGN KEY ("junctionId") REFERENCES "Junction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControllerCommand" ADD CONSTRAINT "ControllerCommand_junctionId_fkey" FOREIGN KEY ("junctionId") REFERENCES "Junction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_junctionId_fkey" FOREIGN KEY ("junctionId") REFERENCES "Junction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
