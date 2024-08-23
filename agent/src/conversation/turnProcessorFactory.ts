import { Unknown } from '../../../lib/src/types';
import { type TextDocument } from '../../../lib/src/textDocument';
import { type CancellationToken } from '../cancellation';
import { type TurnContext } from '../../../lib/src/conversation/turnContext';

import { SyntheticTurns, SyntheticTurnProcessor } from './syntheticTurnProcessor';
import { getAgents } from '../../../lib/src/conversation/agents/agents';
import {
  InlineTurnProcessorStrategy,
  PanelTurnProcessorStrategy,
} from '../../../lib/src/conversation/turnProcessorStrategy';
import { ModelTurnProcessor } from '../../../lib/src/conversation/turnProcessor';

interface ITurnProcessor {
  // ../methods/conversation/conversationCreate.ts
  process(
    workDoneToken: Unknown.WorkDoneToken,
    cancelationToken: CancellationToken,
    followUp?: Unknown.FollowUp,
    doc?: TextDocument
  ): Promise<void>;
}

class TurnProcessorFactory {
  public async createProcessor(
    turnContext: TurnContext,
    workDoneToken: Unknown.WorkDoneToken,
    computeSuggestions?: boolean
  ): Promise<ITurnProcessor> {
    if (turnContext.ctx.get(SyntheticTurns)?.get(workDoneToken) !== undefined) {
      return new SyntheticTurnProcessor(turnContext);
    }

    const agents = await getAgents(turnContext.ctx);
    let agent = agents.find((a) => a.slug === turnContext.turn.agent?.agentSlug);

    if (agent && 'turnProcessor' in agent) {
      return agent.turnProcessor(turnContext);
    }

    const turnProcessorStrategy =
      turnContext.conversation.source === 'inline'
        ? new InlineTurnProcessorStrategy(turnContext.ctx)
        : new PanelTurnProcessorStrategy(turnContext.ctx);

    if (computeSuggestions !== undefined) {
      turnProcessorStrategy.computeSuggestions = computeSuggestions;
    }

    return new ModelTurnProcessor(turnContext, turnProcessorStrategy);
  }
}

export { TurnProcessorFactory };
