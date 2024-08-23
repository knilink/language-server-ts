import { Context } from '../context';

class RuntimeMode {
  constructor(public flags: Flags) { }

  static fromEnvironment(
    isRunningInTest: boolean,
    argv = process.argv as string[],
    env = process.env as Record<string, string>
  ) {
    return new RuntimeMode({
      debug: determineDebugFlag(argv, env),
      verboseLogging: determineVerboseLoggingEnabled(argv, env),
      testMode: isRunningInTest,
      simulation: determineSimulationFlag(env),
    });
  }
}

interface Flags {
  debug: boolean;
  verboseLogging: boolean;
  testMode: boolean;
  simulation: boolean;
}

function isRunningInTest(ctx: Context): boolean {
  return ctx.get(RuntimeMode).flags.testMode;
}

function shouldFailForDebugPurposes(ctx: Context): boolean {
  return isRunningInTest(ctx);
}

function isDebugEnabled(ctx: Context): boolean {
  return ctx.get(RuntimeMode).flags.debug;
}

function isVerboseLoggingEnabled(ctx: Context): boolean {
  return ctx.get(RuntimeMode).flags.verboseLogging;
}

function determineDebugFlag(argv: string[], env: Record<string, string>): boolean {
  return argv.includes('--debug') || determineEnvFlagEnabled(env, 'DEBUG');
}

function determineSimulationFlag(env: Record<string, string>): boolean {
  return determineEnvFlagEnabled(env, 'SIMULATION');
}

function isRunningInSimulation(ctx: Context): boolean {
  return ctx.get(RuntimeMode).flags.simulation;
}

function determineVerboseLoggingEnabled(argv: string[], env: Record<string, string>): boolean {
  const verboseValue = env.COPILOT_AGENT_VERBOSE || '';
  return (
    verboseValue === '1' ||
    verboseValue.toLowerCase() === 'true' ||
    determineEnvFlagEnabled(env, 'VERBOSE') ||
    determineDebugFlag(argv, env)
  );
}

function determineEnvFlagEnabled(env: Record<string, string>, name: string): boolean {
  const prefixes = ['GH_COPILOT_', 'GITHUB_COPILOT_'];
  for (const prefix of prefixes) {
    const key = `${prefix}${name}`;
    if (env[key]) return env[key] === '1' || env[key].toLowerCase() === 'true';
  }
  return false;
}

export {
  Context,
  RuntimeMode,
  Flags,
  isRunningInTest,
  shouldFailForDebugPurposes,
  isDebugEnabled,
  isVerboseLoggingEnabled,
  determineDebugFlag,
  determineSimulationFlag,
  isRunningInSimulation,
  determineVerboseLoggingEnabled,
  determineEnvFlagEnabled,
};
