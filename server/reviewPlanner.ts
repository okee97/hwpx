/**
 * AI Review Planner
 *
 * Formulates a tailored, risk-based review plan before specialists execute their reviews.
 * Inspects authoritative metadata (governing law, competition method, award method, budget, agency)
 * and document outline to prioritize critical risk areas rather than applying fixed generic checks.
 */

import { AuthoritativeMetadata } from '../src/types/metadata';
import { DocumentNavigator } from './documentNavigator';
import { generateContentWithFallback, isGeminiKeyConfigured } from './geminiClient';

export type SpecialistDomain =
  | 'COMPETITION'        // 입찰·경쟁성: 참가자격, 실적/지역/면허 제한, 과도한 경쟁제한
  | 'EVALUATION'         // 낙찰·평가: 평가항목, 배점, 정량/정성 비율, 가격평가 산식, 중복평가
  | 'SCOPE'              // 과업·범위: 과업범위 명확성, 추가과업 전가, 요구사항과 산출물 일치
  | 'PRICING'            // 가격·비용: 사업예산, 추정가격, 부대비용 전가, 하자/유지보수 비용 귀속
  | 'CONTRACT'           // 계약조건: 지체상금, 해제·해지, 손해배상 편면성, 위험배분
  | 'IP_SECURITY'        // 지식재산권·보안: 저작권 귀속, 공동소유 여부, 보안위약금
  | 'SCHEDULE'           // 일정·수행성: 납기 적정성, 투입인력 등급, 마일스톤 충돌
  | 'DOCUMENT_INTEGRITY'; // 문서정합성: 공고문↔RFP↔과업내용서↔평가표 간 상호 모순

export interface ReviewPlanItem {
  domain: SpecialistDomain;
  title: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  search_queries: string[];
  focus_questions: string[];
  statutory_basis?: string;
}

export interface ReviewPlan {
  project_id: string;
  project_type_classification: string; // 예: "지자체 공공 SW 구축용역 (제한경쟁+협상계약)"
  risk_profile_summary: string;
  items: ReviewPlanItem[];
  created_at: string;
  planner_model: string;
}

