import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const { junction_id, device, status } = req.body;
  if (!junction_id) throw new AppError('junction_id required', 400);
  if (!device || !['SIGNAL_CONTROLLER', 'SENSOR'].includes(device)) throw new AppError('device required', 400);
  if (!status || !['ONLINE', 'OFFLINE', 'DEGRADED'].includes(status)) throw new AppError('status invalid', 400);

  if (device === 'SIGNAL_CONTROLLER') {
    if (status === 'OFFLINE' || status === 'DEGRADED') {
      await prisma.junction.updateMany({
        where: { id: junction_id },
        data: { controllerStatus: status as any, mode: 'DEGRADED' },
      });
      await prisma.auditLog.create({ data: { junctionId: junction_id, eventType: 'CONTROLLER_OFFLINE', reason: `Controller ${status}` } });
    } else {
      await prisma.junction.updateMany({
        where: { id: junction_id },
        data: { controllerStatus: 'ONLINE' },
      });
      await prisma.auditLog.create({ data: { junctionId: junction_id, eventType: 'CONTROLLER_ONLINE', reason: 'Controller ONLINE' } });
    }
  } else if (device === 'SENSOR') {
    await prisma.auditLog.create({ data: { junctionId: junction_id, eventType: status === 'OFFLINE' ? 'SENSOR_OFFLINE' : 'SENSOR_ONLINE', reason: `Sensor ${status}` } });
  }
  res.json({ success: true });
}));

export default router;
