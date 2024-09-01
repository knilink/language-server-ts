import { type TSchema } from '@sinclair/typebox';
import { type HandlerFunction } from "../schemaValidation.ts";

import * as inlineCompletion from "./inlineCompletion.ts";
import { handleGetCompletions, handleGetCompletionsCycling } from "./getCompletions.ts";
import { handleGetPanelCompletions } from "./getPanelCompletions.ts";
import * as copilotPanelCompletion from "./copilotPanelCompletion.ts";
import { handleGetVersion } from "./getVersion.ts";
import { handleSetEditorInfo } from "./setEditorInfo.ts";
import { handleCheckStatus } from "./checkStatus.ts";
import { handleCheckFileStatus } from "./checkFileStatus.ts";
import { handleSignInInitiate } from "./signInInitiate.ts";
import { handleSignInConfirm } from "./signInConfirm.ts";
import { handleSignInWithGithubToken } from "./signInWithGithubToken.ts";
import { handleSignOut } from "./signOut.ts";
import { notifyShown } from "./notifyShown.ts";
import { notifyAccepted } from "./notifyAccepted.ts";
import { notifyRejected } from "./notifyRejected.ts";
import { handleTelemetryException } from "./telemetryTrack.ts";
import { handleTelemetryAuthNotifyDismissed } from "./telemetry/authNotifyDismissed.ts";
import { handleTelemetryAuthNotifyShown } from "./telemetry/authNotifyShown.ts";
import { handleTelemetryGitHubLoginSuccess } from "./telemetry/gitHubLoginSuccess.ts";
import { handleTelemetryNewGitHubLogin } from "./telemetry/newGitHubLogin.ts";
import { handleTestingOverrideExpFlags } from "./testing/overrideExpFlags.ts";
import { handleTestingAlwaysAuth } from "./testing/alwaysAuth.ts";
import { handleTestingNeverAuth } from "./testing/neverAuth.ts";
import { handleTestingUseTestingToken } from "./testing/useTestingToken.ts";
import { handleTestingSetCompletionDocuments } from "./testing/setCompletionDocuments.ts";
import { handleTestingSetPanelCompletionDocuments } from "./testing/setPanelCompletionDocuments.ts";
import { handleTriggerShowMessage } from "./testing/triggerShowMessage.ts";
import { handleTestingGetTelemetry } from "./testing/getTelemetry.ts";
import { handleTestingSetTelemetryCapture } from "./testing/setTelemetryCapture.ts";
import { handleGetDocument } from "./testing/getDocument.ts";
import { handleChatML } from "./testing/chatML.ts";
import { handleUninstall } from "./uninstall.ts";
import { handleDiagnostics } from "./debug/diagnostics.ts";
import { handleListCertificates } from "./listCertificates.ts";
import { handleVerifyState } from "./verifyState.ts";
import { handleVerifyCertificate } from "./verifyCertificate.ts";
import { handleVerifyKerberos } from "./verifyKerberos.ts";
import { handleVerifyWorkspaceState } from "./verifyWorkspaceState.ts";
import { handleConversationPreconditions } from "./conversation/conversationPreconditions.ts";
import { handleConversationPersistence } from "./conversation/conversationPersistence.ts";
import { handleConversationCreate } from "./conversation/conversationCreate.ts";
import { handleConversationTurn } from "./conversation/conversationTurn.ts";
import { handleConversationTurnDelete } from "./conversation/conversationTurnDelete.ts";
import { handleConversationDestroy } from "./conversation/conversationDestroy.ts";
import { handleConversationRating } from "./conversation/conversationRating.ts";
import { handleConversationCodeCopy } from "./conversation/conversationCodeCopy.ts";
import { handleConversationCodeInsert } from "./conversation/conversationCodeInsert.ts";
import { handleConversationTemplates } from "./conversation/conversationTemplates.ts";
import { handleConversationAgents } from "./conversation/conversationAgents.ts";
import { handleTestingSetSyntheticTurns } from "./testing/setSyntheticTurns.ts";
import { handleMatch, handleFilesForMatch } from "./snippy.ts";
import { handleTestingFetch } from "./testing/fetch.ts";

type MethodName = string;

