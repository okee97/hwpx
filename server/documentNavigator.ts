/**
 * Document Navigator & Document IR Engine
 *
 * Provides intelligent search, navigation, and context retrieval over parsed HWP/HWPX documents.
 * Allows AI Reviewers and Specialists to explore the document autonomously rather than
 * being limited to pre-sliced fixed-length head blocks.
 */

import { DocumentBlock } from '../src/types/finding';
import { TableMatrix } from './rhwpAdapter';

export interface DocumentSectionNode {
  section_id: string;
  title: string;
  level: number;
  block_ids: string[];
  subsections?: DocumentSectionNode[];
}

export interface DocumentOutline {
  title: string;
  sections: Array<{
    id: string;
    title: string;
    level: number;
    block_count: number;
    start_block_id?: string;
  }>;
  total_blocks: number;
  total_tables: number;
}

export interface SearchBlockMatch {
  block_id: string;
  block_type: string;
  text: string;
  score: number;
  matched_keywords: string[];
  location?: {
    section_index?: number;
    paragraph_index?: number;
    table_index?: number;
  };
  section_title?: string;
}

export interface DocumentNavigatorIndex {
  blocks: DocumentBlock[];
  tables: TableMatrix[];
  outline: DocumentOutline;
  rawText: string;
  blockMap: Map<string, DocumentBlock>;
  tableMap: Map<string, TableMatrix>;
  blockIndex: Map<string, number>; // block_id -> index in array
}

/**
 * Normalizes Korean and alphanumeric search strings for index tokenization.
 */
function tokenize(text: string): string[] {
  if (!text) return [];
  // Tokenize by whitespace, punctuation, and common delimiters
  const clean = text.replace(/[^\w가-힣0-9\s]/g, ' ');
  const rawTokens = clean.split(/\s+/).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 1);
  
  // Add 2-gram character combinations for CJK sub-word matching
  const ngrams: string[] = [];
  for (const token of rawTokens) {
    if (token.length >= 2 && /[가-힣]/.test(token)) {
      for (let i = 0; i < token.length - 1; i++) {
        ngrams.push(token.slice(i, i + 2));
      }
    }
  }
  return Array.from(new Set([...rawTokens, ...ngrams]));
}

/**
 * Builds an inverted index and navigation structures for a given set of document blocks and tables.
 */
export function buildDocumentIndex(
  blocks: DocumentBlock[],
  tables: TableMatrix[] = [],
  rawText: string = '',
  rawStructure: any = null
): DocumentNavigatorIndex {
  const blockMap = new Map<string, DocumentBlock>();
  const tableMap = new Map<string, TableMatrix>();
  const blockIndex = new Map<string, number>();

  blocks.forEach((b, idx) => {
    blockMap.set(b.block_id, b);
    blockIndex.set(b.block_id, idx);
  });

  tables.forEach((t) => {
    tableMap.set(t.table_id, t);
  });

  // Infer outline from headers or rawStructure
  const sections: DocumentOutline['sections'] = [];
  let currentSectionTitle = '문서 시작';
  let currentSectionId = 'sec_0';
  let blockCountInCurrent = 0;
  let startBlockId = blocks[0]?.block_id;

  // Regex to detect chapter/section headers in Korean public procurement documents
  const headerRegex = /^([0-9]+[.\-]|제[0-9]+[장절조항편]|Ⅰ|Ⅱ|Ⅲ|Ⅳ|Ⅴ|Ⅵ|Ⅶ|Ⅷ|Ⅸ|Ⅹ|I\.|II\.|III\.|IV\.|V\.|VI\.|[1-9]\.|[가-하]\.|\([1-9]\)|\([가-하]\)|\[.+?\])\s*(.+)/;

  blocks.forEach((b, idx) => {
    const text = b.text.trim();
    const isHeader = b.block_type === 'HEADING' || (text.length <= 40 && headerRegex.test(text));

    if (isHeader && text.length > 2) {
      if (blockCountInCurrent > 0) {
        sections.push({
          id: currentSectionId,
          title: currentSectionTitle,
          level: 1,
          block_count: blockCountInCurrent,
          start_block_id: startBlockId,
        });
      }
      currentSectionId = `sec_${sections.length + 1}`;
      currentSectionTitle = text;
      blockCountInCurrent = 1;
      startBlockId = b.block_id;
    } else {
      blockCountInCurrent++;
    }
  });

  if (blockCountInCurrent > 0) {
    sections.push({
      id: currentSectionId,
      title: currentSectionTitle,
      level: 1,
      block_count: blockCountInCurrent,
      start_block_id: startBlockId,
    });
  }

  const outline: DocumentOutline = {
    title: blocks[0]?.text?.slice(0, 60) || '제안요청서',
    sections,
    total_blocks: blocks.length,
    total_tables: tables.length,
  };

  return {
    blocks,
    tables,
    outline,
    rawText: rawText || blocks.map((b) => b.text).join('\n'),
    blockMap,
    tableMap,
    blockIndex,
  };
}

