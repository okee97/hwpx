import { DocumentNavigator } from '../documentNavigator';
import { generateContentWithFallback } from '../geminiClient';
import {
  ExplorerDossier,
  ExplorerEvidenceCandidate,
  ToolCallRequest,
  METADATA_MODELS,
} from './metadataSchemas';

interface ExplorerTurnResult {
  tool_calls?: ToolCallRequest[];
  is_complete?: boolean;
  dossier?: ExplorerDossier;
}

/**
 * AI Stage 1: Metadata Explorer
 *
 * Iteratively navigates the document using DocumentNavigator tools to locate
 * high-value evidence for all public procurement metadata domains.
 */
export class MetadataExplorer {
  private navigator: DocumentNavigator;
  private maxRounds: number = 3;
  private maxToolsPerRound: number = 8;
  private totalToolCallCap: number = 18;

  constructor(navigator: DocumentNavigator) {
    this.navigator = navigator;
  }

  /**
   * Runs the autonomous exploration loop up to maxRounds or until completion.
   */
  async explore(options: {
    projectId: string;
    fileName?: string;
    focusQueries?: string[];
  }): Promise<{ dossier: ExplorerDossier; roundsRun: number; toolCallsCount: number; modelUsed?: string }> {
    const outline = this.navigator.getDocumentOutline();
    let totalToolCalls = 0;
    let roundsRun = 0;
    let modelUsed: string | undefined;

    // Track all retrieved blocks so far to feed back to the Explorer
    const explorationHistory: Array<{
      round: number;
      tool: string;
      args: any;
      summary: string;
    }> = [];

    // Pre-populate initial high-signal context
    const initialOverview = this.navigator.searchBlocks(
      '사업명 과업명 발주기관 수요기관 계약방법 입찰방법 사업예산 사업기간',
      { limit: 5 }
    );
    const initialTables = this.navigator.searchTables('사업 개요 예산 금액 기간', 3);

    let currentDossier: ExplorerDossier | null = null;

    for (let round = 1; round <= this.maxRounds; round++) {
      roundsRun = round;
      if (totalToolCalls >= this.totalToolCallCap) break;

      const systemInstruction = `당신은 대한민국 공공입찰 제안요청서(RFP) 정밀 탐색 에이전트 [Metadata Explorer v4]입니다.
당신의 임무는 문서 탐색 도구(Document Navigator)를 활용하여 사업정보 추출에 필요한 원문 근거(Block ID, 원문 Quote)를 발굴하는 것입니다.

[탐색해야 할 6대 핵심 도메인]
1. project_identity: 사업명/과업명
2. agency: 수요기관(실사용부서/지자체 등), 계약/공고기관(조달청 또는 자체발주 등 구분)
3. budget: 사업예산(총사업비) vs 추정가격(부가세 제외 여부) vs 기초금액 구분
4. competition_method: 경쟁방법(일반경쟁, 제한경쟁, 수의계약 등)
5. award_method: 낙찰자결정방법(협상에 의한 계약, 적격심사 등)
6. period: 사업기간(착수일로부터 N개월/일 또는 확정일자)

[사용 가능한 도구 목록]
- get_document_outline: 문서 목차/섹션 구조 확인
- search_blocks(query, limit): 키워드/자연어 쿼리로 문단 검색 (limit 최대 8)
- get_block(block_id): 특정 블록의 전체 원문 조회
- get_neighbors(block_id, radius): 특정 블록 전후 문맥 문단 조회 (radius 1~3)
- get_section(section): 특정 섹션 전체 블록 조회
- search_tables(query, limit): 표(Table) 검색 (limit 최대 3)
- get_table(table_id): 표 전체 행/열 데이터 조회

[응답 형식 - 반드시 유효한 JSON]
- 도구를 추가로 호출하여 문맥을 더 확인해야 하는 경우:
{
  "is_complete": false,
  "tool_calls": [
    { "tool": "search_blocks", "args": { "query": "입찰참가자격 또는 사업예산" }, "reason": "계약방법 및 예산 확인을 위해 검색" }
  ]
}
(한 라운드당 최대 8개 도구 호출 가능)

- 충분한 근거를 확보하여 탐색을 완료하는 경우:
{
  "is_complete": true,
  "dossier": {
    "project_identity": [{ "block_id": "...", "quote": "실제 원문 인용", "reason": "사업명 명시" }],
    "agency": [{ "block_id": "...", "quote": "실제 원문 인용", "reason": "수요기관/계약기관 명시" }],
    "budget": [{ "block_id": "...", "quote": "실제 원문 인용", "reason": "사업예산 금액 명시" }],
    "competition_method": [{ "block_id": "...", "quote": "실제 원문 인용", "reason": "경쟁형태 명시" }],
    "award_method": [{ "block_id": "...", "quote": "실제 원문 인용", "reason": "낙찰자 결정방식 명시" }],
    "period": [{ "block_id": "...", "quote": "실제 원문 인용", "reason": "사업기간 명시" }]
  }
}

[절대 주의사항]
- 존재하지 않는 블록 ID나 원문에 없는 문구를 날조하지 마십시오.
- 인용(quote)은 도구 결과로 반환된 실제 문단 텍스트의 일부분이어야 합니다.
- 조건부 문구(예: "유찰 시 수의계약")와 본계약 입찰방법을 혼동하지 마십시오.`;

      const userPrompt = `[문서 개요]
제목/파일명: ${options.fileName || '제안요청서'}
총 블록 수: ${outline.total_blocks}개, 총 표 수: ${outline.total_tables}개
문서 주요 목차:
${outline.sections.slice(0, 15).map((s) => `- ${s.title} (블록 ${s.block_count}개, ID: ${s.start_block_id})`).join('\n')}

[현재 탐색 라운드: ${round}/${this.maxRounds}]
${options.focusQueries ? `[추가 집중 탐색 요구]: ${options.focusQueries.join(', ')}\n` : ''}

[초기 자동 발견 블록 요약]:
${initialOverview.map((b) => `[${b.block_id}] ${b.text.slice(0, 120)}`).join('\n')}

${
  initialTables.length > 0
    ? `[발견된 주요 표]:\n` +
      initialTables
        .map(
          (t) =>
            `[표 ${t.table_id}: ${t.caption}] 첫 행: ${t.rows[0]?.slice(0, 4).join(' | ')}`
        )
        .join('\n')
    : ''
}

[이전 도구 실행 기록]:
${
  explorationHistory.length === 0
    ? '아직 도구 실행 기록이 없습니다.'
    : explorationHistory.map((h) => `- R${h.round} [${h.tool}] (${JSON.stringify(h.args)}): ${h.summary}`).join('\n')
}

다음 작업을 수행하십시오. 추가 도구 조회가 필요하면 tool_calls를 반환하고, 충분하면 dossier를 완성하십시오.`;

      try {
        const { text, modelUsed: usedModel } = await generateContentWithFallback(
          {
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            config: {
              // @ts-ignore
              systemInstruction,
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          },
          METADATA_MODELS.explorer,
          20000
        );

        modelUsed = usedModel;
        const cleaned = text.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
        const parsed: ExplorerTurnResult = JSON.parse(cleaned);

        if (parsed.is_complete && parsed.dossier) {
          currentDossier = sanitizeDossier(parsed.dossier);
          break;
        }

        if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
          const callsToExecute = parsed.tool_calls.slice(0, this.maxToolsPerRound);
          for (const tc of callsToExecute) {
            totalToolCalls++;
            let toolRes: any;
            try {
              toolRes = this.navigator.executeTool(tc.tool, tc.args || {});
            } catch (te: any) {
              toolRes = { error: te?.message || String(te) };
            }

            let summary = '';
            if (Array.isArray(toolRes)) {
              summary = `${toolRes.length}건 결과. ` + toolRes.slice(0, 2).map((r: any) => `[${r.block_id || r.table_id}] ${(r.text || r.caption || '').slice(0, 60)}`).join('; ');
            } else if (toolRes && typeof toolRes === 'object') {
              summary = toolRes.text ? `[${toolRes.block_id}] ${toolRes.text.slice(0, 80)}` : JSON.stringify(toolRes).slice(0, 100);
            }

            explorationHistory.push({
              round,
              tool: tc.tool,
              args: tc.args,
              summary: summary || '결과 없음',
            });
          }
        } else if (parsed.dossier) {
          currentDossier = sanitizeDossier(parsed.dossier);
          break;
        } else {
          // If neither tool_calls nor dossier, end exploration
          break;
        }
      } catch (err: any) {
        console.warn(`[MetadataExplorer Round ${round} Warning]`, err?.message || err);
        break;
      }
    }

    // Fallback if AI Explorer produced nothing
    if (!currentDossier || !hasSufficientEvidence(currentDossier)) {
      currentDossier = this.buildFallbackDossier();
    }

    return {
      dossier: currentDossier,
      roundsRun,
      toolCallsCount: totalToolCalls,
      modelUsed,
    };
  }

