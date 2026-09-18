import { generateContentWithFallback } from '../geminiClient';
import {
  ExplorerDossier,
  SpecialistResultsBundle,
  ProjectAgencySpecialistResult,
  ProcurementSpecialistResult,
  BudgetPriceSpecialistResult,
  PeriodSpecialistResult,
  ConsistencySpecialistResult,
  METADATA_MODELS,
} from './metadataSchemas';

/**
 * AI Stage 2: Domain Specialists
 *
 * Runs 5 independent, domain-specialized LLM analyzers:
 * 1. Project / Agency Specialist
 * 2. Procurement Specialist (competition_method vs award_method separation)
 * 3. Budget / Price Specialist (budget vs estimated price separation)
 * 4. Period Specialist
 * 5. Consistency Specialist (conflict detection)
 */
export class MetadataSpecialistsRunner {
  /**
   * Runs all 5 domain specialists over the explorer dossier.
   */
  async runAll(dossier: ExplorerDossier, fileName?: string): Promise<SpecialistResultsBundle> {
    // Run Specialists in parallel
    const [projectAgency, procurement, budgetPrice, period] = await Promise.all([
      this.runProjectAgencySpecialist(dossier, fileName),
      this.runProcurementSpecialist(dossier),
      this.runBudgetPriceSpecialist(dossier),
      this.runPeriodSpecialist(dossier),
    ]);

    // Consistency Specialist checks across the outputs of the 4 specialists
    const consistency = await this.runConsistencySpecialist(
      dossier,
      projectAgency,
      procurement,
      budgetPrice,
      period
    );

    return {
      project_agency: projectAgency,
      procurement,
      budget_price: budgetPrice,
      period,
      consistency,
    };
  }