/**
 * Document Navigator Class providing query APIs to AI Agents.
 */
export class DocumentNavigator {
  private index: DocumentNavigatorIndex;

  constructor(index: DocumentNavigatorIndex) {
    this.index = index;
  }

  /**
   * Search blocks by query keywords using semantic-friendly TF-IDF scoring.
   */
  searchBlocks(
    query: string,
    options: {
      limit?: number;
      blockTypes?: string[];
      minScore?: number;
      preferSections?: string[];
    } = {}
  ): SearchBlockMatch[] {
    const { limit = 8, blockTypes, minScore = 0.5 } = options;
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const matches: SearchBlockMatch[] = [];

    for (let idx = 0; idx < this.index.blocks.length; idx++) {
      const block = this.index.blocks[idx];
      if (blockTypes && !blockTypes.includes(block.block_type)) {
        continue;
      }

      const text = block.text;
      if (!text || text.trim().length === 0) continue;

      const lowerText = text.toLowerCase();
      let matchScore = 0;
      const matchedKeywords: string[] = [];

      // 1. Exact phrase match bonus
      if (query.length >= 3 && lowerText.includes(query.toLowerCase())) {
        matchScore += 10.0;
        matchedKeywords.push(query);
      }

      // 2. Token overlap score
      for (const token of queryTokens) {
        if (lowerText.includes(token)) {
          // Longer token matches carry exponentially higher weight
          const weight = token.length >= 4 ? 3.0 : token.length >= 2 ? 1.5 : 0.5;
          matchScore += weight;
          if (!matchedKeywords.includes(token)) {
            matchedKeywords.push(token);
          }
        }
      }

      // 3. Table cells or headers bonus if query has tabular keywords
      if (block.block_type === 'TABLE_CELL' && (query.includes('금액') || query.includes('예산') || query.includes('배점') || query.includes('실적'))) {
        matchScore *= 1.2;
      }

      if (matchScore >= minScore) {
        matches.push({
          block_id: block.block_id,
          block_type: block.block_type,
          text: block.text,
          score: Math.round(matchScore * 10) / 10,
          matched_keywords: matchedKeywords,
          location: block.native_locator,
        });
      }
    }

    // Sort by relevance score descending
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit);
  }

  /**
   * Get a single block by its ID.
   */
  getBlock(blockId: string): DocumentBlock | null {
    return this.index.blockMap.get(blockId) || null;
  }

  /**
   * Retrieve neighboring blocks around a specified block_id to read preceding and succeeding context.
   */
  getNeighbors(
    blockId: string,
    radius: number = 2
  ): { target: DocumentBlock | null; before: DocumentBlock[]; after: DocumentBlock[]; fullContext: string } {
    const idx = this.index.blockIndex.get(blockId);
    if (idx === undefined) {
      return { target: null, before: [], after: [], fullContext: '' };
    }

    const startIdx = Math.max(0, idx - radius);
    const endIdx = Math.min(this.index.blocks.length - 1, idx + radius);

    const before = this.index.blocks.slice(startIdx, idx);
    const target = this.index.blocks[idx];
    const after = this.index.blocks.slice(idx + 1, endIdx + 1);

    const fullContext = [...before, target, ...after].map((b) => `[${b.block_id}] ${b.text}`).join('\n');

    return { target, before, after, fullContext };
  }

  /**
   * Retrieve all blocks belonging to or related to a section title or outline keyword.
   */
  getSection(sectionIdOrKeyword: string): { title: string; blocks: DocumentBlock[]; text: string } | null {
    // 1. Direct section_id match
    const sec = this.index.outline.sections.find(
      (s) => s.id === sectionIdOrKeyword || s.title.toLowerCase().includes(sectionIdOrKeyword.toLowerCase())
    );

    if (!sec) {
      return null;
    }

    const startIdx = sec.start_block_id ? this.index.blockIndex.get(sec.start_block_id) ?? 0 : 0;
    const endIdx = Math.min(this.index.blocks.length, startIdx + sec.block_count);
    const blocks = this.index.blocks.slice(startIdx, endIdx);

    return {
      title: sec.title,
      blocks,
      text: blocks.map((b) => b.text).join('\n'),
    };
  }

  /**
   * Search tables by title or cell content with token-based OR scoring.
   * Multi-keyword queries like "사업예산 추정가격 소요" match any tables containing those tokens.
   */
  searchTables(query: string, limit: number = 3): TableMatrix[] {
    if (!query || !query.trim()) return [];
    const lowerQuery = query.toLowerCase().trim();
    const tokens = tokenize(query);
    const rawWords = query.split(/\s+/).map((w) => w.trim().toLowerCase()).filter((w) => w.length > 1);
    const allSearchTokens = Array.from(new Set([...tokens, ...rawWords]));

    const results: Array<{ table: TableMatrix; score: number }> = [];

    for (const table of this.index.tables) {
      let score = 0;
      const captionLower = (table.caption || '').toLowerCase();

      // 1. Full phrase match bonus in caption
      if (query.length >= 3 && captionLower.includes(lowerQuery)) {
        score += 20;
      }

      // 2. Token matches in caption
      for (const token of allSearchTokens) {
        if (captionLower.includes(token)) {
          score += token.length >= 4 ? 8 : 4;
        }
      }

      // 3. Token matches in table rows/cells
      for (const row of table.rows) {
        for (const cell of row) {
          if (!cell) continue;
          const cellLower = cell.toLowerCase();
          if (query.length >= 3 && cellLower.includes(lowerQuery)) {
            score += 10;
          }
          for (const token of allSearchTokens) {
            if (cellLower.includes(token)) {
              score += token.length >= 4 ? 3 : 1;
            }
          }
        }
      }

      if (score > 0) {
        results.push({ table, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map((r) => r.table);
  }

  /**
   * Get a full table by ID.
   */
  getTable(tableId: string): TableMatrix | null {
    return this.index.tableMap.get(tableId) || null;
  }

  /**
   * Get document outline (table of contents and section overview).
   */
  getDocumentOutline(): DocumentOutline {
    return this.index.outline;
  }

  /**
   * Executes a tool dynamically for an Agent.
   */
  executeTool(toolName: string, args: Record<string, any>): any {
    switch (toolName) {
      case 'search_blocks':
        return this.searchBlocks(args.query || '', {
          limit: args.limit || 8,
          blockTypes: args.block_types,
          minScore: args.min_score,
        });

      case 'get_block':
        return this.getBlock(args.block_id || '');

      case 'get_neighbors':
        return this.getNeighbors(args.block_id || '', args.radius ?? 2);

      case 'get_section':
        return this.getSection(args.section || args.keyword || '');

      case 'search_tables':
        return this.searchTables(args.query || '', args.limit || 3);

      case 'get_table':
        return this.getTable(args.table_id || '');

      case 'get_document_outline':
        return this.getDocumentOutline();

      default:
        return { error: `알 수 없는 도구: ${toolName}` };
    }
  }
}
