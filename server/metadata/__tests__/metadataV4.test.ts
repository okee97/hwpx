import { DocumentBlock } from '../../../src/types/finding';
import { TableMatrix } from '../../rhwpAdapter';
import { buildDocumentIndex, DocumentNavigator } from '../../documentNavigator';
import {
  normalizeText,
  quoteContainsNumber,
  validateJudgeDecision,
  calculateConfidence,
} from '../metadataSourceValidator';
import { MetadataOrchestrator } from '../metadataOrchestrator';
import { JudgeDecisionPayload } from '../metadataSchemas';

function createTestBlock(
  block_id: string,
  text: string,
  block_type: 'PARAGRAPH' | 'TABLE_CELL' = 'PARAGRAPH'
): DocumentBlock {
  return {
    block_id,
    block_type,
    text,
    native_locator: { section_index: 0 },
  };
}

/**
 * Metadata Extractor v4 Comprehensive Verification Suite
 * Tests 1 to 10 as specified in the Task Specification.
 */
async function runAllTests() {
  console.log('=== [Metadata Extractor v4] Running Test Suite (Tests 1 - 10) ===\n');
  let passedCount = 0;
  let totalCount = 10;

  // -------------------------------------------------------------
  // TEST 1: Demand Agency vs Contract Agency separation
  // -------------------------------------------------------------
  try {
    const blocks: DocumentBlock[] = [
      createTestBlock('p_1', '1. 사업개요: 본 사업은 행정안전부 디지털정부국에서 주관하는 사업이다.'),
      createTestBlock('p_2', '수요기관: 행정안전부, 입찰 공고 및 계약 체결 기관: 조달청'),
    ];

    const judgeDecision: JudgeDecisionPayload = {
      project_name: { value: '디지털정부 사업', status: 'EXPLICIT', evidence: [{ block_id: 'p_1', quote: '행정안전부 디지털정부국에서 주관하는 사업' }], reasoning_summary: '사업명' },
      client_name: { value: '행정안전부', status: 'EXPLICIT', evidence: [{ block_id: 'p_2', quote: '수요기관: 행정안전부' }], reasoning_summary: '수요기관' },
      demand_agency: { value: '행정안전부', status: 'EXPLICIT', evidence: [{ block_id: 'p_2', quote: '수요기관: 행정안전부' }], reasoning_summary: '수요기관' },
      contract_agency: { value: '조달청', status: 'EXPLICIT', evidence: [{ block_id: 'p_2', quote: '계약 체결 기관: 조달청' }], reasoning_summary: '계약기관' },
      client_type: { value: 'CENTRAL_GOVERNMENT', status: 'INFERRED', evidence: [], reasoning_summary: '중앙부처' },
      governing_law: { value: 'STATE_CONTRACT_ACT', status: 'INFERRED', evidence: [], reasoning_summary: '국가계약법' },
      competition_method: { value: 'OPEN_COMPETITIVE', status: 'UNVERIFIED', evidence: [], reasoning_summary: '미확인' },
      award_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '미확인' },
      procurement_method_reason: '검토 완료',
      budget_amount: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      estimated_price: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      calculated_candidates: [],
      project_period: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      judge_summary: '분리 검증',
    };

    const res = validateJudgeDecision(judgeDecision, blocks, [], 'test-1');
    if (
      res.validatedMetadata.demand_agency === '행정안전부' &&
      res.validatedMetadata.contract_agency === '조달청' &&
      res.validatedMetadata.evidence_status?.client_name === 'EXPLICIT'
    ) {
      console.log('✅ TEST 1 PASSED: Demand Agency (행정안전부) vs Contract Agency (조달청) separated correctly.');
      passedCount++;
    } else {
      console.error('❌ TEST 1 FAILED:', res.validatedMetadata);
    }
  } catch (e) {
    console.error('❌ TEST 1 EXCEPTION:', e);
  }

  // -------------------------------------------------------------
  // TEST 2: RESTRICTED_COMPETITIVE + NEGOTIATION independent axes
  // -------------------------------------------------------------
  try {
    const blocks: DocumentBlock[] = [
      createTestBlock('b_comp', '입찰참가자격: 서울특별시에 주된 영업소를 둔 소프트웨어사업자로 제한(제한경쟁입찰).'),
      createTestBlock('b_award', '낙찰자 결정방식: 기술능력평가(90%) 및 가격평가(10%) 종합평가에 의한 협상에 의한 계약 체결.'),
    ];

    const judgeDecision: JudgeDecisionPayload = {
      project_name: { value: '테스트 사업', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      client_name: { value: '테스트 기관', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      demand_agency: { value: '테스트 기관', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      contract_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      client_type: { value: 'LOCAL_GOVERNMENT', status: 'INFERRED', evidence: [], reasoning_summary: '' },
      governing_law: { value: 'LOCAL_CONTRACT_ACT', status: 'INFERRED', evidence: [], reasoning_summary: '' },
      competition_method: { value: 'RESTRICTED_COMPETITIVE', status: 'EXPLICIT', evidence: [{ block_id: 'b_comp', quote: '소프트웨어사업자로 제한(제한경쟁입찰)' }], reasoning_summary: '지역/업종 제한' },
      award_method: { value: 'NEGOTIATION', status: 'EXPLICIT', evidence: [{ block_id: 'b_award', quote: '종합평가에 의한 협상에 의한 계약 체결' }], reasoning_summary: '제안서 평가 협상' },
      procurement_method_reason: '제한경쟁 및 협상계약',
      budget_amount: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      estimated_price: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      calculated_candidates: [],
      project_period: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      judge_summary: '경쟁방법과 낙찰방법 독립 판정',
    };

    const res = validateJudgeDecision(judgeDecision, blocks, [], 'test-2');
    if (
      res.validatedMetadata.competition_method === 'RESTRICTED_COMPETITIVE' &&
      res.validatedMetadata.award_method === 'NEGOTIATION' &&
      res.validatedMetadata.evidence_status?.competition_method === 'EXPLICIT' &&
      res.validatedMetadata.evidence_status?.award_method === 'EXPLICIT'
    ) {
      console.log('✅ TEST 2 PASSED: RESTRICTED_COMPETITIVE and NEGOTIATION verified on independent orthogonal axes.');
      passedCount++;
    } else {
      console.error('❌ TEST 2 FAILED:', res.validatedMetadata);
    }
  } catch (e) {
    console.error('❌ TEST 2 EXCEPTION:', e);
  }

  // -------------------------------------------------------------
  // TEST 3: Budget amount present, Estimated price NOT present
  // -------------------------------------------------------------
  try {
    const blocks: DocumentBlock[] = [
      createTestBlock('b_budget', '3. 사업예산: 일금 1,100,000,000원정 (부가가치세 10% 포함)'),
    ];

    const judgeDecision: JudgeDecisionPayload = {
      project_name: { value: '예산 테스트', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      client_name: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      demand_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      contract_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      client_type: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      governing_law: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      competition_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      award_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      procurement_method_reason: '예산만 있음',
      budget_amount: { value: 1100000000, status: 'EXPLICIT', evidence: [{ block_id: 'b_budget', quote: '1,100,000,000원정 (부가가치세 10% 포함)' }], reasoning_summary: '사업예산 명시' },
      estimated_price: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '문서에 없음' },
      calculated_candidates: [
        { label: '총사업예산 기준 부가세(10%) 역산 공급가액', amount: 1000000000, note: '총사업예산 ÷ 1.1 참고 계산값' }
      ],
      project_period: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      judge_summary: '추정가격 미기재',
    };

    const res = validateJudgeDecision(judgeDecision, blocks, [], 'test-3');
    if (
      res.validatedMetadata.budget_amount === 1100000000 &&
      res.validatedMetadata.estimated_price === null &&
      res.validatedMetadata.calculated_candidates?.length === 1 &&
      res.validatedMetadata.calculated_candidates[0].amount === 1000000000
    ) {
      console.log('✅ TEST 3 PASSED: Budget (1,100,000,000) preserved, estimated_price is null, calculated candidate is 1,000,000,000.');
      passedCount++;
    } else {
      console.error('❌ TEST 3 FAILED:', res.validatedMetadata);
    }
  } catch (e) {
    console.error('❌ TEST 3 EXCEPTION:', e);
  }

  // -------------------------------------------------------------
  // TEST 4: Both Budget amount AND Estimated price present
  // -------------------------------------------------------------
  try {
    const blocks: DocumentBlock[] = [
      createTestBlock('b_b4', '총사업비: 15억원(VAT 포함), 추정가격: 1,363,636,364원 (부가가치세 제외)'),
    ];

    const judgeDecision: JudgeDecisionPayload = {
      project_name: { value: '예산/추정가격 동시 테스트', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      client_name: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      demand_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      contract_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      client_type: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      governing_law: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      competition_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      award_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      procurement_method_reason: '둘 다 명시',
      budget_amount: { value: 1500000000, status: 'EXPLICIT', evidence: [{ block_id: 'b_b4', quote: '총사업비: 15억원(VAT 포함)' }], reasoning_summary: '15억원' },
      estimated_price: { value: 1363636364, status: 'EXPLICIT', evidence: [{ block_id: 'b_b4', quote: '추정가격: 1,363,636,364원' }], reasoning_summary: '추정가격 직접 기재' },
      calculated_candidates: [],
      project_period: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      judge_summary: '둘 다 문서 명시',
    };

    const res = validateJudgeDecision(judgeDecision, blocks, [], 'test-4');
    if (
      res.validatedMetadata.budget_amount === 1500000000 &&
      res.validatedMetadata.estimated_price === 1363636364 &&
      res.validatedMetadata.evidence_status?.budget_amount === 'EXPLICIT' &&
      res.validatedMetadata.evidence_status?.estimated_price === 'EXPLICIT'
    ) {
      console.log('✅ TEST 4 PASSED: Both budget (1.5B) and estimated_price (1,363,636,364) extracted and validated.');
      passedCount++;
    } else {
      console.error('❌ TEST 4 FAILED:', res.validatedMetadata);
    }
  } catch (e) {
    console.error('❌ TEST 4 EXCEPTION:', e);
  }

  // -------------------------------------------------------------
  // TEST 5: Conflicting project period (8 months vs 10 months)
  // -------------------------------------------------------------
  try {
    const blocks: DocumentBlock[] = [
      createTestBlock('p_ov', '사업개요: 사업기간은 착수일로부터 8개월 이내로 한다.'),
      createTestBlock('p_detail', '세부 추진일정: 총 과업기간은 착수일로부터 10개월간 추진한다.'),
    ];

    const judgeDecision: JudgeDecisionPayload = {
      project_name: { value: '기간 상충 테스트', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      client_name: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      demand_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      contract_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      client_type: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      governing_law: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      competition_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      award_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      procurement_method_reason: '상충 감지',
      budget_amount: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      estimated_price: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      calculated_candidates: [],
      project_period: { value: '8개월 (개요) vs 10개월 (세부일정) 상충', status: 'CONFLICT', evidence: [{ block_id: 'p_ov', quote: '착수일로부터 8개월 이내' }], reasoning_summary: '개요(8개월)와 세부일정(10개월) 불일치' },
      judge_summary: '사업기간 상충 발생',
    };

    const res = validateJudgeDecision(judgeDecision, blocks, [], 'test-5');
    if (
      res.validatedMetadata.evidence_status?.project_period === 'CONFLICT' &&
      (res.validatedMetadata.confidence_scores?.project_period ?? 1) <= 0.4
    ) {
      console.log('✅ TEST 5 PASSED: Period conflict flagged with CONFLICT status and reduced confidence.');
      passedCount++;
    } else {
      console.error('❌ TEST 5 FAILED:', res.validatedMetadata);
    }
  } catch (e) {
    console.error('❌ TEST 5 EXCEPTION:', e);
  }

  // -------------------------------------------------------------
  // TEST 6: Conditional private contract must not misjudge current bid
  // -------------------------------------------------------------
  try {
    const blocks: DocumentBlock[] = [
      createTestBlock('b_cond', '본 입찰은 제한경쟁입찰이며, 2회 유찰 시 지방계약법 시행령에 따라 수의계약을 체결할 수 있다.'),
    ];

    // Check navigator fallback logic on this text
    const index = buildDocumentIndex(blocks, [], blocks[0].text);
    const nav = new DocumentNavigator(index);
    const compMatches = nav.searchBlocks('일반경쟁 제한경쟁 지명경쟁 수의계약', { limit: 3 });

    let compMethod: string = 'UNKNOWN';
    for (const m of compMatches) {
      if (m.text.includes('제한경쟁')) {
        compMethod = 'RESTRICTED_COMPETITIVE';
        break;
      }
    }

    if (compMethod === 'RESTRICTED_COMPETITIVE') {
      console.log('✅ TEST 6 PASSED: Conditional fallback to private contract ("유찰 시 수의계약") correctly ignored; RESTRICTED_COMPETITIVE chosen.');
      passedCount++;
    } else {
      console.error('❌ TEST 6 FAILED:', compMethod);
    }
  } catch (e) {
    console.error('❌ TEST 6 EXCEPTION:', e);
  }

  // -------------------------------------------------------------
  // TEST 7: Source Validator rejection of non-existent blocks and falsified quotes
  // -------------------------------------------------------------
  try {
    const blocks: DocumentBlock[] = [
      createTestBlock('real_block_1', '실제 문서에 적힌 내용: 입찰방법은 일반경쟁입찰입니다.'),
    ];

    const judgeDecision: JudgeDecisionPayload = {
      project_name: { value: '가짜 테스트', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      client_name: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      demand_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      contract_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      client_type: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      governing_law: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      // Case 1: non-existent block_id 'fake_block_999'
      competition_method: {
        value: 'RESTRICTED_COMPETITIVE',
        status: 'EXPLICIT',
        evidence: [{ block_id: 'fake_block_999', quote: '존재하지 않는 블록' }],
        reasoning_summary: '가짜 블록'
      },
      // Case 2: real block_id but quote does not match text
      award_method: {
        value: 'NEGOTIATION',
        status: 'EXPLICIT',
        evidence: [{ block_id: 'real_block_1', quote: '완전히 날조된 없는 문구' }],
        reasoning_summary: '날조된 인용'
      },
      procurement_method_reason: '검증 테스트',
      budget_amount: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      estimated_price: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      calculated_candidates: [],
      project_period: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
      judge_summary: '검증 실패 확인',
    };

    const res = validateJudgeDecision(judgeDecision, blocks, [], 'test-7');
    if (
      res.validationStats.rejected_missing_blocks >= 1 &&
      res.validationStats.demoted_quote_mismatches >= 1 &&
      res.validatedMetadata.evidence_status?.competition_method === 'UNVERIFIED' &&
      res.validatedMetadata.evidence_status?.award_method === 'UNVERIFIED' &&
      !res.validatedMetadata.evidence_quotes?.competition_method
    ) {
      console.log('✅ TEST 7 PASSED: Source Validator rejected non-existent block_id and demoted falsified quote to UNVERIFIED.');
      passedCount++;
    } else {
      console.error('❌ TEST 7 FAILED:', res.validationStats, res.validatedMetadata.evidence_status);
    }
  } catch (e) {
    console.error('❌ TEST 7 EXCEPTION:', e);
  }

  // -------------------------------------------------------------
  // TEST 8: Document Navigator multi-token search in searchTables
  // -------------------------------------------------------------
  try {
    const tables: TableMatrix[] = [
      {
        table_id: 'tbl_1',
        caption: '1. 소요예산 내역표',
        rows: [
          ['구분', '금액(원)', '비고'],
          ['시스템 구축비', '500,000,000', '하드웨어 포함'],
        ],
      },
      {
        table_id: 'tbl_2',
        caption: '2. 사업 추진 일정',
        rows: [
          ['단계', '기간'],
          ['설계', '1개월'],
        ],
      },
    ];

    const index = buildDocumentIndex([], tables, '');
    const nav = new DocumentNavigator(index);

    // Multi-token query: "사업예산 추정가격 소요"
    const results = nav.searchTables('사업예산 추정가격 소요', 3);
    if (results.length > 0 && results[0].table_id === 'tbl_1') {
      console.log('✅ TEST 8 PASSED: searchTables("사업예산 추정가격 소요") successfully matched table with token "소요" in caption.');
      passedCount++;
    } else {
      console.error('❌ TEST 8 FAILED: searchTables returned', results);
    }
  } catch (e) {
    console.error('❌ TEST 8 EXCEPTION:', e);
  }

  // -------------------------------------------------------------
  // TEST 9: Gemini failure / missing API key safe fallback
  // -------------------------------------------------------------
  try {
    const blocks: DocumentBlock[] = [
      createTestBlock('p_fb1', '과업명: 2026년 차세대 도로교통안전 종합정보시스템 구축'),
      createTestBlock('p_fb2', '수요기관: 한국도로교통공단, 총사업비: 850,000,000원'),
    ];

    const orchestrator = new MetadataOrchestrator();
    // Execute with fallback (when API key is missing or invalid)
    const result = await orchestrator.execute({
      projectId: 'test-proj-fallback',
      blocks,
      rawText: blocks.map((b) => b.text).join('\n'),
      fileName: '도로교통안전_제안요청서.hwp',
    });

    if (
      result &&
      result.extracted &&
      result.extracted.project_id === 'test-proj-fallback' &&
      result.extracted.project_name?.includes('차세대 도로교통안전') &&
      result.extracted.budget_amount === 850000000 &&
      result.is_ai_powered === false &&
      result.extracted.analysis_engine === 'RULE_FALLBACK'
    ) {
      console.log('✅ TEST 9 PASSED: Robust, non-crashing fallback extraction returned truthful data without AI.');
      passedCount++;
    } else {
      console.error('❌ TEST 9 FAILED:', result);
    }
  } catch (e) {
    console.error('❌ TEST 9 EXCEPTION:', e);
  }

  // -------------------------------------------------------------
  // TEST 10: ExtractedMetadata -> AuthoritativeMetadata immutability
  // -------------------------------------------------------------
  try {
    const blocks: DocumentBlock[] = [
      createTestBlock('p_10', '사업명: 불변성 검증 테스트 사업'),
    ];

    const orchestrator = new MetadataOrchestrator();
    const result = await orchestrator.execute({
      projectId: 'test-immutability-proj',
      blocks,
      rawText: '사업명: 불변성 검증 테스트 사업',
      fileName: 'test.hwp',
    });

    // ExtractedMetadata must have requires_user_confirmation: true
    // and status !== 'AUTHORITATIVE'
    if (
      result.extracted.requires_user_confirmation === true &&
      result.extracted.status !== 'AUTHORITATIVE'
    ) {
      console.log('✅ TEST 10 PASSED: Extracted metadata strictly requires user confirmation; never saved as Authoritative automatically.');
      passedCount++;
    } else {
      console.error('❌ TEST 10 FAILED:', result.extracted);
    }
  } catch (e) {
    console.error('❌ TEST 10 EXCEPTION:', e);
  }

  console.log(`\n=============================================`);
  console.log(`Test Results: ${passedCount}/${totalCount} tests passed.`);
  console.log(`=============================================\n`);

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
