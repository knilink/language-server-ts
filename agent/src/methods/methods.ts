import { type TSchema } from '@sinclair/typebox';
import { type HandlerFunction } from '../schemaValidation';

import * as inlineCompletion from './inlineCompletion';
import { handleGetCompletions, handleGetCompletionsCycling } from './getCompletions';
import { handleGetPanelCompletions } from './getPanelCompletions';
import * as copilotPanelCompletion from './copilotPanelCompletion';
import { handleGetVersion } from './getVersion';
import { handleSetEditorInfo } from './setEditorInfo';
import { handleCheckStatus } from './checkStatus';
import { handleCheckFileStatus } from './checkFileStatus';
import { handleSignInInitiate } from './signInInitiate';
import { handleSignInConfirm } from './signInConfirm';
import { handleSignInWithGithubToken } from './signInWithGithubToken';
import { handleSignOut } from './signOut';
import { notifyShown } from './notifyShown';
import { notifyAccepted } from './notifyAccepted';
import { notifyRejected } from './notifyRejected';
import { handleTelemetryException } from './telemetryTrack';
import { handleTelemetryAuthNotifyDismissed } from './telemetry/authNotifyDismissed';
import { handleTelemetryAuthNotifyShown } from './telemetry/authNotifyShown';
import { handleTelemetryGitHubLoginSuccess } from './telemetry/gitHubLoginSuccess';
import { handleTelemetryNewGitHubLogin } from './telemetry/newGitHubLogin';
import { handleTestingOverrideExpFlags } from './testing/overrideExpFlags';
import { handleTestingAlwaysAuth } from './testing/alwaysAuth';
import { handleTestingNeverAuth } from './testing/neverAuth';
import { handleTestingUseTestingToken } from './testing/useTestingToken';
import { handleTestingSetCompletionDocuments } from './testing/setCompletionDocuments';
import { handleTestingSetPanelCompletionDocuments } from './testing/setPanelCompletionDocuments';
import { handleTriggerShowMessage } from './testing/triggerShowMessage';
import { handleTestingGetTelemetry } from './testing/getTelemetry';
import { handleTestingSetTelemetryCapture } from './testing/setTelemetryCapture';
import { handleGetDocument } from './testing/getDocument';
import { handleChatML } from './testing/chatML';
import { handleUninstall } from './uninstall';
import { handleDiagnostics } from './debug/diagnostics';
import { handleListCertificates } from './listCertificates';
import { handleVerifyState } from './verifyState';
import { handleVerifyCertificate } from './verifyCertificate';
import { handleVerifyKerberos } from './verifyKerberos';
import { handleVerifyWorkspaceState } from './verifyWorkspaceState';
import { handleConversationPreconditions } from './conversation/conversationPreconditions';
import { handleConversationPersistence } from './conversation/conversationPersistence';
import { handleConversationCreate } from './conversation/conversationCreate';
import { handleConversationTurn } from './conversation/conversationTurn';
import { handleConversationTurnDelete } from './conversation/conversationTurnDelete';
import { handleConversationDestroy } from './conversation/conversationDestroy';
import { handleConversationRating } from './conversation/conversationRating';
import { handleConversationCodeCopy } from './conversation/conversationCodeCopy';
import { handleConversationCodeInsert } from './conversation/conversationCodeInsert';
import { handleConversationTemplates } from './conversation/conversationTemplates';
import { handleConversationAgents } from './conversation/conversationAgents';
import { handleTestingSetSyntheticTurns } from './testing/setSyntheticTurns';
import { handleMatch, handleFilesForMatch } from './snippy';
import { handleTestingFetch } from './testing/fetch';

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
