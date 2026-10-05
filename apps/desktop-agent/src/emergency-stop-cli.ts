import console from 'node:console';
import process from 'node:process';
import {
  activateEmergencyStop,
  defaultEmergencyStopPath,
  readEmergencyStopState,
  resetEmergencyStop,
} from './file-emergency-stop.js';

const [command = 'status', ...reasonParts] = process.argv.slice(2);
const path = defaultEmergencyStopPath();

if (command === 'stop') {
  const state = await activateEmergencyStop(path, reasonParts.join(' '));
  console.log(JSON.stringify({ path, ...state }));
} else if (command === 'reset') {
  await resetEmergencyStop(path);
  console.log(JSON.stringify({ path, active: false }));
} else if (command === 'status') {
  console.log(JSON.stringify({ path, ...(await readEmergencyStopState(path)) }));
} else {
  console.error('Usage: emergency-stop-cli <status|stop|reset> [reason]');
  process.exitCode = 2;
}
