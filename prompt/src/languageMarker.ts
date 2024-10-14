// import { TextDocument } from 'vscode-languageserver-types'; // TODO
import { LanguageId, CurrentDocument } from './types.ts';

type CommentMarker = {
  start: string;
  end: string;
};

const languageCommentMarkers: Record<LanguageId, CommentMarker> = {
  abap: { start: '"', end: '' },
  aspdotnet: { start: '<%--', end: '--%>' },
  bat: { start: 'REM', end: '' },
  bibtex: { start: '%', end: '' },
  blade: { start: '#', end: '' },
  BluespecSystemVerilog: { start: '//', end: '' },
  c: { start: '//', end: '' },
  clojure: { start: ';', end: '' },
  coffeescript: { start: '//', end: '' },
  cpp: { start: '//', end: '' },
  csharp: { start: '//', end: '' },
  css: { start: '/*', end: '*/' },
  cuda: { start: '//', end: '' },
  dart: { start: '//', end: '' },
  dockerfile: { start: '#', end: '' },
  dotenv: { start: '#', end: '' },
  elixir: { start: '#', end: '' },
  erb: { start: '<%#', end: '%>' },
  erlang: { start: '%', end: '' },
  fsharp: { start: '//', end: '' },
  go: { start: '//', end: '' },
  graphql: { start: '#', end: '' },
  groovy: { start: '//', end: '' },
  haml: { start: '-#', end: '' },
  handlebars: { start: '{{!', end: '}}' },
  haskell: { start: '--', end: '' },
  hlsl: { start: '//', end: '' },
  html: { start: '<!--', end: '-->' },
  ini: { start: ';', end: '' },
  java: { start: '//', end: '' },
  javascript: { start: '//', end: '' },
  javascriptreact: { start: '//', end: '' },
  jsonc: { start: '//', end: '' },
  jsx: { start: '//', end: '' },
  julia: { start: '#', end: '' },
  kotlin: { start: '//', end: '' },
  latex: { start: '%', end: '' },
  legend: { start: '//', end: '' },
  less: { start: '//', end: '' },
  lua: { start: '--', end: '' },
  makefile: { start: '#', end: '' },
  markdown: { start: '[]: #', end: '' },
  'objective-c': { start: '//', end: '' },
  'objective-cpp': { start: '//', end: '' },
  perl: { start: '#', end: '' },
  php: { start: '//', end: '' },
  powershell: { start: '#', end: '' },
  pug: { start: '//', end: '' },
  python: { start: '#', end: '' },
  ql: { start: '//', end: '' },
  r: { start: '#', end: '' },
  razor: { start: '<!--', end: '-->' },
  ruby: { start: '#', end: '' },
  rust: { start: '//', end: '' },
  sass: { start: '//', end: '' },
  scala: { start: '//', end: '' },
  scss: { start: '//', end: '' },
  shellscript: { start: '#', end: '' },
  slang: { start: '//', end: '' },
  slim: { start: '/', end: '' },
  solidity: { start: '//', end: '' },
  sql: { start: '--', end: '' },
  stylus: { start: '//', end: '' },
  svelte: { start: '<!--', end: '-->' },
  swift: { start: '//', end: '' },
  systemverilog: { start: '//', end: '' },
  terraform: { start: '#', end: '' },
  tex: { start: '%', end: '' },
  typescript: { start: '//', end: '' },
  typescriptreact: { start: '//', end: '' },
  vb: { start: "'", end: '' },
  verilog: { start: '//', end: '' },
  'vue-html': { start: '<!--', end: '-->' },
  vue: { start: '//', end: '' },
  xml: { start: '<!--', end: '-->' },
  xsl: { start: '<!--', end: '-->' },
  yaml: { start: '#', end: '' },
};

const defaultCommentMarker: CommentMarker = { start: '//', end: '' };
const dontAddLanguageMarker: LanguageId[] = ['php', 'plaintext'];
const shebangLines: Record<LanguageId, string> = {
  html: '<!DOCTYPE html>',
  python: '#!/usr/bin/env python3',
  ruby: '#!/usr/bin/env ruby',
  shellscript: '#!/bin/sh',
  yaml: '# YAML data',
};

export function hasLanguageMarker(doc: CurrentDocument): boolean {
  const { source } = doc;
  return source.startsWith('<!DOCTYPE') || source.startsWith('#!');
}

export function comment(content: string, languageId: LanguageId): string {
  const markers = languageCommentMarkers[languageId] || defaultCommentMarker;
  const end = markers.end == '' ? '' : ' ' + markers.end;
  return `${markers.start} ${content}${end || ''}`;
}

// function commentBlockAsSingles(text: string, languageId: string) {
//   if (text === '') return '';
//   let trailingNewline = text.endsWith(`\n`);
//   let commented = (trailingNewline ? text.slice(0, -1) : text)
//     .split(`\n`)
//     .map((line) => comment(line, languageId))
//     .join(`\n`);
//   return trailingNewline ? commented + `\n` : commented;
// }

export function commentBlockAsSingles(block: string, languageId: LanguageId): string {
  return block
    .split('\n')
    .map((line) => comment(line, languageId))
    .join('\n');
}

export function getLanguageMarker(doc: CurrentDocument): string {
  const { languageId } = doc;
  if (dontAddLanguageMarker.includes(languageId) || !hasLanguageMarker(doc)) return '';
  return shebangLines[languageId] ?? comment(`Language: ${languageId}`, languageId);
}

export function getPathMarker(doc: CurrentDocument): string {
  const { relativePath } = doc;
  return relativePath ? comment(`Path: ${relativePath}`, doc.languageId) : '';
}

export function newLineEnded(content: string): string {
  if (content.endsWith('\n')) return content;
  return `${content}\n`;
}
