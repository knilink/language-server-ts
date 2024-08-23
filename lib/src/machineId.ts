import * as os from 'os';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const invalidMacAddresses: Set<string> = new Set(['00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff', 'ac:de:48:00:11:22']);
let machineId: string | undefined;

function validateMacAddress(candidate: string): boolean {
  const tempCandidate = candidate.replace(/-/g, ':').toLowerCase();
  return !invalidMacAddresses.has(tempCandidate);
}

function getMac(): string {
  const ifaces = os.networkInterfaces();
  for (const name in ifaces) {
    const networkInterface = ifaces[name];
    if (networkInterface) {
      for (const { mac } of networkInterface as any[]) {
        if (validateMacAddress(mac)) return mac;
      }
    }
  }
  throw new Error('Unable to retrieve MAC address (unexpected format)');
}

function getMacMachineId(): string | undefined {
  try {
    const macAddress = getMac();
    return crypto.createHash('sha256').update(macAddress, 'utf8').digest('hex');
  } catch (e) {
    return;
  }
}

function getMachineId(): string {
  if (!machineId) {
    machineId = getMacMachineId() || uuidv4();
  }
  return machineId;
}

export { getMachineId };