type HandlerFunctionType = HandlerFunction<TSchema, unknown, unknown>;

class MethodHandlers {
  constructor(readonly handlers: Map<MethodName, HandlerFunctionType>) { }
}

function getAllMethods(): MethodHandlers {
  const methods = new Map<MethodName, HandlerFunctionType>();

  methods.set(inlineCompletion.type.method, inlineCompletion.handle);
  methods.set('getCompletions', handleGetCompletions);
  methods.set('getCompletionsCycling', handleGetCompletionsCycling);
  methods.set('getPanelCompletions', handleGetPanelCompletions);
  methods.set(copilotPanelCompletion.type.method, copilotPanelCompletion.handle);
  methods.set('getVersion', handleGetVersion);
  methods.set('setEditorInfo', handleSetEditorInfo);
  methods.set('checkStatus', handleCheckStatus);
  methods.set('checkFileStatus', handleCheckFileStatus);
  methods.set('signInInitiate', handleSignInInitiate);
  methods.set('signInConfirm', handleSignInConfirm);
  methods.set('signInWithGithubToken', handleSignInWithGithubToken);
  methods.set('signOut', handleSignOut);
  methods.set('notifyShown', notifyShown);
  methods.set('notifyAccepted', notifyAccepted);
  methods.set('notifyRejected', notifyRejected);
  methods.set('telemetry/exception', handleTelemetryException);
  methods.set('telemetry/authNotifyDismissed', handleTelemetryAuthNotifyDismissed);
  methods.set('telemetry/authNotifyShown', handleTelemetryAuthNotifyShown);
  methods.set('telemetry/gitHubLoginSuccess', handleTelemetryGitHubLoginSuccess);
  methods.set('telemetry/newGitHubLogin', handleTelemetryNewGitHubLogin);
  methods.set('testing/overrideExpFlags', handleTestingOverrideExpFlags);
  methods.set('testing/alwaysAuth', handleTestingAlwaysAuth);
  methods.set('testing/neverAuth', handleTestingNeverAuth);
  methods.set('testing/useTestingToken', handleTestingUseTestingToken);
  methods.set('testing/setCompletionDocuments', handleTestingSetCompletionDocuments);
  methods.set('testing/setPanelCompletionDocuments', handleTestingSetPanelCompletionDocuments);
  methods.set('testing/triggerShowMessageRequest', handleTriggerShowMessage);
  methods.set('testing/getTelemetry', handleTestingGetTelemetry);
  methods.set('testing/setTelemetryCapture', handleTestingSetTelemetryCapture);
  methods.set('testing/getDocument', handleGetDocument);
  methods.set('testing/chatml', handleChatML);
  methods.set('uninstall', handleUninstall);
  methods.set('debug/diagnostics', handleDiagnostics);
  methods.set('debug/listCertificates', handleListCertificates);
  methods.set('debug/verifyState', handleVerifyState);
  methods.set('debug/verifyCertificate', handleVerifyCertificate);
  methods.set('debug/verifyKerberos', handleVerifyKerberos);
  methods.set('debug/verifyWorkspaceState', handleVerifyWorkspaceState);
  methods.set('conversation/preconditions', handleConversationPreconditions);
  methods.set('conversation/persistence', handleConversationPersistence);
  methods.set('conversation/create', handleConversationCreate);
  methods.set('conversation/turn', handleConversationTurn);
  methods.set('conversation/turnDelete', handleConversationTurnDelete);
  methods.set('conversation/destroy', handleConversationDestroy);
  methods.set('conversation/rating', handleConversationRating);
  methods.set('conversation/copyCode', handleConversationCodeCopy);
  methods.set('conversation/insertCode', handleConversationCodeInsert);
  methods.set('conversation/templates', handleConversationTemplates);
  methods.set('conversation/agents', handleConversationAgents);
  methods.set('testing/setSyntheticTurns', handleTestingSetSyntheticTurns);
  methods.set('snippy/match', handleMatch);
  methods.set('snippy/filesForMatch', handleFilesForMatch);
  methods.set('testing/fetch', handleTestingFetch);

  return new MethodHandlers(methods);
}

export { MethodHandlers, getAllMethods };
