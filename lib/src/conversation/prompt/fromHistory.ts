import { Turn } from '../../conversation/conversation';

import { fromMessage } from './fromMessage';
import { weighElidableList } from './elidableList';
import { ElidableText } from '../../../../prompt/src/elidableText/elidableText';

const MAX_TURNS_IN_HISTORY = 5;

function fromHistory(history: Turn[]): ElidableText | null {
  const elidableHistory: ElidableText[] = [];

  const turns = filterTurns(history);

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const request = formatTurnMessage(turn.request, i + 1);
    const response = turn.response && turn.response.type !== 'meta' ? formatTurnMessage(turn.response) : '';
    const message = `${request}${response !== '' ? `\n${response}` : ''}${turns.length > 1 && i !== turns.length - 1 ? '\n' : ''}`;

    elidableHistory.push(fromMessage(message));
  }

  return elidableHistory.length > 0
    ? new ElidableText([
      [new ElidableText(['Consider the following conversation history:']), 1],
      [weighElidableList(elidableHistory, 'inverseLinear'), 1],
    ])
    : null;
}

function filterTurns(turns: Turn[]): Turn[] {
  return turns
    .filter((turn) => (turn.status === 'success' || turn.status === 'in-progress') && turn.request.message !== '')
    .reverse()
    .slice(0, MAX_TURNS_IN_HISTORY)
    .reverse();
}

function formatTurnMessage(turnMessage: Turn['request'] | NonNullable<Turn['response']>, index = 0): string {
  let role: string;
  switch (turnMessage.type) {
    case 'user':
    case 'template':
      role = 'User';
      break;
    case 'model':
      role = 'GitHub Copilot';
      break;
    default:
      role = turnMessage.type;
  }

  const messagePrefix = turnMessage.message.startsWith('```') ? '\n' : ' ';
  const indexStr = index > 0 ? `${index}) ` : '';
  return `${indexStr}${role}:${messagePrefix}${turnMessage.message}`;
}

export { fromHistory, MAX_TURNS_IN_HISTORY };
