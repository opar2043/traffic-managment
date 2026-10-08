import { junctionRunner } from './junctionRunner';

export function startTicker() {
  setInterval(async () => {
    try {
      await junctionRunner.tick('A');
      await junctionRunner.handleTimeouts();
    } catch (e) {
      // ignore
    }
  }, 1000);
}
