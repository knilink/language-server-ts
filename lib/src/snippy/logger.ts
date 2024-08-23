import { Logger, LogLevel } from '../logger';
import { FeatureName } from './constants';

const codeReferenceLogger = new Logger(LogLevel.INFO, FeatureName);

export { codeReferenceLogger };
