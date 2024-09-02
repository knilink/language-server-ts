import { v4 as uuidv4 } from 'uuid';
import { getMachineId } from '../../lib/src/machineId.ts';
import { EditorSession } from '../../lib/src/config.ts';

const sessionId: string = `${uuidv4()}${Date.now()}`;
const agentEditorSession: EditorSession = new EditorSession(sessionId, getMachineId());

export { agentEditorSession };
