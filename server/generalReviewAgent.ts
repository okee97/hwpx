import { getGeminiClient, generateContentWithFallback, isGeminiKeyConfigured } from './geminiClient';

import { AuthoritativeMetadata } from '../src/types/metadata';
import { DocumentBlock, Finding, NativeLocator } from '../src/types/finding';

export interface GeneralReviewAgentInput {
  projectId: string;
  authoritativeMetadata: AuthoritativeMetadata | null;
  blocks: DocumentBlock[];
  rawText?: string;
  antiDuplicationContext: Array<{
    rule_id: string;
    title: string;
    block_id: string;
    matched_keyword?: string;
  }>;
}

export interface GeneralReviewRawItem {
  rule_id?: string;
  rule_name?: string;
  title: string;
  block_id: string;
  matched_keyword?: string;
  original_text: string;
  basis: string;
  recommendation: string;
  severity?: 'CRITICAL' | 'WARNING' | 'INFO';
}

/**
 * General Review Agent
 * - 문서 내 모순(Contradictions), 필수항목 누락(Omissions), 과업-산출내역 불일치(Discrepancies) 검출
 * - 이미 Rule/Fairness에서 탐지된 Finding을 Anti-Duplication Context로 수신하여 중복 배제
 * - 카테고리: AI_REVIEW 고정
 */
