import * as os from 'os';

import { URI } from 'vscode-uri';

import { Context } from '../context.ts';
import { RepositoryManager } from './repositoryManager.ts';
import { FileSystem } from '../fileSystem.ts';
import { Logger, LogLevel } from '../logger.ts';
import { GitConfigData, GitConfigLoader } from './config.ts';
import { basename, dirname, joinPath, resolveFilePath } from '../util/uri.ts';

const logger = new Logger('repository');
const esc = '\\\\';
const comment = '(?:[#;].*)';
const stringChar = `(?:[^"${esc}]|${esc}.)`;
const keyChar = '[0-9A-Za-z-]';
const configKey = `[A-Za-z]${keyChar}*`;
const configValueTerminator = `\\s*${comment}?$`;
const valueChar = `(?:[^"${esc};#]|${esc}.)`;
const valueString = `(?:"${stringChar}*"|"${stringChar}*(?<strCont>${esc})$)`;
const value = `(?:${valueChar}|${valueString})+`;
const continuation = `(?:(?<cont>${esc})$)`;
const configValue = `(?<value>${value})${continuation}?${configValueTerminator}`;
const continuedValueRegex = new RegExp(`^${configValue}`);
const continuedStringRegex = new RegExp(`^(?<value>${stringChar}*(?:(?<strCont>${esc})$|(?<quote>")))`);
const configPairRegex = new RegExp(
  `^\\s*(?:(?<key>${configKey})\\s*=\\s*${configValue}|(?<soloKey>${configKey})${configValueTerminator})`
);
const valueSearchRegex = new RegExp(`(?<value>${valueChar}+)|"(?<string>${stringChar}*)"`, 'g');
const simpleVar = '[-.0-9A-Za-z]+';
const extendedVar = `\\s+"(?<ext>${stringChar}*)"`;
const extendedVarOnly = `\\s+"(?<extOnly>${stringChar}*)"`;
const sectionRegex = new RegExp(
  `^\\s*\\[(?:(?<simple>${simpleVar})${extendedVar}|${extendedVarOnly}|(?<simpleOnly>${simpleVar}))\\]`
);
const commentRegex = new RegExp(`^\\s*${comment}$`);

class GitConfigParser {
  stopped: boolean = false;
  section: string = '';
  line: string = '';
  lineNum: number = 0;
  lines: string[] = [];
  linesWithErrors: number[] = [];
  configValueHandler?: (name: string, value: string) => void;

  constructor(readonly content: string) {}