  // 1. Project & Agency Specialist
  private async runProjectAgencySpecialist(
    dossier: ExplorerDossier,
    fileName?: string
  ): Promise<ProjectAgencySpecialistResult> {
    const evidenceBlocks = [...dossier.project_identity, ...dossier.agency];
    const contextText = evidenceBlocks
      .map((e) => `[Block ${e.block_id}] ${e.quote} (사유: ${e.reason})`)
      .join('\n');

    const prompt = `당신은 공공조달 [사업명 및 발주기관 전문 분석관]입니다.
제공된 문서 원문 증거를 분석하여 다음 항목을 도출하십시오.

[분석 지침]
1. 사업명(project_name): 과업명/사업명. 파일명 참고: "${fileName || ''}"
2. 수요기관(demand_agency): 사업을 실제로 필요로 하고 예산을 집행하는 실수요 부서/지자체/공공기관
3. 계약/공고기관(contract_agency): 공고를 내고 입찰/계약을 체결하는 기관 (예: 조달청 대행 또는 자체계약)
4. client_type: LOCAL_GOVERNMENT(지자체) | CENTRAL_GOVERNMENT(국가/중앙부처) | PUBLIC_INSTITUTION(공공기관/공기업) | EDUCATIONAL(교육청) | OTHER | UNKNOWN
5. governing_law: LOCAL_CONTRACT_ACT(지방계약법) | STATE_CONTRACT_ACT(국가계약법) | PUBLIC_ENTERPRISE_RULE(공기업계약사무규칙) | OTHER | UNKNOWN
- 근거가 불확실하면 억지로 추측하지 말고 UNKNOWN으로 답하십시오.
- status는 EXPLICIT, INFERRED, UNVERIFIED 중 하나입니다.

[원문 증거]:
${contextText || '증거 없음'}

[반환 JSON]:
{
  "project_name": { "value": "사업명", "status": "EXPLICIT", "evidence": [{ "block_id": "...", "quote": "..." }], "reasoning_summary": "..." },
  "client_name": { "value": "대표 발주/수요기관명", "status": "EXPLICIT", "evidence": [{ "block_id": "...", "quote": "..." }], "reasoning_summary": "..." },
  "demand_agency": { "value": "실수요기관명", "status": "EXPLICIT", "evidence": [{ "block_id": "...", "quote": "..." }], "reasoning_summary": "..." },
  "contract_agency": { "value": "계약기관명 또는 자체계약", "status": "EXPLICIT", "evidence": [{ "block_id": "...", "quote": "..." }], "reasoning_summary": "..." },
  "client_type": { "value": "LOCAL_GOVERNMENT", "status": "INFERRED", "evidence": [], "reasoning_summary": "..." },
  "governing_law": { "value": "LOCAL_CONTRACT_ACT", "status": "INFERRED", "evidence": [], "reasoning_summary": "..." }
}`;

    try {
      const { text } = await generateContentWithFallback(
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json', temperature: 0.05 },
        },
        METADATA_MODELS.specialists,
        15000
      );
      const cleaned = text.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      return {
        project_name: { value: fileName?.replace(/\.[^/.]+$/, '') || '미확인 사업', status: 'UNVERIFIED', evidence: [], reasoning_summary: '폴백 기본값' },
        client_name: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '확인 불가' },
        demand_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '확인 불가' },
        contract_agency: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '확인 불가' },
        client_type: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '확인 불가' },
        governing_law: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '확인 불가' },
      };
    }
  }

  // 2. Procurement Specialist
  private async runProcurementSpecialist(
    dossier: ExplorerDossier
  ): Promise<ProcurementSpecialistResult> {
    const evidenceBlocks = [...dossier.competition_method, ...dossier.award_method];
    const contextText = evidenceBlocks
      .map((e) => `[Block ${e.block_id}] ${e.quote} (사유: ${e.reason})`)
      .join('\n');

    const prompt = `당신은 공공조달 [계약 및 입찰방식 전문 분석관]입니다.
제공된 원문 증거를 바탕으로 [경쟁방법]과 [낙찰자결정방법]을 두 개의 독립된 축으로 각각 판정하십시오.

[절대 주의사항]
1. competition_method (경쟁방법):
   - RESTRICTED_COMPETITIVE (제한경쟁입찰: 지역제한, 실적제한, 중소기업제한 등 참가자격 제한)
   - OPEN_COMPETITIVE (일반경쟁입찰: 별도 제한 없는 일반경쟁)
   - NOMINATED_COMPETITIVE (지명경쟁)
   - PRIVATE_CONTRACT (수의계약)
   - UNKNOWN
   * 주의: "재공고 유찰 시 수의계약 가능" 같은 조건부 문구는 현재 본 입찰방법이 아니므로 PRIVATE_CONTRACT로 판정해서는 절대 안 됩니다!
2. award_method (낙찰자결정방법):
   - NEGOTIATION (협상에 의한 계약: 기술능력평가 + 입찰가격평가, 제안서 평가)
   - QUALIFICATION_REVIEW (적격심사: 예정가격 이하 최저가 입찰자 대상 심사)
   - LOWEST_PRICE (최저가낙찰제)
   - TWO_STAGE (2단계 경쟁입찰)
   - SPEC_PRICE_SIMULTANEOUS (규격가격 동시입찰)
   - OTHER / UNKNOWN
- "제한경쟁입찰"과 "협상에 의한 계약"은 동시에 성립할 수 있습니다.

[원문 증거]:
${contextText || '증거 없음'}

[반환 JSON]:
{
  "competition_method": {
    "value": "RESTRICTED_COMPETITIVE" | "OPEN_COMPETITIVE" | "NOMINATED_COMPETITIVE" | "PRIVATE_CONTRACT" | "UNKNOWN",
    "status": "EXPLICIT" | "INFERRED" | "UNVERIFIED",
    "evidence": [{ "block_id": "...", "quote": "실제 원문 인용" }],
    "reasoning_summary": "구체적 판정 근거"
  },
  "award_method": {
    "value": "NEGOTIATION" | "QUALIFICATION_REVIEW" | "LOWEST_PRICE" | "TWO_STAGE" | "SPEC_PRICE_SIMULTANEOUS" | "OTHER" | "UNKNOWN",
    "status": "EXPLICIT" | "INFERRED" | "UNVERIFIED",
    "evidence": [{ "block_id": "...", "quote": "실제 원문 인용" }],
    "reasoning_summary": "구체적 판정 근거"
  }
}`;

    try {
      const { text } = await generateContentWithFallback(
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json', temperature: 0.05 },
        },
        METADATA_MODELS.specialists,
        15000
      );
      const cleaned = text.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      return {
        competition_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '분석 실패' },
        award_method: { value: 'UNKNOWN', status: 'UNVERIFIED', evidence: [], reasoning_summary: '분석 실패' },
      };
    }
  }

  // 3. Budget & Price Specialist
  private async runBudgetPriceSpecialist(
    dossier: ExplorerDossier
  ): Promise<BudgetPriceSpecialistResult> {
    const evidenceBlocks = dossier.budget;
    const contextText = evidenceBlocks
      .map((e) => `[Block ${e.block_id}] ${e.quote} (사유: ${e.reason})`)
      .join('\n');

    const prompt = `당신은 공공조달 [예산 및 가격 전문 분석관]입니다.
제공된 원문 증거에서 사업예산과 추정가격을 엄밀하게 구별하여 추출하십시오.

[절대 규칙]
1. budget_amount: 문서에 명시된 총 사업예산 (VAT 포함 여부 확인). 숫자로만 기재 (원 단위 정수).
2. estimated_price: 국가계약법/지방계약법상 부가세가 제외된 "추정가격"이 문서에 직접 명시된 경우에만 숫자로 추출.
   * 중요: 문서에 추정가격이 명시되어 있지 않다면 절대 총예산으로 채우거나 임의 계산하지 말고 반드시 null로 두십시오!
3. calculated_candidates: 추정가격이 문서에 없는 경우, "총예산 ÷ 1.1" 계산값을 참고용 후보로 추가하십시오.
   (라벨: "총사업예산 기준 부가세(10%) 역산 공급가액", amount: 계산된 정수, note: "총예산 ÷ 1.1 참고 계산값")

[원문 증거]:
${contextText || '증거 없음'}

[반환 JSON]:
{
  "budget_amount": {
    "value": 1500000000 또는 null,
    "status": "EXPLICIT" | "UNVERIFIED",
    "evidence": [{ "block_id": "...", "quote": "실제 원문 인용" }],
    "reasoning_summary": "금액 판정 근거"
  },
  "estimated_price": {
    "value": 1363636364 또는 null,
    "status": "EXPLICIT" | "UNVERIFIED",
    "evidence": [{ "block_id": "...", "quote": "문서에 추정가격으로 적혀있는 원문 인용" }],
    "reasoning_summary": "문서 직접 명시된 경우만 작성"
  },
  "vat_included": {
    "value": true 또는 false 또는 null,
    "status": "EXPLICIT" | "INFERRED",
    "evidence": [],
    "reasoning_summary": "부가가치세 포함 여부"
  },
  "calculated_candidates": [
    {
      "label": "총사업예산 기준 부가세(10%) 역산 공급가액",
      "amount": 1363636364,
      "note": "총사업예산 ÷ 1.1 참고 계산값 (문서 내 추정가격 미기재)"
    }
  ]
}`;

    try {
      const { text } = await generateContentWithFallback(
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json', temperature: 0.05 },
        },
        METADATA_MODELS.specialists,
        15000
      );
      const cleaned = text.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      return {
        budget_amount: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '분석 실패' },
        estimated_price: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '분석 실패' },
        vat_included: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '분석 실패' },
        calculated_candidates: [],
      };
    }
  }

  // 4. Period Specialist
  private async runPeriodSpecialist(
    dossier: ExplorerDossier
  ): Promise<PeriodSpecialistResult> {
    const evidenceBlocks = dossier.period;
    const contextText = evidenceBlocks
      .map((e) => `[Block ${e.block_id}] ${e.quote} (사유: ${e.reason})`)
      .join('\n');

    const prompt = `당신은 공공조달 [사업기간 전문 분석관]입니다.
제공된 원문 증거에서 사업기간(과업기간)을 추출하십시오.

[분석 지침]
- 착수일로부터 N개월 / 계약체결일로부터 N일 / 특정 확정일자 등의 형식 정확 추출
- 만약 요약부와 세부내용에서 기간이 서로 상충되는 경우(예: 8개월 vs 10개월) 임의로 하나를 고르지 말고 status를 "CONFLICT"로 표기하십시오.

[원문 증거]:
${contextText || '증거 없음'}

[반환 JSON]:
{
  "project_period": {
    "value": "착수일로부터 8개월" 또는 null,
    "status": "EXPLICIT" | "CONFLICT" | "UNVERIFIED",
    "evidence": [{ "block_id": "...", "quote": "실제 원문 인용" }],
    "reasoning_summary": "기간 판정 근거"
  },
  "start_condition": "계약체결일 또는 착수일",
  "end_condition": "착수 후 N개월 등"
}`;

    try {
      const { text } = await generateContentWithFallback(
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json', temperature: 0.05 },
        },
        METADATA_MODELS.specialists,
        15000
      );
      const cleaned = text.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      return {
        project_period: { value: null, status: 'UNVERIFIED', evidence: [], reasoning_summary: '분석 실패' },
      };
    }
  }

  // 5. Consistency Specialist
  private async runConsistencySpecialist(
    dossier: ExplorerDossier,
    projectAgency: ProjectAgencySpecialistResult,
    procurement: ProcurementSpecialistResult,
    budgetPrice: BudgetPriceSpecialistResult,
    period: PeriodSpecialistResult
  ): Promise<ConsistencySpecialistResult> {
    const formatEvidence = (evList?: any[]) => {
      if (!evList || evList.length === 0) return '근거 인용구 없음';
      return evList.map((e) => `[${e.block_id}] "${e.quote}"`).join(' | ');
    };

    const prompt = `당신은 공공조달 메타데이터 [교차 검증 및 정합성 분석관(Consistency Specialist)]입니다.
도메인별 분석관들이 추출한 결과와 실제 원문 증거를 대조하여 상충(Conflict), 모순, 미비점을 탐지하십시오.

[분석관별 추출 결과 및 원문 증거]:
1. 사업명/기관:
   - 사업명: "${projectAgency.project_name.value}" (증거: ${formatEvidence(projectAgency.project_name.evidence)})
   - 수요기관: "${projectAgency.demand_agency.value}" (증거: ${formatEvidence(projectAgency.demand_agency.evidence)})
   - 계약기관: "${projectAgency.contract_agency.value}" (증거: ${formatEvidence(projectAgency.contract_agency.evidence)})
2. 계약/입찰방법:
   - 경쟁방법: "${procurement.competition_method.value}" (증거: ${formatEvidence(procurement.competition_method.evidence)})
   - 낙찰방법: "${procurement.award_method.value}" (증거: ${formatEvidence(procurement.award_method.evidence)})
3. 예산 및 가격:
   - 사업예산: ${budgetPrice.budget_amount.value} (증거: ${formatEvidence(budgetPrice.budget_amount.evidence)})
   - 추정가격: ${budgetPrice.estimated_price.value} (증거: ${formatEvidence(budgetPrice.estimated_price.evidence)})
4. 사업기간:
   - 기간: "${period.project_period.value}" (증거: ${formatEvidence(period.project_period.evidence)})

[Explorer가 수집한 추가 발굴 증거 (Dossier)]:
- 사업기간 후보: ${dossier.period.map((p) => `[${p.block_id}] "${p.quote}"`).join(' \n ')}
- 예산 후보: ${dossier.budget.map((b) => `[${b.block_id}] "${b.quote}"`).join(' \n ')}
- 계약방법 후보: ${dossier.competition_method.map((c) => `[${c.block_id}] "${c.quote}"`).join(' \n ')}

[점검 포인트]:
1. 본문과 표 또는 개요와 세부내용 간의 기재 내용 불일치(예: 개요는 8개월인데 세부일정표는 10개월) 여부
2. 경쟁방법과 낙찰방법의 법적 조합 유효성 (일반경쟁인데 제한사유 명시, 또는 조건부 수의계약 혼동 등)
3. 수요기관과 계약기관의 혼동 여부
4. 예산과 추정가격의 혼동 또는 중복 표기 여부

[반환 JSON]:
{
  "has_conflicts": false 또는 true,
  "detected_conflicts": [
    {
      "field": "project_period",
      "description": "개요에서는 8개월이나 세부일정에서는 10개월로 표기되어 상충 발생",
      "conflicting_values": ["8개월", "10개월"],
      "evidence": [{ "block_id": "...", "quote": "..." }]
    }
  ],
  "consistency_summary": "전반적인 메타데이터 정합성 및 신뢰도 총평"
}`;

    try {
      const { text } = await generateContentWithFallback(
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json', temperature: 0.05 },
        },
        METADATA_MODELS.specialists,
        15000
      );
      const cleaned = text.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      return {
        has_conflicts: false,
        detected_conflicts: [],
        consistency_summary: '정합성 자동 분석 생략',
      };
    }
  }
}