  /**
   * Deterministic fallback to populate an ExplorerDossier when Gemini is unavailable.
   */
  buildFallbackDossier(): ExplorerDossier {
    const projectBlocks = this.navigator.searchBlocks('사업명 과업명 사업개요', { limit: 4 });
    const agencyBlocks = this.navigator.searchBlocks('수요기관 발주기관 공고기관 계약기관', { limit: 4 });
    const budgetBlocks = this.navigator.searchBlocks('사업예산 추정가격 기초금액 소요예산 부가세', { limit: 4 });
    const compBlocks = this.navigator.searchBlocks('입찰방법 경쟁방법 일반경쟁 제한경쟁 지명경쟁 수의계약', { limit: 4 });
    const awardBlocks = this.navigator.searchBlocks('낙찰자결정 협상에 의한 계약 적격심사 2단계입찰', { limit: 4 });
    const periodBlocks = this.navigator.searchBlocks('사업기간 과업기간 착수일로부터 납품기한 계약기간', { limit: 4 });

    const toEvidence = (matches: any[], reason: string): ExplorerEvidenceCandidate[] =>
      matches.map((m) => ({
        block_id: m.block_id,
        quote: m.text.slice(0, 180),
        reason,
      }));

    return {
      project_identity: toEvidence(projectBlocks, '사업명 관련 블록 검색'),
      agency: toEvidence(agencyBlocks, '기관 정보 관련 블록 검색'),
      budget: toEvidence(budgetBlocks, '예산 정보 관련 블록 검색'),
      competition_method: toEvidence(compBlocks, '경쟁방법 관련 블록 검색'),
      award_method: toEvidence(awardBlocks, '낙찰방법 관련 블록 검색'),
      period: toEvidence(periodBlocks, '사업기간 관련 블록 검색'),
    };
  }
}

function sanitizeDossier(raw: any): ExplorerDossier {
  const cleanList = (arr: any[]): ExplorerEvidenceCandidate[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((item) => item && typeof item === 'object' && item.block_id && item.quote)
      .map((item) => ({
        block_id: String(item.block_id),
        quote: String(item.quote),
        reason: String(item.reason || ''),
        table_id: item.table_id ? String(item.table_id) : undefined,
      }));
  };

  return {
    project_identity: cleanList(raw.project_identity),
    agency: cleanList(raw.agency),
    budget: cleanList(raw.budget),
    competition_method: cleanList(raw.competition_method),
    award_method: cleanList(raw.award_method),
    period: cleanList(raw.period),
    additional_evidence: cleanList(raw.additional_evidence),
  };
}

function hasSufficientEvidence(dossier: ExplorerDossier): boolean {
  const count =
    dossier.project_identity.length +
    dossier.agency.length +
    dossier.budget.length +
    dossier.competition_method.length +
    dossier.award_method.length +
    dossier.period.length;
  return count >= 2;
}