export async function generateReviewPlan(
  projectId: string,
  metadata: AuthoritativeMetadata,
  navigator: DocumentNavigator
): Promise<ReviewPlan> {
  const outline = navigator.getDocumentOutline();
  const overviewMatches = navigator.searchBlocks('사업목적 사업개요 과업범위 추진배경', { limit: 5 });
  const overviewText = overviewMatches.map((m) => m.text).join('\n');

  const systemInstruction = `당신은 대한민국 국가기관 및 지방자치단체 공공계약의 전문 구매검토관(Procurement Review Planner)입니다.
공문서(제안요청서)의 사업정보와 목차, 사업개요를 종합적으로 분석하여,
이 사업의 특성과 위험도에 최적화된 [맞춤형 검토 계획(Review Plan)]을 수립하십시오.

[검토 계획 수립 원칙]
1. 모든 사업에 천편일률적인 목록을 만들지 마십시오.
2. 발주기관 유형(${metadata.client_type || '지자체/국가기관'}), 적용법령(${metadata.governing_law || '지방계약법/국가계약법'}), 경쟁방법(${metadata.competition_method || '제한경쟁'}), 낙찰방법(${metadata.award_method || '협상계약'}), 예산규모(${metadata.budget_amount || '미정'})를 유기적으로 고려하십시오.
   - 예: "제한경쟁"인 경우: 입찰참가자격의 과도한 실적/지역 제한 및 중복 제한 검토를 반드시 HIGH로 설정
   - 예: "협상에 의한 계약"인 경우: 정량/정성 평가배점(기술 90: 가격 10 또는 80:20), 차등점수제, 평가항목의 자의성 검토를 HIGH로 설정
   - 예: "지방계약법" 적용 사업: 행정안전부 예규 '지방자치단체 입찰시 낙찰자 결정기준' 준수 여부 필수 점검
   - 예: "소프트웨어 사업": 지식재산권 공동소유(소프트웨어 진흥법 제59조), 과업심의위원회 및 변경 절차 준수 여부 집중 점검
3. 각 계획 항목마다 AI 검토관이 Document Navigator로 직접 검색할 [구체적인 검색어 목록(search_queries)]과 [핵심 점검 질문(focus_questions)]을 제시하십시오.
4. 출력은 반드시 규정된 JSON 포맷을 준수하십시오.`;

  const userPrompt = `
[프로젝트 메타데이터]
- 사업명: ${metadata.project_name}
- 발주기관: ${metadata.client_name} (유형: ${metadata.client_type})
- 적용법령: ${metadata.governing_law}
- 경쟁방법: ${metadata.competition_method}
- 낙찰방법: ${metadata.award_method}
- 사업예산: ${metadata.budget_amount ? metadata.budget_amount.toLocaleString() + '원' : '문서 미기재'}
- 사업기간: ${metadata.project_period || '문서 미기재'}

[문서 목차 개요]
${outline.sections.map((s) => `- ${s.title} (${s.block_count}개 문단)`).slice(0, 15).join('\n')}

[사업개요 발췌]
${overviewText || '사업개요 발췌문 없음'}

위 정보를 바탕으로 아래 JSON 포맷으로 응답하십시오:
{
  "project_type_classification": "사업 특성 분류 요약 (예: 지자체 공공정보화 제한경쟁 협상계약 사업)",
  "risk_profile_summary": "이 사업에서 특히 주의해야 할 주요 법적·공정성 위험 프로파일 2~3줄 요약",
  "items": [
    {
      "domain": "COMPETITION | EVALUATION | SCOPE | PRICING | CONTRACT | IP_SECURITY | SCHEDULE | DOCUMENT_INTEGRITY",
      "title": "검토 항목 제목",
      "priority": "HIGH | MEDIUM | LOW",
      "reason": "이 항목을 중점 검토해야 하는 구체적 이유",
      "search_queries": ["검색어1", "검색어2", "검색어3"],
      "focus_questions": ["점검질문1", "점검질문2"],
      "statutory_basis": "관련 법령/예규 조항"
    }
  ]
}`;

  if (!isGeminiKeyConfigured()) {
    return {
      project_id: projectId,
      project_type_classification: `${metadata.client_type === 'LOCAL_GOVERNMENT' ? '지자체' : '국가기관'} ${metadata.competition_method === 'RESTRICTED_COMPETITIVE' ? '제한경쟁' : '일반경쟁'} 사업`,
      risk_profile_summary: '적용 법령 및 계약방식에 따른 기본 5대 중점 검토계획 수립 (규칙 기반 플래너)',
      items: getDefaultPlan(metadata),
      created_at: new Date().toISOString(),
      planner_model: 'heuristic-rules-planner',
    };
  }

  try {
    const { text, modelUsed } = await generateContentWithFallback(
      {
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        config: {
          // @ts-ignore
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.15,
        },
      },
      ['gemini-3.8-flash', 'gemini-3.1-flash-lite'],
      20000
    );

    const parsed = JSON.parse(text);
    return {
      project_id: projectId,
      project_type_classification: parsed.project_type_classification || '공공조달 제안요청서 검토',
      risk_profile_summary: parsed.risk_profile_summary || '입찰참가자격 및 평가기준 중심 검토',
      items: Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items : getDefaultPlan(metadata),
      created_at: new Date().toISOString(),
      planner_model: modelUsed,
    };
  } catch (err: any) {
    console.log('[ReviewPlanner] Gemini 연동 불가 또는 오류로 룰 기반 기본 검토계획으로 대체합니다.');
    return {
      project_id: projectId,
      project_type_classification: `${metadata.client_type === 'LOCAL_GOVERNMENT' ? '지자체' : '국가기관'} ${metadata.competition_method === 'RESTRICTED_COMPETITIVE' ? '제한경쟁' : '일반경쟁'} 사업`,
      risk_profile_summary: '적용 법령 및 계약방식에 따른 기본 5대 중점 검토계획 수립',
      items: getDefaultPlan(metadata),
      created_at: new Date().toISOString(),
      planner_model: 'heuristic-rules-planner',
    };
  }
}

/**
 * Fallback baseline plan when AI is unreachable or offline
 */
