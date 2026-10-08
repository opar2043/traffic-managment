import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { junctionRunner } from '../../services/junctionRunner';
import { EventResult } from '../../domain/types';

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const body = req.body;
  const { event_id, junction_id, direction, event_type, vehicle_id, vehicle_type, sequence_no, timestamp } = body || {};

  // basic validation
  if (!event_id) throw new AppError('event_id required', 400);
  if (!junction_id) throw new AppError('junction_id required', 400);
  if (!direction || !['NORTH', 'SOUTH', 'EAST', 'WEST'].includes(direction)) throw new AppError('direction invalid', 400);
  if (!event_type || !['VEHICLE_ARRIVED', 'VEHICLE_CLEARED'].includes(event_type)) throw new AppError('event_type invalid', 400);
  if (!vehicle_id) throw new AppError('vehicle_id required', 400);
  if (event_type === 'VEHICLE_ARRIVED' && !vehicle_type) throw new AppError('vehicle_type required for ARRIVED', 400);
  const seq = Number(sequence_no);
  if (!Number.isInteger(seq)) throw new AppError('sequence_no must be int', 400);
  const ts = timestamp ? new Date(timestamp) : new Date();
  if (isNaN(ts.getTime())) throw new AppError('timestamp invalid', 400);
  const now = new Date();

  const j = await prisma.junction.findUnique({ where: { id: junction_id } });
  if (!j) throw new AppError('Junction not found', 404);

  const existingProc = await prisma.processedEvent.findUnique({ where: { eventId: event_id } });
  if (existingProc) {
    await prisma.auditLog.create({ data: { junctionId: junction_id, eventType: 'DUPLICATE_EVENT_REJECTED', direction: direction as any, reason: 'event_id already processed', details: { event_id, result: existingProc.result } } });
    return res.status(200).json({ success: true, status: 'DUPLICATE' });
  }

  const sensorState = await prisma.directionSensorState.findUnique({ where: { junctionId_direction: { junctionId: junction_id, direction: direction as any } } });

  if (event_type === 'VEHICLE_ARRIVED') {
    if (vehicle_type && !['EMERGENCY', 'TRUCK', 'FORKLIFT', 'EMPLOYEE_VEHICLE'].includes(vehicle_type)) {
      await prisma.processedEvent.create({ data: { eventId: event_id, junctionId: junction_id, direction: direction as any, sequenceNo: seq, result: 'REJECTED_INVALID' as any } });
      throw new AppError('vehicle_type invalid', 400);
    }
    const waiting = await prisma.queueVehicle.findFirst({ where: { junctionId: junction_id, direction: direction as any, vehicleId: vehicle_id, status: 'WAITING' } });
    if (waiting) {
      await prisma.processedEvent.create({ data: { eventId: event_id, junctionId: junction_id, direction: direction as any, sequenceNo: seq, result: 'REJECTED_DUPLICATE_VEHICLE' as any } });
      await prisma.auditLog.create({ data: { junctionId: junction_id, eventType: 'DUPLICATE_VEHICLE', direction: direction as any, reason: 'vehicle already waiting', details: { vehicle_id } } });
      return res.status(409).json({ success: false, message: 'REJECTED_DUPLICATE_VEHICLE' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.queueVehicle.create({
        data: {
          junctionId: junction_id,
          direction: direction as any,
          vehicleId: vehicle_id,
          vehicleType: vehicle_type as any,
          status: 'WAITING',
          arrivedAt: ts,
          receivedAt: now,
        },
      });
      await tx.processedEvent.create({ data: { eventId: event_id, junctionId: junction_id, direction: direction as any, sequenceNo: seq, result: 'APPLIED' as any } });
      const last = sensorState?.lastSequenceNo || 0;
      if (seq > last) {
        await tx.directionSensorState.upsert({
          where: { junctionId_direction: { junctionId: junction_id, direction: direction as any } },
          update: { lastSequenceNo: seq },
          create: { junctionId: junction_id, direction: direction as any, lastSequenceNo: seq, sensorStatus: 'UNKNOWN' },
        });
      }
    });
    if (vehicle_type === 'EMERGENCY') {
      await junctionRunner.emergencyActive(junction_id, direction as any, vehicle_id);
    }
    await prisma.auditLog.create({ data: { junctionId: junction_id, eventType: 'VEHICLE_ARRIVED', direction: direction as any, reason: 'Vehicle arrived', details: { vehicle_id, vehicle_type, sequence_no: seq } } });
    return res.status(201).json({ success: true, status: 'APPLIED' });
  } else {
    // CLEARED
    const waiting = await prisma.queueVehicle.findFirst({ where: { junctionId: junction_id, direction: direction as any, vehicleId: vehicle_id, status: 'WAITING' } });
    if (!waiting) {
      await prisma.processedEvent.create({ data: { eventId: event_id, junctionId: junction_id, direction: direction as any, sequenceNo: seq, result: 'REJECTED_NO_ARRIVAL' as any } });
      await prisma.auditLog.create({ data: { junctionId: junction_id, eventType: 'CLEARED_WITHOUT_ARRIVAL', direction: direction as any, reason: 'CLEARED without arrival', details: { vehicle_id } } });
      return res.status(409).json({ success: false, message: 'CLEARED_WITHOUT_ARRIVAL' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.queueVehicle.update({ where: { id: waiting.id }, data: { status: 'CLEARED', clearedAt: now } });
      await tx.processedEvent.create({ data: { eventId: event_id, junctionId: junction_id, direction: direction as any, sequenceNo: seq, result: 'APPLIED' as any } });
      const last = sensorState?.lastSequenceNo || 0;
      if (seq > last) {
        await tx.directionSensorState.upsert({
          where: { junctionId_direction: { junctionId: junction_id, direction: direction as any } },
          update: { lastSequenceNo: seq },
          create: { junctionId: junction_id, direction: direction as any, lastSequenceNo: seq, sensorStatus: 'UNKNOWN' },
        });
      }
    });
    // if this was emergency vehicle, clear emergency
    const vtype = waiting.vehicleType as any;
    if (vtype === 'EMERGENCY') {
      await junctionRunner.emergencyClear(junction_id, direction as any, vehicle_id);
    }
    await prisma.auditLog.create({ data: { junctionId: junction_id, eventType: 'VEHICLE_CLEARED', direction: direction as any, reason: 'Vehicle cleared', details: { vehicle_id } } });
    return res.status(201).json({ success: true, status: 'APPLIED' });
  }
}));

export default router;
