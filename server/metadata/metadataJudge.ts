import { generateContentWithFallback } from '../geminiClient';
import {
  ExplorerDossier,
  SpecialistResultsBundle,
  JudgeDecisionPayload,
  METADATA_MODELS,
} from './metadataSchemas';

/**
 * AI Stage 3: Metadata Judge
 *
 * An independent, rigorous Judge LLM that audits candidate extractions
 * from all 5 domain specialists, resolves conflicts, and produces a consolidated verdict.
 */
export class MetadataJudge {
  /**
   * Evaluates specialist results and renders a formal judgment.
   */
  async judge(
    dossier: ExplorerDossier,
    specialists: SpecialistResultsBundle,
    fileName?: string,
    isReexploration: boolean = false
  ): Promise<{ decision: JudgeDecisionPayload; modelUsed?: string }> {
    const systemInstruction = `당신은 공공조달 입찰 제안요청서 메타데이터 최종 판정관 [Metadata Judge v4]입니다.
5개 도메인 분석관(Specialist)의 분석 보고서와 일관성 검토 결과를 엄정하게 교차 검증하여 최종 메타데이터를 판정하십시오.

[판정 기본 원칙]
1. 증거 우선주의:
   - 실제 원문 Block ID와 Quote가 확인되지 않은 임의 추측(Hallucination)은 엄격히 배제하십시오.
   - 근거가 없으면 반드시 UNKNOWN 또는 null로 처리하십시오.
2. 독립적 이중 분류 보장:
   - 경쟁방법(일반경쟁, 제한경쟁, 지명경쟁, 수의계약)과 낙찰방법(협상에 의한 계약, 적격심사 등)을 절대 하나로 뭉뚱그리지 말고 독립적으로 판정하십시오.
   - "유찰 시 수의계약" 등 조건부 문구에 현혹되지 말고 본 입찰 방식을 선택하십시오.
3. 예산 vs 추정가격 엄격 구별:
   - estimated_price는 문서 원문에 "추정가격"으로 직접 표기된 경우에만 인정하십시오.
   - 문서에 추정가격이 없다면 반드시 null로 유지하고, 총예산 ÷ 1.1 은 calculated_candidates에만 둡니다.
4. 재탐색 요청(needs_more_evidence):
   - ${isReexploration ? '이미 1차 재탐색을 수행했으므로 needs_more_evidence는 false로 설정하십시오.' : '핵심 필수정보(사업명, 입찰방법 등)의 근거가 심각하게 부족하고 문서 다른 곳에 있을 가능성이 높으면 needs_more_evidence: true 및 suggested_queries를 제시하십시오.'}

[응답 형식 - 반드시 유효한 JSON]
반드시 JudgeDecisionPayload 스키마에 따라 JSON만 출력하십시오.`;

    // Format dossier evidence for Judge to inspect raw quotes directly
    const formatDomainEvidence = (candidates: any[]) => {
      if (!candidates || candidates.length === 0) return '없음';
      return candidates
        .map((c) => `  - [${c.block_id}] "${c.quote}" (사유: ${c.reason || ''})`)
        .join('\n');
    };

    const dossierSummary = `
- 사업명 증거:
${formatDomainEvidence(dossier.project_identity)}
- 기관(수요/계약) 증거:
${formatDomainEvidence(dossier.agency)}
- 예산/가격 증거:
${formatDomainEvidence(dossier.budget)}
- 경쟁방법 증거:
${formatDomainEvidence(dossier.competition_method)}
- 낙찰방법 증거:
${formatDomainEvidence(dossier.award_method)}
- 사업기간 증거:
${formatDomainEvidence(dossier.period)}
`.trim();

    const userPrompt = `[파일명]: ${fileName || '제안요청서'}

[1. Explorer 발굴 원문 증거 (Explorer Dossier)]:
${dossierSummary}

[2. 5대 Specialist 전문 분석관 상세 보고서 및 제출 증거]:
${JSON.stringify(specialists, null, 2)}

[판정 지침]:
- 각 Specialist가 제시한 결론뿐만 아니라 그들이 제출한 "evidence" 원문 인용구가 실제로 주장을 뒷받침하는지 교차 검증하십시오.
- Explorer가 수집한 실제 원문과 Specialist 제출 증거를 대조하여 최종 판정을 내리십시오.
- 입찰방법이 "일반경쟁"인데 "제한경쟁"으로 오분류되었거나, "유찰 시 수의계약" 같은 조건부 문구를 본계약 방식으로 오판정한 경우 교정하십시오.
- "추정가격"은 문서 원문에 명시적 표제어("추정가격")와 함께 기재된 경우에만 인정하고, 없으면 반드시 null로 판정하십시오.

JSON 출력 형식:
{
  "project_name": { "value": "...", "status": "EXPLICIT" | "UNVERIFIED", "evidence": [{ "block_id": "...", "quote": "..." }], "reasoning_summary": "..." },
  "client_name": { "value": "...", "status": "EXPLICIT" | "UNVERIFIED", "evidence": [{ "block_id": "...", "quote": "..." }], "reasoning_summary": "..." },
  "demand_agency": { "value": "...", "status": "EXPLICIT" | "UNVERIFIED", "evidence": [{ "block_id": "...", "quote": "..." }], "reasoning_summary": "..." },
  "contract_agency": { "value": "...", "status": "EXPLICIT" | "UNVERIFIED", "evidence": [{ "block_id": "...", "quote": "..." }], "reasoning_summary": "..." },
  "client_type": { "value": "LOCAL_GOVERNMENT", "status": "INFERRED", "evidence": [], "reasoning_summary": "..." },
  "governing_law": { "value": "LOCAL_CONTRACT_ACT", "status": "INFERRED", "evidence": [], "reasoning_summary": "..." },
  "competition_method": { "value": "RESTRICTED_COMPETITIVE", "status": "EXPLICIT", "evidence": [{ "block_id": "...", "quote": "..." }], "reasoning_summary": "..." },
  "award_method": { "value": "NEGOTIATION", "status": "EXPLICIT", "evidence": [{ "block_id": "...", "quote": "..." }], "reasoning_summary": "..." },
  "procurement_method_reason": "경쟁방법 및 낙찰방법 종합 판정 사유",
  "budget_amount": { "value": 1500000000, "status": "EXPLICIT", "evidence": [{ "block_id": "...", "quote": "..." }], "reasoning_summary": "..." },
  "estimated_price": { "value": null, "status": "UNVERIFIED", "evidence": [], "reasoning_summary": "..." },
  "vat_included": { "value": true, "status": "EXPLICIT", "evidence": [], "reasoning_summary": "..." },
  "calculated_candidates": [...],
  "project_period": { "value": "착수일로부터 8개월", "status": "EXPLICIT", "evidence": [{ "block_id": "...", "quote": "..." }], "reasoning_summary": "..." },
  "judge_summary": "AI Judge 종합 검증 의견",
  "needs_more_evidence": false
}`;

    try {
      const { text, modelUsed } = await generateContentWithFallback(
        {
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          config: {
            // @ts-ignore
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        },
        METADATA_MODELS.judge,
        22000
      );

      const cleaned = text.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
      const parsed: JudgeDecisionPayload = JSON.parse(cleaned);

      return { decision: parsed, modelUsed };
    } catch (err: any) {
      console.warn('[MetadataJudge Warning, building from specialists]', err?.message || err);
      return {
        decision: this.buildFallbackFromSpecialists(specialists, fileName),
        modelUsed: 'fallback',
      };
    }
  }

  private buildFallbackFromSpecialists(
    specialists: SpecialistResultsBundle,
    fileName?: string
  ): JudgeDecisionPayload {
    const pa = specialists.project_agency;
    const pr = specialists.procurement;
    const bp = specialists.budget_price;
    const pe = specialists.period;

    return {
      project_name: pa.project_name,
      client_name: pa.client_name,
      demand_agency: pa.demand_agency,
      contract_agency: pa.contract_agency,
      client_type: pa.client_type,
      governing_law: pa.governing_law,
      competition_method: pr.competition_method,
      award_method: pr.award_method,
      procurement_method_reason: `${pr.competition_method.value} 및 ${pr.award_method.value} (Specialist 종합 판정)`,
      budget_amount: bp.budget_amount,
      estimated_price: bp.estimated_price,
      vat_included: bp.vat_included,
      calculated_candidates: bp.calculated_candidates,
      project_period: pe.project_period,
      judge_summary: specialists.consistency.consistency_summary || '도메인 분석관 종합 판정',
      needs_more_evidence: false,
    };
  }
}
