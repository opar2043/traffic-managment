import app from './app';
import { env } from './config/env';
import { startTicker } from './services/ticker';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';

async function main() {
  try {
    // Perform restart recovery on boot (simplified)
    const junctions = await prisma.junction.findMany();
    for (const j of junctions) {
      await prisma.controllerCommand.updateMany({
        where: { junctionId: j.id, status: 'PENDING' },
        data: { status: 'ABANDONED_ON_RESTART' },
      });
      await prisma.auditLog.create({
        data: {
          junctionId: j.id,
          eventType: 'RESTART_RECOVERY',
          reason: 'Abandoned PENDING commands on restart; moving to DEGRADED/ALL_RED recovery',
        },
      });
      // Set actual signals UNKNOWN, go to DEGRADED and ALL_RED desired
      await prisma.junction.update({
        where: { id: j.id },
        data: {
          actualSignals: { NORTH: 'UNKNOWN', SOUTH: 'UNKNOWN', EAST: 'UNKNOWN', WEST: 'UNKNOWN' } as any,
          controllerStatus: 'UNKNOWN',
          mode: 'AUTOMATIC',
          phase: 'ALL_RED',
          desiredSignals: { NORTH: 'RED', SOUTH: 'RED', EAST: 'RED', WEST: 'RED' } as any,
          phaseStartedAt: new Date(),
          phaseEndsAt: null,
        },
      });
    }
  } catch (e) {
    logger.error('Restart recovery error', e);
  }

  startTicker();

  app.listen(env.port, () => {
    logger.info(`Server running on port ${env.port}`);
  });
}

main();
