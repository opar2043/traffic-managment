const BASE = 'http://localhost:3000/api';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  try {
    const now = Date.now();
    const promises: Promise<any>[] = [];
    for (let t = 0; t <= 17; t++) {
      const eid = 'evt-' + t + '-' + now;
      promises.push(
        fetch(BASE + '/sensor-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_id: eid,
            junction_id: 'A',
            direction: 'NORTH',
            event_type: 'VEHICLE_ARRIVED',
            vehicle_id: 'v' + t,
            vehicle_type: 'TRUCK',
            sequence_no: t + 1,
            timestamp: new Date(now + t).toISOString(),
          }),
        }).catch(() => null)
      );
    }
    await Promise.all(promises);
    await sleep(2000);
    const res = await fetch(BASE + '/junctions/A/status');
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}

main();
