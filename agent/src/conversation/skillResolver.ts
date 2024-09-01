import { TSchema, type Static } from '@sinclair/typebox';
import { TypeCompiler, TypeCheck } from '@sinclair/typebox/compiler';

import { ProtocolRequestType, ResponseError } from "vscode-languageserver/node.js";

import { type CancellationToken } from '../cancellation.ts';
import { Skill, type SkillId } from '../../../lib/src/types.ts';

import { Context } from '../../../lib/src/context.ts';
import { Service } from '../service.ts';
import { conversationLogger } from '../../../lib/src/conversation/logger.ts';
import { SchemaValidationError } from '../schemaValidation.ts';
import { TurnContext } from '../../../lib/src/conversation/turnContext.ts';

class AgentSkillResolver<P extends TSchema = TSchema> implements Skill.ISkillResolver<Static<P>> {
  readonly requestType = new ProtocolRequestType<
    { conversationId: string; turnId: string; skillId: SkillId },
    [Static<P>, null] | [null, { code: number; message: string; data?: unknown }],
    unknown,
    unknown,
    unknown
  >('conversation/context');
  readonly typeCheck: TypeCheck<P>;

  constructor(
    readonly ctx: Context,
    readonly skillId: SkillId,
    schema: P
  ) {
    this.typeCheck = TypeCompiler.Compile(schema);
  }

  async resolveSkill(turnContext: TurnContext): Promise<Static<P> | undefined> {
    const conn = this.ctx.get(Service).connection;
    const params = {
      conversationId: turnContext.conversation.id,
      turnId: turnContext.turn.id,
      skillId: this.skillId,
    };

    let result: Static<P>;
    try {
      const response = await conn.sendRequest(this.requestType, params);
      const [maybeResult, maybeErr] = response;

      if (maybeErr) {
        const responseError = new ResponseError(maybeErr.code, maybeErr.message, maybeErr.data);
        conversationLogger.error(this.ctx, `ResponseError while resolving skill ${this.skillId}`, responseError);
        return;
      }

      result = maybeResult;
    } catch (e: unknown) {
      conversationLogger.error(this.ctx, `Error while resolving skill ${this.skillId}`, e as Error);
      return;
    }

    if (result) {
      if (!this.typeCheck.Check(result)) throw new SchemaValidationError(this.typeCheck.Errors(result));
      return result;
    }
  }
}

export { AgentSkillResolver };
