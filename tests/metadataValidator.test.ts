import assert from 'node:assert';
import {
  normalizeText,
  cleanQuoteString,
  quoteContainsNumber,
  inferClientTypeAndLaw,
  checkCompetitionMethodGrounding,
  checkAwardMethodGrounding,
  checkEstimatedPriceGrounding,
  checkAgencyNameGrounding,
  validateJudgeDecision,
} from '../server/metadata/metadataSourceValidator';
import { DocumentBlock } from '../src/types/finding';
import { TableMatrix } from '../server/rhwpAdapter';
import { JudgeDecisionPayload } from '../server/metadata/metadataSchemas';

console.log('====================================================');
console.log('🧪 Running SourceValidator Decision Grounding Test Suite');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err?.message || err}\n`);
    throw err;
  }
}

// ----------------------------------------------------
// 1. Text Normalization & Number Detection
// ----------------------------------------------------
test('normalizeText collapses irregular whitespace and linebreaks', () => {
  const raw = '사업예산:\t1,100,000,000원\n\r (부가가치세\u00a0포함)';
  const norm = normalizeText(raw);
  assert.strictEqual(norm, '사업예산: 1,100,000,000원 (부가가치세 포함)');
});

test('cleanQuoteString strips cosmetic quotation marks from LLM', () => {
  assert.strictEqual(cleanQuoteString('“일반경쟁입찰”'), '일반경쟁입찰');
  assert.strictEqual(cleanQuoteString('「협상에 의한 계약」'), '협상에 의한 계약');
  assert.strictEqual(cleanQuoteString('"2024년 12월 31일"'), '2024년 12월 31일');
});

test('quoteContainsNumber verifies raw, formatted, and Korean unit amounts', () => {
  assert.strictEqual(quoteContainsNumber('금액: 1,100,000,000원', 1100000000), true);
  assert.strictEqual(quoteContainsNumber('금액: 1100000000원', 1100000000), true);
  assert.strictEqual(quoteContainsNumber('사업비 11억원(VAT포함)', 1100000000), true);
  assert.strictEqual(quoteContainsNumber('소요예산 2억 5000만원', 250000000), true);
  assert.strictEqual(quoteContainsNumber('사업비 50,000,000원', 100000000), false);
  assert.strictEqual(quoteContainsNumber('숫자 없는 텍스트', 50000000), false);
});

// ----------------------------------------------------
// 2. Client Type and Governing Law Deterministic Inference
// ----------------------------------------------------
test('inferClientTypeAndLaw correctly classifies Local Government', () => {
  const res1 = inferClientTypeAndLaw('서울특별시 강남구');
  assert.strictEqual(res1.clientType, 'LOCAL_GOVERNMENT');
  assert.strictEqual(res1.governingLaw, 'LOCAL_CONTRACT_ACT');

  const res2 = inferClientTypeAndLaw('경기도 부천시청');
  assert.strictEqual(res2.clientType, 'LOCAL_GOVERNMENT');
  assert.strictEqual(res2.governingLaw, 'LOCAL_CONTRACT_ACT');
});

test('inferClientTypeAndLaw correctly classifies Central Government', () => {
  const res = inferClientTypeAndLaw('행정안전부 디지털정부국');
  assert.strictEqual(res.clientType, 'CENTRAL_GOVERNMENT');
  assert.strictEqual(res.governingLaw, 'STATE_CONTRACT_ACT');
});

test('inferClientTypeAndLaw correctly classifies Public Institution', () => {
  const res = inferClientTypeAndLaw('한국지능정보사회진흥원');
  assert.strictEqual(res.clientType, 'PUBLIC_INSTITUTION');
  assert.strictEqual(res.governingLaw, 'PUBLIC_ENTERPRISE_RULE');
});

// ----------------------------------------------------
// 3. Decision Grounding: Competition Method
// ----------------------------------------------------
test('checkCompetitionMethodGrounding rejects RESTRICTED claim when quote only says general', () => {
  // AI claims RESTRICTED_COMPETITIVE, but quote states general competition
  const res = checkCompetitionMethodGrounding(
    'RESTRICTED_COMPETITIVE',
    '본 사업의 입찰방식은 일반경쟁입찰 방식으로 진행한다.'
  );
  assert.strictEqual(res.valid, false);
  assert.ok(res.reason?.includes("원문에는 '일반경쟁'만 명시되어 있으나"));
});

test('checkCompetitionMethodGrounding approves RESTRICTED claim when restriction keywords exist', () => {
  const res = checkCompetitionMethodGrounding(
    'RESTRICTED_COMPETITIVE',
    '입찰방법: 제한경쟁입찰 (중소기업자간 경쟁제품 및 지역제한)'
  );
  assert.strictEqual(res.valid, true);
});

test('checkCompetitionMethodGrounding rejects OPEN claim when quote lacks open keywords', () => {
  const res = checkCompetitionMethodGrounding(
    'OPEN_COMPETITIVE',
    '계약방법: 수의계약 대상'
  );
  assert.strictEqual(res.valid, false);
});

// ----------------------------------------------------
// 4. Decision Grounding: Award Method
// ----------------------------------------------------
test('checkAwardMethodGrounding approves NEGOTIATION when keyword is present', () => {
  const res = checkAwardMethodGrounding(
    'NEGOTIATION',
    '낙찰자 결정방법: 협상에 의한 계약 체결'
  );
  assert.strictEqual(res.valid, true);
});

test('checkAwardMethodGrounding rejects NEGOTIATION when quote is qualification review', () => {
  const res = checkAwardMethodGrounding(
    'NEGOTIATION',
    '낙찰자 결정: 조달청 적격심사 세부기준에 의함'
  );
  assert.strictEqual(res.valid, false);
  assert.ok(res.reason?.includes('협상계약 관련 표제어'));
});

// ----------------------------------------------------
// 5. Decision Grounding: Estimated Price
// ----------------------------------------------------
test('checkEstimatedPriceGrounding rejects estimated price when quote only mentions budget', () => {
  // Quote mentions budget amount, but NOT explicit '추정가격'
  const res = checkEstimatedPriceGrounding(
    1000000000,
    '사업예산: 금1,000,000,000원 (부가가치세 포함)'
  );
  assert.strictEqual(res.valid, false);
  assert.ok(res.reason?.includes("'추정가격' 명시적 표제어가 없음"));
});

test('checkEstimatedPriceGrounding approves when both heading and amount are present', () => {
  const res = checkEstimatedPriceGrounding(
    909090909,
    '추정가격: 909,090,909원 (부가가치세 별도)'
  );
  assert.strictEqual(res.valid, true);
});

// ----------------------------------------------------
// 6. Decision Grounding: Agency Name
// ----------------------------------------------------
test('checkAgencyNameGrounding approves token-matched agency name', () => {
  const res = checkAgencyNameGrounding(
    '서울특별시 강남구',
    '수요기관: 서울특별시 강남구청 스마트정보과'
  );
  assert.strictEqual(res.valid, true);
});

test('checkAgencyNameGrounding rejects completely hallucinated agency name', () => {
  const res = checkAgencyNameGrounding(
    '한국도로공사',
    '수요기관: 서울특별시 강남구청 스마트정보과'
  );
  assert.strictEqual(res.valid, false);
});

// ----------------------------------------------------
// 7. Full Integration: validateJudgeDecision Zero-Tolerance Demotion
// ----------------------------------------------------
test('validateJudgeDecision demotes invalid RESTRICTED claim to UNKNOWN and clears misleading value', () => {
  const mockBlock: DocumentBlock = {
    block_id: 'block-comp-1',
    block_type: 'PARAGRAPH',
    text: '2. 입찰 및 계약방식: 본 사업은 일반경쟁입찰 및 협상에 의한 계약 방식으로 집행합니다.',
    native_locator: { section_index: 0, paragraph_index: 1 },
  };

  const fakeDecision: JudgeDecisionPayload = {
    project_name: {
      value: '테스트 정보화 사업',
      status: 'EXPLICIT',
      evidence: [{ block_id: 'block-comp-1', quote: '본 사업은' }],
      reasoning_summary: '사업명 확인',
    },
    client_name: {
      value: '서울특별시 강남구',
      status: 'EXPLICIT',
      evidence: [],
      reasoning_summary: '',
    },
    demand_agency: {
      value: '서울특별시 강남구',
      status: 'INFERRED',
      evidence: [],
      reasoning_summary: '수요기관',
    },
    contract_agency: {
      value: '조달청',
      status: 'INFERRED',
      evidence: [],
      reasoning_summary: '계약기관',
    },
    client_type: {
      value: 'LOCAL_GOVERNMENT',
      status: 'INFERRED',
      evidence: [],
      reasoning_summary: '지자체 추론',
    },
    governing_law: {
      value: 'LOCAL_CONTRACT_ACT',
      status: 'INFERRED',
      evidence: [],
      reasoning_summary: '지방계약법',
    },
    competition_method: {
      value: 'RESTRICTED_COMPETITIVE', // Hallucinated/wrong decision!
      status: 'EXPLICIT',
      evidence: [{
        block_id: 'block-comp-1',
        quote: '본 사업은 일반경쟁입찰 및 협상에 의한 계약 방식으로 집행합니다.',
      }],
      reasoning_summary: '경쟁방법 판정 (오판)',
    },
    award_method: {
      value: 'NEGOTIATION',
      status: 'EXPLICIT',
      evidence: [{
        block_id: 'block-comp-1',
        quote: '협상에 의한 계약 방식으로 집행합니다.',
      }],
      reasoning_summary: '협상계약 확인',
    },
    procurement_method_reason: '입찰공고 검토',
    budget_amount: {
      value: 500000000,
      status: 'UNVERIFIED',
      evidence: [],
      reasoning_summary: '',
    },
    estimated_price: {
      value: null,
      status: 'UNVERIFIED',
      evidence: [],
      reasoning_summary: '',
    },
    vat_included: {
      value: true,
      status: 'INFERRED',
      evidence: [],
      reasoning_summary: '부가세 포함 기본',
    },
    calculated_candidates: [],
    project_period: {
      value: '착수일로부터 6개월',
      status: 'UNVERIFIED',
      evidence: [],
      reasoning_summary: '',
    },
    judge_summary: '종합 판정 완료',
    needs_more_evidence: false,
  };

  const validationResult = validateJudgeDecision(
    fakeDecision,
    [mockBlock],
    [],
    'proj-test-1',
    'gemini-2.5-flash'
  );

  // 1. competition_method must be demoted to UNKNOWN because quote contradicted it
  assert.strictEqual(
    validationResult.validatedMetadata.competition_method,
    'UNKNOWN',
    'Contradicted competition_method must be reset to UNKNOWN'
  );
  assert.strictEqual(
    validationResult.validatedMetadata.evidence_status.competition_method,
    'CONFLICT',
    'Contradicted evidence_status must become CONFLICT'
  );
  assert.strictEqual(
    validationResult.validatedMetadata.confidence_scores.competition_method,
    0.3,
    'Contradicted confidence score for CONFLICT must be 0.3'
  );

  // 2. award_method was grounded properly and should remain NEGOTIATION
  assert.strictEqual(
    validationResult.validatedMetadata.award_method,
    'NEGOTIATION'
  );
  assert.strictEqual(
    validationResult.validatedMetadata.evidence_status.award_method,
    'EXPLICIT'
  );

  // 3. Stats must capture the decision grounding mismatch
  assert.ok(
    validationResult.validationStats.decision_grounding_mismatches >= 1,
    'decision_grounding_mismatches must be incremented'
  );

  // 4. Separation of agencies and vat_included preserved
  assert.strictEqual(validationResult.validatedMetadata.demand_agency, '서울특별시 강남구');
  assert.strictEqual(validationResult.validatedMetadata.contract_agency, '조달청');
  assert.strictEqual(validationResult.validatedMetadata.vat_included, true);
});

// ----------------------------------------------------
// 8. Edge Case: Numeric Mismatch in Budget rejects explicit budget
// ----------------------------------------------------
test('validateJudgeDecision rejects explicit budget when numeric check fails', () => {
  const mockBlock: DocumentBlock = {
    block_id: 'block-budget-1',
    block_type: 'PARAGRAPH',
    text: '총 사업예산은 금300,000,000원(부가세 포함)으로 편성한다.',
    native_locator: { section_index: 0, paragraph_index: 2 },
  };

  const fakeDecision: JudgeDecisionPayload = {
    project_name: { value: '테스트 사업', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    client_name: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    demand_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    contract_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    client_type: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    governing_law: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    competition_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    award_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    procurement_method_reason: '',
    budget_amount: {
      value: 500000000, // Hallucinated 5억 when text clearly says 3억
      status: 'EXPLICIT',
      evidence: [{ block_id: 'block-budget-1', quote: '총 사업예산은 금300,000,000원(부가세 포함)' }],
      reasoning_summary: '5억원 판단 (오판)',
    },
    estimated_price: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    vat_included: { value: true, status: 'EXPLICIT', evidence: [], reasoning_summary: '' },
    calculated_candidates: [],
    project_period: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    judge_summary: '',
  };

  const validationResult = validateJudgeDecision(fakeDecision, [mockBlock], [], 'proj-num-1');

  // Must reject and reset to null
  assert.strictEqual(validationResult.validatedMetadata.budget_amount, null);
  assert.strictEqual(validationResult.validatedMetadata.evidence_status.budget_amount, 'UNVERIFIED');
  assert.strictEqual(validationResult.validatedMetadata.confidence_scores.budget_amount, 0.0);
  assert.ok(validationResult.validationStats.numeric_mismatches_rejected >= 1);
});

// ----------------------------------------------------
// 9. Edge Case: Estimated Price without explicit keyword is rejected
// ----------------------------------------------------
test('validateJudgeDecision rejects estimated price when quote lacks 추정가격 keyword', () => {
  const mockBlock: DocumentBlock = {
    block_id: 'block-price-1',
    block_type: 'PARAGRAPH',
    text: '사업비: 800,000,000원 (부가가치세 별도)',
    native_locator: { section_index: 0, paragraph_index: 3 },
  };

  const fakeDecision: JudgeDecisionPayload = {
    project_name: { value: '테스트 사업', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    client_name: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    demand_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    contract_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    client_type: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    governing_law: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    competition_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    award_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    procurement_method_reason: '',
    budget_amount: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    estimated_price: {
      value: 800000000,
      status: 'EXPLICIT',
      evidence: [{ block_id: 'block-price-1', quote: '사업비: 800,000,000원' }], // Lacks "추정가격"
      reasoning_summary: '추정가격으로 오인',
    },
    vat_included: { value: false, status: 'EXPLICIT', evidence: [], reasoning_summary: '' },
    calculated_candidates: [],
    project_period: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '' },
    judge_summary: '',
  };

  const validationResult = validateJudgeDecision(fakeDecision, [mockBlock], [], 'proj-price-1');

  assert.strictEqual(validationResult.validatedMetadata.estimated_price, null);
  assert.strictEqual(validationResult.validatedMetadata.evidence_status.estimated_price, 'CONFLICT');
  assert.ok(validationResult.validationStats.decision_grounding_mismatches >= 1);
  assert.strictEqual(validationResult.validatedMetadata.vat_included, false);
});

console.log(`\n🎉 All ${passedTests} unit tests passed successfully without errors!`);
