import { Logger, LogLevel } from '../logger.ts';
import { FeatureName } from './constants.ts';

const codeReferenceLogger = new Logger(LogLevel.INFO, FeatureName);

export { codeReferenceLogger };