function getDefaultPlan(metadata: AuthoritativeMetadata): ReviewPlanItem[] {
  const isLocal = metadata.governing_law === 'LOCAL_CONTRACT_ACT';
  const isRestricted = metadata.competition_method === 'RESTRICTED_COMPETITIVE';
  const isNegotiation = metadata.award_method === 'NEGOTIATION';

  const plan: ReviewPlanItem[] = [];

  // 1. Competition check
  plan.push({
    domain: 'COMPETITION',
    title: '입찰참가자격 과도한 제한 및 결격요건 점검',
    priority: isRestricted ? 'HIGH' : 'MEDIUM',
    reason: isRestricted
      ? '제한경쟁입찰이므로 실적·지역·자격 요건이 법령 허용 범위를 초과하여 경쟁을 부당하게 제한하는지 필수 검토'
      : '일반경쟁입찰 참가자격의 적정성 확인',
    search_queries: ['입찰참가자격', '참가자격', '신청자격', '실적제한', '지역제한', '제한경쟁'],
    focus_questions: [
      '유사사업 실적 기준이 사업예산의 1배 또는 일정 규모를 부당하게 초과하는가?',
      '지역제한과 실적제한의 중복 제한이 법령에 부합하는가?',
    ],
    statutory_basis: isLocal ? '지방계약법 시행령 제20조' : '국가계약법 시행령 제21조',
  });

  // 2. Evaluation check
  if (isNegotiation) {
    plan.push({
      domain: 'EVALUATION',
      title: '협상에 의한 계약 기술·가격 배점 및 평가기준 명확성',
      priority: 'HIGH',
      reason: '협상계약의 제안서 기술능력평가 및 입찰가격평가 배점 비율과 정량평가 기준 검토',
      search_queries: ['제안서평가', '평가기준', '기술평가', '가격평가', '정량평가', '배점표', '평가항목'],
      focus_questions: [
        '기술능력평가와 입찰가격평가의 배점 비율이 법정 기준(기술 90: 가격 10 등)을 준수하는가?',
        '정량평가 항목의 배점 기준이 모호하거나 특정 업체에 유리하게 차등 설계되지 않았는가?',
      ],
      statutory_basis: isLocal
        ? '행안부 예규 지방자치단체 입찰시 낙찰자 결정기준'
        : '기재부 계약예규 협상에 의한 계약체결기준',
    });
  }

  // 3. Contract Conditions & Liability
  plan.push({
    domain: 'CONTRACT',
    title: '일방적 해제·해지 및 지체상금·손해배상 편면성 점검',
    priority: 'HIGH',
    reason: '발주기관의 우월적 지위를 이용한 부당 특약 및 계약상대자 귀책사유 일방 판정 조항 적발',
    search_queries: ['계약해제', '계약해지', '지체상금', '손해배상', '위약금', '대금지급'],
    focus_questions: [
      '발주자 사정에 의한 해제 시 기수행 대가 지급 조항이 누락되어 있는가?',
      '법정 지체상금률을 초과하거나 일방적으로 대금을 삭감하는 특약이 있는가?',
    ],
    statutory_basis: isLocal ? '지방계약법 제9조의2 (부당한 계약조건의 효력)' : '국가계약법 제5조',
  });

  // 4. IP & Deliverables
  plan.push({
    domain: 'IP_SECURITY',
    title: '지식재산권 공동소유 원칙 및 산출물 귀속 점검',
    priority: 'MEDIUM',
    reason: '용역수행에 따른 결과물 및 소스코드 저작권이 발주자 단독 귀속으로 작성되었는지 점검',
    search_queries: ['지식재산권', '저작권', '산출물귀속', '소유권', '특허권'],
    focus_questions: ['계약목적물의 지식재산권이 발주기관과 계약상대자의 공동소유로 명시되어 있는가?'],
    statutory_basis: '용역계약일반조건 제56조 및 소프트웨어 진흥법 제59조',
  });

  // 5. Document Integrity
  plan.push({
    domain: 'DOCUMENT_INTEGRITY',
    title: '과업기간/마일스톤/산출물 상호 모순 검토',
    priority: 'MEDIUM',
    reason: '사업개요의 사업기간과 본문 세부 추진일정, 제출 산출물 목록 간 불일치 점검',
    search_queries: ['추진일정', '과업기간', '사업기간', '산출물목록', '납품기한'],
    focus_questions: ['문서 내 여러 곳에 표기된 기간 또는 납기 일정이 서로 충돌하지 않는가?'],
    statutory_basis: '제안요청서 작성 표준 지침',
  });

  return plan;
}