export async function runGeneralReviewAgent(input: GeneralReviewAgentInput): Promise<Finding[]> {
  const { projectId, authoritativeMetadata, blocks, rawText = '', antiDuplicationContext } = input;
  const gemini = getGeminiClient();

  let rawItems: GeneralReviewRawItem[] = [];

  if (gemini && isGeminiKeyConfigured()) {
    try {
      const systemPrompt = `당신은 제안요청서(RFP) 및 과업지시서 종합 품질 검토관(General Review Agent)입니다.
문서 내 기재사항의 자체 모순, 일정/예산 불일치, 필수 항목 누락, 과업 내용과 산출물 목록 간의 불일치를 정밀 분석합니다.

[안티 듀플리케이션(중복 방지) 지침]
아래 목록은 앞선 규칙 엔진 및 공정성 에이전트에서 이미 지적된 항목들입니다.
동일한 블록 및 동일한 문제 유형에 대해서는 절대로 다시 지적하지 마십시오:
${JSON.stringify(antiDuplicationContext)}

[출력 카테고리]
카테고리는 AI_REVIEW입니다.
JSON 배열 형식으로만 응답하십시오.`;

      const userContent = `[확정 사업정보]
- 사업명: ${authoritativeMetadata?.project_name || '정보화 사업'}
- 수요기관: ${authoritativeMetadata?.client_name || '수요기관'}
- 사업예산: ${authoritativeMetadata?.budget_amount ? authoritativeMetadata.budget_amount.toLocaleString() + '원' : '문서 미기재 (임의가정 금지)'}
- 사업기간: ${authoritativeMetadata?.project_period || '문서 미기재 (임의가정 금지)'}

[문서 블록 목록]
${blocks
  .slice(0, 45)
  .map((b) => `[ID: ${b.block_id}] ${b.text}`)
  .join('\n')}

[검토 요청]
1. 사업 개요의 기간/예산과 세부 과업 일정/내역 간의 모순 검토
2. 과업에 명시된 요구사항 대비 제출 산출물 목록의 누락 여부
3. 제안서 제출 기한, 하자담보 책임기간, 기술지원 조건의 명확성 검토
4. 주의: 문서에 명시되지 않은 가상의 기간이나 숫자를 가정하여 모순을 조작하지 마십시오.`;

      const result = await generateContentWithFallback({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userContent}` }] }],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      const responseText = result.text || '';
      const parsed = JSON.parse(responseText);
      if (Array.isArray(parsed)) {
        rawItems = parsed;
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('API_KEY') || msg.includes('API key not valid')) {
        console.log('[Gemini General Review Agent] API 키 미연동/비활성 상태로 도메인 휴리스틱 엔진을 사용합니다.');
      } else {
        console.log('[Gemini General Review Agent] 도메인 휴리스틱 엔진 적용:', msg.slice(0, 80));
      }
    }

  }

  // Fallback / Deterministic General Review Heuristics
  if (rawItems.length === 0) {
    rawItems = runHeuristicGeneralReview(blocks, authoritativeMetadata, antiDuplicationContext);
  }

  // Schema Validation and Conversion to Finding
  const validatedFindings: Finding[] = [];
  const blockMap = new Map<string, DocumentBlock>();
  blocks.forEach((b) => blockMap.set(b.block_id, b));

  const handledKeys = new Set(antiDuplicationContext.map((c) => `${c.block_id}_${c.rule_id}`));

  for (const item of rawItems) {
    if (!item.title || !item.basis || !item.recommendation) continue;

    // Filter if duplicate
    const dedupKey = `${item.block_id}_${item.rule_id || 'AI-REVIEW'}`;
    if (handledKeys.has(dedupKey)) continue;

    const targetBlock = item.block_id ? blockMap.get(item.block_id) : undefined;
    const blockId = targetBlock ? targetBlock.block_id : (blocks[0]?.block_id || 'para_ai_1');
    const locator: NativeLocator = targetBlock?.native_locator || { section_index: 0, paragraph_index: 0 };
    const originalText = item.original_text || targetBlock?.text || '검토 대상 원문';

    const findingId = `finding-aireview-${(item.rule_id || 'AI-GEN').toLowerCase()}-${blockId}`;

    validatedFindings.push({
      finding_id: findingId,
      project_id: projectId,
      rule_id: item.rule_id || 'AI-REVIEW-001',
      rule_name: item.rule_name || '문서 정합성 및 누락 검토',
      category: 'AI_REVIEW',
      severity: item.severity === 'CRITICAL' ? 'CRITICAL' : item.severity === 'WARNING' ? 'WARNING' : 'INFO',
      title: item.title,
      original_text: originalText,
      matched_keyword: item.matched_keyword || '문서 정합성',
      source_refs: [
        {
          block_id: blockId,
          native_locator: locator,
          text: originalText,
        },
      ],
      basis: item.basis,
      recommendation: item.recommendation,
      decision: 'PENDING',
      decision_reason: null,
      decided_at: null,
      created_at: new Date().toISOString(),
    });
  }

  return validatedFindings;
}

/**
 * 도메인 기반 모순/누락/산출내역 불일치 검사 휴리스틱
 */
function runHeuristicGeneralReview(
  blocks: DocumentBlock[],
  meta: AuthoritativeMetadata | null,
  alreadyHandled: Array<{ block_id: string; rule_id: string; title: string }>
): GeneralReviewRawItem[] {
  const results: GeneralReviewRawItem[] = [];
  const handledBlocks = new Set(alreadyHandled.map((d) => d.block_id));

  // 1. 사업기간과 납품기한/하자보증기간 불일치 탐지
  const metaPeriod = meta?.project_period || '';
  for (const block of blocks) {
    const text = block.text;

    if (
      (text.includes('사업기간') || text.includes('과업기간') || text.includes('납품기한')) &&
      (text.includes('10개월') || text.includes('12개월') || text.includes('1년')) &&
      metaPeriod.includes('8개월')
    ) {
      if (!handledBlocks.has(block.block_id)) {
        results.push({
          rule_id: 'AI-MISMATCH-001',
          rule_name: '사업기간 상호 모순 탐지',
          title: '사업 개요 상의 사업기간(8개월)과 세부 과업기간 상이',
          block_id: block.block_id,
          matched_keyword: '과업기간',
          original_text: text,
          basis:
            '문서 1장 사업 개요에는 사업기간이 "계약체결일로부터 8개월"로 확정 명시되어 있으나, 본 조항에는 상이한 기간이 기재되어 있어 계약 일정상 상호 모순이 발생합니다.',
          recommendation:
            '총 사업기간을 1장 사업 개요(계약체결일로부터 8개월)에 맞추어 통일하고 마일스톤 및 세부 공정표를 재조정하십시오.',
          severity: 'WARNING',
        });
        handledBlocks.add(block.block_id);
      }
    }

    // 2. 투입인력 등급 산정 및 보안서약서 누락 검토
    if (
      (text.includes('투입인력') || text.includes('참여인력')) &&
      (text.includes('등급') || text.includes('자격기준')) &&
      !text.includes('소프트웨어기술자')
    ) {
      if (!handledBlocks.has(block.block_id)) {
        results.push({
          rule_id: 'AI-OMISSION-001',
          rule_name: '투입인력 노임단가 및 등급 산정기준 누락',
          title: '투입인력 자격 기준 모호 및 SW기술자 임금실태 미준용',
          block_id: block.block_id,
          matched_keyword: '투입인력',
          original_text: text,
          basis:
            '소프트웨어 진흥법 제46조에 따른 SW기술자 노임단가 적용 기준 및 한국소프트웨어산업협회(KOSA) 공표 SW기술자 경력관리 기준이 명시되지 않아 인력 적정성 평가 시 분쟁 가능성이 있습니다.',
          recommendation:
            "'한국소프트웨어산업협회 공표 SW기술인력 직종별 임금실태조사 기준에 따른 적정 등급 기준을 적용한다'는 문구를 명시하고 자격 증빙 제출 서식을 추가하십시오.",
          severity: 'INFO',
        });
        handledBlocks.add(block.block_id);
      }
    }

    // 3. 과업-산출물 불일치 (기능 요구 대비 산출내역 검증)
    if (
      (text.includes('모바일') || text.includes('스마트폰') || text.includes('앱')) &&
      text.includes('구축') &&
      !text.includes('앱스토어')
    ) {
      if (!handledBlocks.has(block.block_id)) {
        results.push({
          rule_id: 'AI-DELIVERABLE-001',
          rule_name: '과업 대비 납품 산출물 내역 누락',
          title: '모바일 연동 기능 요구 대비 산출물 목록(앱 등록 지원) 누락',
          block_id: block.block_id,
          matched_keyword: '모바일',
          original_text: text,
          basis:
            '과업 범위에 모바일 앱 또는 반응형 모바일 서비스 구축이 명시되어 있으나, 최종 산출물 목록에 모바일 배포 가이드 및 스토어 등록 지원 내역이 누락되어 있습니다.',
          recommendation:
            "최종 납품 산출물 목록에 '모바일 앱 소스코드, 설치 가이드, 마켓 등록 지원 확약서'를 필수 산출물로 추가 기재하십시오.",
          severity: 'INFO',
        });
        handledBlocks.add(block.block_id);
      }
    }
  }

  // Strictly respect ground truth: If no issues found, return empty array without fabricating findings
  return results;
}
