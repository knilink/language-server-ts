import {
  isEmptyBlockStart,
  isBlockBodyFinished,
  getNodeStart,
  isSupportedLanguageId,
  getBlockCloseToken,
  getPrompt,
} from "../../../prompt/src/lib.ts";

('use strict');

const workerFuns = ['isEmptyBlockStart', 'isBlockBodyFinished', 'getNodeStart'];
const directFuns = ['isSupportedLanguageId', 'getBlockCloseToken', 'getPrompt'];
const allFuns = [...workerFuns, ...directFuns];

const promptLibProxy = {
  isEmptyBlockStart,
  isBlockBodyFinished,
  getNodeStart,
  isSupportedLanguageId,
  getBlockCloseToken,
  getPrompt,
};

export { workerFuns, directFuns, allFuns, promptLibProxy };