  parse(configValueHandler: (name: string, value: string) => void): void {
    this.stopped = false;
    this.section = '';
    this.line = '';
    this.linesWithErrors = [];
    this.configValueHandler = configValueHandler;
    this.lines = this.content.split(os.EOL);

    for (this.lineNum = 0; !this.stopped && this.lineNum < this.lines.length; this.lineNum++) {
      this.line = this.lines[this.lineNum];
      this.parseSectionStart();
      this.parseConfigPair();
      this.parseComment();
      if (!/^\s*$/.test(this.line)) {
        this.errorAt(this.lineNum + 1);
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }

  hasErrors(): boolean {
    return this.linesWithErrors.length > 0;
  }

  errorAt(lineNum: number): void {
    this.linesWithErrors.push(lineNum);
  }

  parseSectionStart(): void {
    const match = this.line.match(sectionRegex);
    if (match) {
      const groups = match.groups;
      if (groups?.simple) {
        this.section = groups.simple.toLowerCase() + '.' + this.unescapeBaseValue(match.groups!.ext);
      } else if (groups?.extOnly) {
        this.section = '.' + this.unescapeBaseValue(groups.extOnly);
      } else if (groups?.simpleOnly) {
        this.section = groups.simpleOnly.toLowerCase();
      } else {
        throw new Error('Should no reach here');
      }
    }
  }

  unescapeBaseValue(value: string): string {
    return value.replace(/\\(.)/g, '$1');
  }

  parseConfigPair(): void {
    const match = this.line.match(configPairRegex);
    if (match) {
      const groups = match.groups;
      if (groups?.key) {
        const value = this.handleContinued(match);
        this.configValueHandler?.(`${this.nameWithSection(groups.key.toLowerCase())}`, value);
      } else if (groups?.soloKey) {
        this.configValueHandler?.(`${this.nameWithSection(groups.soloKey.toLowerCase())}`, '');
      }
      this.line = '';
    }
  }

  handleContinued(lastMatch: RegExpMatchArray) {
    let match: RegExpMatchArray | null = lastMatch;
    const values = [this.matchedValue(match)];
    while (match?.groups?.count || match?.groups?.strCount) {
      this.line = this.lines[++this.lineNum];
      if (this.lineNum >= this.lines.length) {
        this.errorAt(this.lineNum);
        break;
      }

      if (match.groups.strCont) {
        match = this.line.match(continuedStringRegex);
        if (match) {
          values.push(this.matchedValue(match));
          if (match.groups?.quote) {
            match = this.line.slice(match[0].length).match(continuedValueRegex);
            if (match) {
              values.push(this.matchedValue(match));
            } else {
              this.errorAt(this.lineNum + 1);
            }
          }
        } else {
          this.errorAt(this.lineNum + 1);
        }
      } else {
        match = this.line.match(continuedValueRegex);
        if (match) {
          values.push(this.matchedValue(match));
        } else {
          this.errorAt(this.lineNum + 1);
        }
      }
    }

    return this.normalizeValue(values.join(''));
  }

  matchedValue(match: RegExpMatchArray): string {
    const groups = match.groups!;
    return groups.strCont ? groups.value.slice(0, -1) : groups.value;
  }

  normalizeValue(value: string): string {
    let trimEnd = false;
    const normalized = [...value.matchAll(valueSearchRegex)]
      .map((match) => {
        const groups = match.groups!;
        trimEnd = !!match.groups?.value;
        return this.unescapeValue(trimEnd ? groups.value.replace(/\s/g, ' ') : groups.string);
      })
      .join('');
    return trimEnd ? normalized.trimEnd() : normalized;
  }

  unescapeValue(value: string): string {
    const replacements: Record<string, string> = {
      n: `\n`,
      t: '\t',
      b: '\b',
    };
    return value.replace(/\\(.)/g, (_match, char) => replacements[char] || char);
  }

  nameWithSection(name: string): string {
    return this.section ? `${this.section}.${name}` : name;
  }

  parseComment(): void {
    if (commentRegex.test(this.line)) {
      this.line = '';
    }
  }
}

class GitParsingConfigLoader extends GitConfigLoader {
  async getConfig(ctx: Context, baseFolder: URI): Promise<GitConfigData | undefined> {
    const configFile = await RepositoryManager.getRepoConfigLocation(ctx, baseFolder);
    if (!configFile) return;
    const config = await this.getParsedConfig(ctx, configFile);
    if (config) return this.mergeConfig(await this.baseConfig(ctx, configFile), config);
  }

  mergeConfig(...configs: Array<GitConfigData | undefined>): GitConfigData {
    return configs
      .filter((c): c is GitConfigData => c !== undefined)
      .reduce((merged, config) => merged.concat(config), new GitConfigData());
  }

  async getParsedConfig(ctx: Context, configFile: URI, warnIfNotExists = true): Promise<GitConfigData | undefined> {
    const configData = await this.tryLoadConfig(ctx, configFile, warnIfNotExists);
    if (!configData) return;
    const parser = new GitConfigParser(configData);
    const config = new GitConfigData();
    parser.parse((name, value) => config.add(name, value));
    return config;
  }

  async tryLoadConfig(ctx: Context, configFile: URI, warnIfNotExists: boolean): Promise<string | undefined> {
    try {
      return await ctx.get(FileSystem).readFileString(configFile);
    } catch (e) {
      if (warnIfNotExists || !(e instanceof Error) || (e as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(ctx, `Failed to load git config from ${configFile.toString()}:`, e);
      }
    }
  }

  async baseConfig(ctx: Context, baseConfigFile: URI): Promise<GitConfigData> {
    const commonUri = await this.commondirConfigUri(ctx, baseConfigFile);
    const xdgUri = joinPath(this.xdgConfigUri(), 'git', 'config');
    const userUri = joinPath(this.homeUri(), '.gitconfig');
    return this.mergeConfig(
      await this.getParsedConfig(ctx, xdgUri, false),
      await this.getParsedConfig(ctx, userUri, false),
      commonUri ? await this.getParsedConfig(ctx, commonUri, false) : undefined
    );
  }

  async commondirConfigUri(ctx: Context, baseConfigFile: URI): Promise<URI | undefined> {
    if (basename(baseConfigFile).toLowerCase() !== 'config.worktree') return;
    const dir = dirname(baseConfigFile);
    const commondirFile = joinPath(dir, 'commondir');
    try {
      const commondirPath = (await ctx.get(FileSystem).readFileString(commondirFile)).trimEnd();
      return joinPath(resolveFilePath(dir, commondirPath), 'config');
    } catch {
      return;
    }
  }

  xdgConfigUri(): URI {
    return process.env.XDG_CONFIG_HOME ? URI.file(process.env.XDG_CONFIG_HOME) : joinPath(this.homeUri(), '.config');
  }

  homeUri(): URI {
    return URI.file(os.homedir());
  }
}

export { GitConfigParser, GitParsingConfigLoader };
