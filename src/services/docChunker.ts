import { marked } from 'marked';
import type { CodeChunk } from '../lib/types.js';
import { DOC_CHUNK_SIZE_THRESHOLD } from '../lib/config.js';
import { countChunkTokens } from './tokenCounter.js';

interface HeadingFrame {
  depth: number;
  label: string;
}

function stripYamlFrontmatter(content: string): { body: string; lineOffset: number } {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { body: content, lineOffset: 0 };
  }
  const rest = content.slice(3);
  const endUnix = rest.indexOf('\n---\n');
  const endWin = rest.indexOf('\r\n---\r\n');
  let end = -1;
  let closeLen = 0;
  if (endUnix !== -1 && (endWin === -1 || endUnix <= endWin)) {
    end = endUnix;
    closeLen = '\n---\n'.length;
  } else if (endWin !== -1) {
    end = endWin;
    closeLen = '\r\n---\r\n'.length;
  }
  if (end === -1) {
    return { body: content, lineOffset: 0 };
  }
  const after = rest.slice(end + closeLen);
  const consumed = content.slice(0, content.length - after.length);
  const lineOffset = consumed.split(/\r?\n/).length;
  return { body: after.replace(/^\r?\n/, ''), lineOffset };
}

function enterHeading(stack: HeadingFrame[], depth: number, text: string): void {
  const label = `${'#'.repeat(depth)} ${text.trim()}`;
  while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
    stack.pop();
  }
  stack.push({ depth, label });
}

function splitDocSection(
  filePath: string,
  body: string,
  heading: string | null,
  breadcrumb: string | null,
  startLine: number,
): CodeChunk[] {
  const trimmed = body.trim();
  if (!trimmed) return [];

  if (countChunkTokens(trimmed) <= DOC_CHUNK_SIZE_THRESHOLD) {
    return [makeDocChunk(filePath, trimmed, heading, breadcrumb, startLine)];
  }

  const paragraphs = trimmed.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const out: CodeChunk[] = [];
  let buf: string[] = [];
  let bufStartLine = startLine;
  let lineAtParaStart = startLine;

  const flushBuf = () => {
    if (buf.length === 0) return;
    const text = buf.join('\n\n');
    out.push(makeDocChunk(filePath, text, heading, breadcrumb, bufStartLine));
    buf = [];
  };

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi]!;
    const paraLines = para.split(/\r?\n/).length;
    const gapLines = pi < paragraphs.length - 1 ? 2 : 0;
    const combined = buf.length ? `${buf.join('\n\n')}\n\n${para}` : para;

    if (buf.length > 0 && countChunkTokens(combined) > DOC_CHUNK_SIZE_THRESHOLD) {
      flushBuf();
      buf.push(para);
      bufStartLine = lineAtParaStart;
    } else if (buf.length === 0 && countChunkTokens(para) > DOC_CHUNK_SIZE_THRESHOLD) {
      out.push(makeDocChunk(filePath, para, heading, breadcrumb, lineAtParaStart));
    } else {
      if (buf.length === 0) bufStartLine = lineAtParaStart;
      buf.push(para);
    }

    lineAtParaStart += paraLines + gapLines;
  }
  flushBuf();
  return out;
}

function makeDocChunk(
  filePath: string,
  content: string,
  heading: string | null,
  breadcrumb: string | null,
  startLine: number,
): CodeChunk {
  const lines = content.split(/\r?\n/);
  const endLine = lines.length === 0 ? startLine : startLine + lines.length - 1;
  return {
    id: `${filePath}:${startLine - 1}`,
    filePath,
    chunkType: 'file',
    scope: breadcrumb,
    name: heading,
    content,
    startLine,
    endLine,
  };
}

function chunkMarkdown(filePath: string, content: string): CodeChunk[] {
  const { body: stripped, lineOffset } = stripYamlFrontmatter(content);
  const tokens = marked.lexer(stripped);
  const stack: HeadingFrame[] = [];
  const chunks: CodeChunk[] = [];

  let sectionParts: string[] = [];
  let currentH2: string | null = null;
  /** 1-based line in `stripped` where the current section body starts */
  let sectionBodyStartLine = 1;

  const scopeFromStack = (): string | null =>
    stack.length === 0 ? null : stack.map((f) => f.label).join(' > ');

  const flushSection = () => {
    const body = sectionParts.join('');
    if (!body.trim()) {
      sectionParts = [];
      return;
    }
    const startLine = lineOffset + sectionBodyStartLine;
    const scopeStr = scopeFromStack();
    chunks.push(
      ...splitDocSection(filePath, body, currentH2, scopeStr, startLine),
    );
    sectionParts = [];
  };

  let searchFrom = 0;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.type === 'heading') {
      const depth = (t as { depth: number; text: string; raw: string }).depth;
      const text = (t as { text: string }).text;
      const raw = (t as { raw: string }).raw;

      if (depth === 2) {
        flushSection();
        enterHeading(stack, depth, text);
        currentH2 = text.trim();
        const idx = stripped.indexOf(raw, searchFrom);
        searchFrom = idx === -1 ? searchFrom : idx + raw.length;
        if (idx !== -1) {
          const bodyStart = idx + raw.length;
          sectionBodyStartLine = stripped.slice(0, bodyStart).split(/\r?\n/).length + 1;
        } else {
          sectionBodyStartLine = 1;
        }
        sectionParts = [];
        i += 1;
        continue;
      }

      enterHeading(stack, depth, text);
      sectionParts.push(raw);
      i += 1;
      continue;
    }

    sectionParts.push(t.raw);
    i += 1;
  }

  flushSection();

  return chunks;
}

function chunkPlainText(filePath: string, content: string): CodeChunk[] {
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) {
    const t = content.trim();
    if (!t) return [];
    return splitDocSection(filePath, t, null, null, 1);
  }

  const chunks: CodeChunk[] = [];
  let lineAtParaStart = 1;
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi]!;
    const paraLines = para.split(/\r?\n/).length;
    const gapLines = pi < paragraphs.length - 1 ? 2 : 0;
    chunks.push(...splitDocSection(filePath, para, null, null, lineAtParaStart));
    lineAtParaStart += paraLines + gapLines;
  }
  return chunks;
}

export function chunkDocFile(filePath: string, content: string, ext: string): CodeChunk[] {
  if (ext === '.md') return chunkMarkdown(filePath, content);
  if (ext === '.txt' || ext === '.rst') return chunkPlainText(filePath, content);
  return [];
}
