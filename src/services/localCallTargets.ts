import type { Node } from 'web-tree-sitter';
import type { CallEdge, CodeChunk } from '../lib/types.js';

export interface DirectCall {
  target: Node;
  edge: CallEdge;
}

export function resolveLocalCallTargets(
  nodes: Node[],
  chunksByNode: ReadonlyMap<number, CodeChunk>,
  calls: DirectCall[],
): void {
  if (nodes.some(node => node.type === 'with_statement'
    || (node.type === 'call_expression' && node.childForFieldName('function')?.text === 'eval'))) return;

  const candidates = new Map<string, { chunk: CodeChunk; binding: Node }>();
  const ambiguous = new Set<string>();
  const names = new Set<string>();
  for (const chunk of chunksByNode.values()) {
    if (!chunk.name) continue;
    if (names.has(chunk.name)) ambiguous.add(chunk.name);
    names.add(chunk.name);
  }
  for (const node of nodes) {
    const chunk = chunksByNode.get(node.id);
    if (!chunk?.name || chunk.chunkType !== 'function') continue;
    const declaration = node.type === 'arrow_function' ? node.parent : node;
    const binding = declaration?.childForFieldName('name');
    let container = declaration?.parent;
    if (node.type === 'arrow_function') {
      if (container?.type !== 'lexical_declaration' || container.firstChild?.type !== 'const') continue;
      container = container.parent;
    } else if (!['function_declaration', 'generator_function_declaration'].includes(node.type)) {
      continue;
    }
    if (container?.type === 'export_statement') container = container.parent;
    if (container?.type !== 'program' || binding?.type !== 'identifier') continue;
    if (candidates.has(chunk.name)) ambiguous.add(chunk.name);
    candidates.set(chunk.name, { chunk, binding });
  }

  for (const node of nodes) {
    if (!['identifier', 'type_identifier', 'shorthand_property_identifier_pattern', 'shorthand_property_identifier'].includes(node.type)) continue;
    const candidate = candidates.get(node.text);
    if (!candidate || node.id === candidate.binding.id) continue;
    const isDirectCall = node.parent?.type === 'call_expression'
      && node.parent.childForFieldName('function')?.id === node.id;
    if (!isDirectCall) ambiguous.add(node.text);
  }

  for (const { target, edge } of calls) {
    const candidate = candidates.get(target.text);
    if (candidate && !ambiguous.has(target.text)) edge.toFile = candidate.chunk.filePath;
  }
}
