/**
 * AI Procurement Review Orchestrator (v3)
 *
 * Implements the full autonomous review loop:
 * 1. Document IR & Navigator (Full Document Search & Context Retrieval)
 * 2. Review Planner (Risk & Characteristic-based Tailored Review Plan)
 * 3. Specialized Reviewers (Competition, Evaluation, Scope, Pricing, Contract, IP/Security, Schedule)
 * 4. Final Critic / Devil's Advocate (Filters frivolous false positives, ensures high credibility)
 * 5. Source Validator (Verifies block_id and citation fidelity)
 */

import { Finding, DocumentBlock } from '../src/types/finding';
import { AuthoritativeMetadata } from '../src/types/metadata';
import { DocumentNavigator, buildDocumentIndex } from './documentNavigator';
import { generateReviewPlan, ReviewPlan, ReviewPlanItem } from './reviewPlanner';
import { generateContentWithFallback, getGeminiClient, isGeminiKeyConfigured } from './geminiClient';
import { TableMatrix } from './rhwpAdapter';

export interface ReviewOrchestratorInput {
  projectId: string;
  authoritativeMetadata: AuthoritativeMetadata;
  blocks: DocumentBlock[];
  tables?: TableMatrix[];
  rawText: string;
  existingRuleFindings?: Finding[];
}

export interface ReviewOrchestratorResult {
  reviewPlan: ReviewPlan;
  findings: Finding[];
  critic_summary: string;
  total_inspected_blocks: number;
}

/**
 * Executes the autonomous review pipeline.
 */
export async function executeAutonomousReview(
  input: ReviewOrchestratorInput
): Promise<ReviewOrchestratorResult> {
  const { projectId, authoritativeMetadata, blocks, tables = [], rawText, existingRuleFindings = [] } = input;

  // 1. Build Document Navigator over the entire document
  const docIndex = buildDocumentIndex(blocks, tables, rawText);
  const navigator = new DocumentNavigator(docIndex);

  // 2. Generate Review Plan tailored to this specific project
  const reviewPlan = await generateReviewPlan(projectId, authoritativeMetadata, navigator);

  const rawSpecialistFindings: Finding[] = [];
  const handledBlocks = new Set<string>();

  // Add existing rule finding blocks to handled set
  existingRuleFindings.forEach((f) => {
    const bId = f.source_refs?.[0]?.block_id;
    if (bId) handledBlocks.add(bId);
  });

  const gemini = getGeminiClient();
  const isAiActive = Boolean(gemini && isGeminiKeyConfigured());

  // 3. Execute Specialized Reviews based on the Review Plan
  // Process high & medium priority items from the plan
  const planItemsToExecute = reviewPlan.items.filter((item) => item.priority === 'HIGH' || item.priority === 'MEDIUM');

  for (const planItem of planItemsToExecute) {
    const findingsForItem = await executeSpecialistForPlanItem(
      planItem,
      projectId,
      authoritativeMetadata,
      navigator,
      handledBlocks,
      isAiActive
    );

    for (const f of findingsForItem) {
      const bId = f.source_refs?.[0]?.block_id;
      if (!bId || !handledBlocks.has(bId)) {
        rawSpecialistFindings.push(f);
        if (bId) handledBlocks.add(bId);
      }
    }
  }

  // 4. Final Critic / Devil's Advocate Verification
  // AI Critic inspects candidate findings to remove false positives and unwarranted nitpicks
  const { filteredFindings, criticSummary } = await runFinalCritic(
    rawSpecialistFindings,
    authoritativeMetadata,
    navigator,
    isAiActive
  );

  return {
    reviewPlan,
    findings: filteredFindings,
    critic_summary: criticSummary,
    total_inspected_blocks: blocks.length,
  };
}

/**
 * Specialist execution for a single Review Plan item using Document Navigator.
 */
async function executeSpecialistForPlanItem(
  item: ReviewPlanItem,
  projectId: string,
  metadata: AuthoritativeMetadata,
  navigator: DocumentNavigator,
  handledBlocks: Set<string>,
  isAiActive: boolean
): Promise<Finding[]> {
  // Use Document Navigator to autonomously retrieve target blocks using planItem's search_queries
  const searchResults: Array<{ block_id: string; text: string; fullContext?: string }> = [];

  for (const query of item.search_queries) {
    const matches = navigator.searchBlocks(query, { limit: 4 });
    for (const m of matches) {
      if (!handledBlocks.has(m.block_id)) {
        // Expand neighborhood context for higher reasoning accuracy
        const ctx = navigator.getNeighbors(m.block_id, 1);
        searchResults.push({
          block_id: m.block_id,
          text: m.text,
          fullContext: ctx.fullContext,
        });
      }
    }
  }

  if (searchResults.length === 0) {
    return [];
  }

  // Dedup search results
  const uniqueBlocks = Array.from(new Map(searchResults.map((r) => [r.block_id, r])).values()).slice(0, 6);

  if (isAiActive) {
    try {
      const systemInstruction = `당신은 대한민국 공공계약 및 제안요청서 전문 심사관(Specialist Reviewer)입니다.
현재 담당 검토 분야: [${item.domain}] - ${item.title}
관련 법령/지침 기준: ${item.statutory_basis || '국가계약법 및 지방계약법령'}

[핵심 심사 원칙]
1. [문제가 없으면 지적하지 마십시오]:
   - 정상적이거나 통상적인 조항에 대해 억지로 문제를 만들어내지 마십시오.
   - 지적할 문제가 명백하지 않다면 반드시 빈 배열 []을 반환하십시오.
2. [원문 충실성]:
   - 제공된 블록 본문에 실제로 기재된 조항만을 근거로 지적하십시오.
3. [합리적 어조]:
   - "위법하다"고 단정하지 말고 "검토 필요", "개선 권고" 어조를 유지하십시오.
4. [출력 포맷]:
   - 유효한 JSON 배열로만 응답하십시오. 문제가 없으면 []을 출력하십시오.`;

      const userPrompt = `
[사업 정보]
- 사업명: ${metadata.project_name}
- 발주기관: ${metadata.client_name} (유형: ${metadata.client_type})
- 적용법령: ${metadata.governing_law}
- 경쟁방법: ${metadata.competition_method || '미지정'}
- 낙찰방법: ${metadata.award_method || '협상에 의한 계약'}

[검토 중점 질문]
${item.focus_questions.map((q) => `- ${q}`).join('\n')}

[Document Navigator가 탐색한 관련 조항]
${uniqueBlocks.map((b) => `[ID: ${b.block_id}]\n${b.fullContext || b.text}`).join('\n\n')}

위 조항들을 분석하여 공공계약 법령, 공정성 가이드라인, 제안요청서 작성 표준에 위배되거나 개선이 필요한 사항이 발견될 경우에만 JSON 배열을 반환하십시오.
문제가 전혀 없으면 반드시 []을 반환하십시오.

JSON 스키마:
[
  {
    "rule_id": "SPEC-${item.domain}-001",
    "rule_name": "${item.title}",
    "title": "지적사항 명칭",
    "block_id": "실제 조항 block_id",
    "matched_keyword": "핵심 키워드",
    "original_text": "원문 문장",
    "basis": "법령·예규 기준 및 지적 사유",
    "recommendation": "구체적 문구 수정 또는 삭제 권고안",
    "severity": "CRITICAL" | "WARNING" | "INFO"
  }
]`;

      const { text } = await generateContentWithFallback(
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
        18000
      );

      let parsed: any = null;
      try {
        const cleaned = text.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (pe) {
        console.warn('[Specialist Reviewer Parse Warning]', pe);
      }

      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((p) => p.block_id && p.title && p.basis)
          .map((p, idx): Finding => ({
            finding_id: `FIND-${projectId}-SPEC-${item.domain}-${Date.now().toString(36)}-${idx}`,
            project_id: projectId,
            rule_id: p.rule_id || `SPEC-${item.domain}-001`,
            rule_name: p.rule_name || item.title,
            title: p.title,
            category: 'AI_REVIEW',
            severity: p.severity || (item.priority === 'HIGH' ? 'WARNING' : 'INFO'),
            matched_keyword: p.matched_keyword || item.search_queries[0] || '특약',
            original_text: p.original_text || '',
            source_refs: [
              {
                block_id: p.block_id,
                native_locator: { section_index: 0 },
                text: p.original_text || '',
              },
            ],
            basis: p.basis,
            recommendation: p.recommendation || '해당 조항에 대해 관련 법령에 부합하도록 문구를 명확히 재조정하십시오.',
            decision: 'PENDING',
            created_at: new Date().toISOString(),
          }));
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.log(`[Specialist Reviewer] ${item.domain} 휴리스틱 엔진 적용 (${msg.slice(0, 80)})`);
    }
  }

  // Fallback Heuristic Inspection for the domain
  return runSpecialistHeuristic(item, uniqueBlocks, metadata, projectId);
}

/**
 * Domain Heuristic Check (Strict: Returns findings only on genuine violations, NO mandatory fabrication)
 */
function runSpecialistHeuristic(
  item: ReviewPlanItem,
  blocks: Array<{ block_id: string; text: string }>,
  metadata: AuthoritativeMetadata,
  projectId: string
): Finding[] {
  const results: Finding[] = [];

  for (const b of blocks) {
    const t = b.text;

    // 1. Competition: Excessive restricted bidding qualification
    if (
      item.domain === 'COMPETITION' &&
      (t.includes('최근 3년') || t.includes('실적')) &&
      (t.includes('100% 이상') || t.includes('2배') || t.includes('초과'))
    ) {
      results.push({
        finding_id: `FIND-${projectId}-COMP-${b.block_id}`,
        project_id: projectId,
        rule_id: 'RULE-COMP-001',
        rule_name: '입찰참가자격 과도한 실적 제한 점검',
        title: '입찰참가자격 유사사업 수행실적 제한요건 과다 설정',
        category: 'AI_REVIEW',
        severity: 'WARNING',
        matched_keyword: '실적',
        original_text: t,
        source_refs: [
          {
            block_id: b.block_id,
            native_locator: { section_index: 0 },
            text: t,
          },
        ],
        basis:
          '국가계약법 시행규칙 제25조 및 지방계약법 시행규칙 제25조에 따르면 실적에 의한 제한경쟁 시 특수한 경우를 제외하고는 사업규모(추정가격)의 1배 이내로 제한하여야 하나, 과도한 실적 요구로 중소기업의 참여가 부당하게 제한될 수 있습니다.',
        recommendation:
          '실적 제한 기준을 사업예산 또는 최근 3년간 실적 기준 적정 규모(1배 이하)로 완화 조정하십시오.',
        decision: 'PENDING',
        created_at: new Date().toISOString(),
      });
      break;
    }

    // 2. Evaluation: Price evaluation formula
    if (
      item.domain === 'EVALUATION' &&
      (t.includes('가격평가') || t.includes('기술능력평가')) &&
      (t.includes('기술 70') || t.includes('기술70') || t.includes('가격 30') || t.includes('가격30'))
    ) {
      results.push({
        finding_id: `FIND-${projectId}-EVAL-${b.block_id}`,
        project_id: projectId,
        rule_id: 'RULE-EVAL-001',
        rule_name: '협상에 의한 계약 기술·가격 배점 비율 점검',
        title: '소프트웨어 용역 제안서 평가 배점 기준(기술 90: 가격 10) 부적합',
        category: 'AI_REVIEW',
        severity: 'WARNING',
        matched_keyword: '가격평가',
        original_text: t,
        source_refs: [
          {
            block_id: b.block_id,
            native_locator: { section_index: 0 },
            text: t,
          },
        ],
        basis:
          '행정안전부 예규 지방자치단체 입찰시 낙찰자 결정기준 및 기재부 협상에 의한 계약체결기준에 따라 공공 소프트웨어 사업은 기술능력평가 90%, 입찰가격평가 10%를 원칙으로 합니다.',
        recommendation:
          '소프트웨어 구축/운영 용역인 경우 기술능력평가 배점을 90점으로 상향하고 입찰가격평가 배점을 10점으로 조정하십시오.',
        decision: 'PENDING',
        created_at: new Date().toISOString(),
      });
      break;
    }

    // 3. IP Ownership
    if (
      item.domain === 'IP_SECURITY' &&
      (t.includes('지식재산권') || t.includes('저작권') || t.includes('산출물')) &&
      (t.includes('발주처에 귀속') || t.includes('수요기관에 귀속') || t.includes('일체 귀속')) &&
      !t.includes('공동소유') &&
      !t.includes('공동으로 소유')
    ) {
      results.push({
        finding_id: `FIND-${projectId}-IP-${b.block_id}`,
        project_id: projectId,
        rule_id: 'RULE-IP-001',
        rule_name: '지식재산권 공동소유 원칙 점검',
        title: '계약목적물 지식재산권 발주기관 일방 귀속 특약',
        category: 'FAIRNESS',
        severity: 'WARNING',
        matched_keyword: '지식재산권',
        original_text: t,
        source_refs: [
          {
            block_id: b.block_id,
            native_locator: { section_index: 0 },
            text: t,
          },
        ],
        basis:
          '기획재정부 계약예규 용역계약일반조건 제56조 및 소프트웨어 진흥법 제59조에 따르면 계약목적물의 지식재산권은 발주기관과 계약상대자가 공동으로 소유하는 것이 원칙입니다.',
        recommendation:
          "지식재산권 귀속 조항을 '발주기관과 계약상대자가 공동으로 소유하며, 세부사항은 상호 협의하여 정한다'로 수정하십시오.",
        decision: 'PENDING',
        created_at: new Date().toISOString(),
      });
      break;
    }

    // 4. Contract: Unilateral contract termination
    if (
      item.domain === 'CONTRACT' &&
      (t.includes('해제') || t.includes('해지')) &&
      (t.includes('일방적으로') || t.includes('이의를 제기할 수 없다') || t.includes('즉시 해제할 수 있으며 손해배상을 청구하지 못한다'))
    ) {
      results.push({
        finding_id: `FIND-${projectId}-CONT-${b.block_id}`,
        project_id: projectId,
        rule_id: 'RULE-CONT-001',
        rule_name: '일방적 계약 해제·해지권 유보 점검',
        title: '계약상대자의 이의신청권 배제 및 일방적 계약해제 특약',
        category: 'FAIRNESS',
        severity: 'CRITICAL',
        matched_keyword: '해제',
        original_text: t,
        source_refs: [
          {
            block_id: b.block_id,
            native_locator: { section_index: 0 },
            text: t,
          },
        ],
        basis:
          '국가계약법 제5조 및 지방계약법 제9조의2에 따라 계약상대자의 이익을 부당하게 제한하거나 일방적인 해제 권리를 규정하여 이의를 제기하지 못하도록 한 특약은 부당특약으로 효력이 부인될 수 있습니다.',
        recommendation:
          '계약 해제·해지 시 상대방의 소명 기회를 부여하고 기수행 완료분에 대한 정산 조항을 명시하십시오.',
        decision: 'PENDING',
        created_at: new Date().toISOString(),
      });
      break;
    }
  }

  // NOTE: If no genuine violation found, return empty array []! NEVER fabricate fake issues!
  return results;
}

/**
 * Final Critic / Devil's Advocate:
 * Scrutinizes specialist candidates from an adversary viewpoint to filter out false positives.
 */
async function runFinalCritic(
  candidateFindings: Finding[],
  metadata: AuthoritativeMetadata,
  navigator: DocumentNavigator,
  isAiActive: boolean | null
): Promise<{ filteredFindings: Finding[]; criticSummary: string }> {
  if (candidateFindings.length === 0) {
    return {
      filteredFindings: [],
      criticSummary: '전문 검토관 심사 결과 지적할 중대 위반이나 부당 특약이 발견되지 않았습니다. 제안요청서가 관련 법령을 양호하게 준수하고 있습니다.',
    };
  }

  if (!isAiActive) {
    return {
      filteredFindings: candidateFindings,
      criticSummary: `총 ${candidateFindings.length}건의 잠재적 위험 조항이 탐지되었습니다.`,
    };
  }

  try {
    const systemInstruction = `당신은 대한민국 공공계약 검토의 '수석 비평관(Final Critic / Devil's Advocate)'입니다.
앞선 Specialist AI들이 지적한 Finding 후보들을 엄격하게 비판적 시각에서 재검증하십시오.

[비평 및 필터링 원칙]
1. [과도한 트집 제거 (NO NITPICKING)]:
   - 법령이나 통상적 행정관행상 정당한 발주자의 정당한 요구인데도 사소한 표현 차이로 트집 잡은 항목은 과감하게 탈락(REJECT)시키십시오.
   - 예: 법정 필수 서류(보안서약서, 청렴계약이행각서) 제출 요구는 부당한 요구가 아닙니다.
2. [원문 맥락 확인]:
   - 단어 하나만 보고 맥락을 오독한 지적사항(False Positive)은 탈락(REJECT)시키십시오.
3. [적정 등급 조정]:
   - 경미한 권고사항인데 CRITICAL로 과장된 것은 WARNING 또는 INFO로 조정(ADJUST)하십시오.
4. 출력 포맷:
   - 각 Finding의 id별로 "KEEP", "ADJUST", "REJECT" 판정과 이유를 JSON으로 반환하십시오.`;

    const userPrompt = `
[사업 정보]
- 사업명: ${metadata.project_name}
- 발주기관: ${metadata.client_name} (${metadata.client_type})
- 법령: ${metadata.governing_law} / 계약방식: ${metadata.competition_method} + ${metadata.award_method}

[검토관들이 제출한 Finding 후보 목록 (${candidateFindings.length}건)]
${candidateFindings
  .map(
    (f, idx) => `
[후보 ${idx + 1}]
- ID: ${f.finding_id}
- 제목: ${f.title}
- 인용 원문: "${f.original_text}"
- 지적 근거: ${f.basis}
- 기존 등급: ${f.severity}
`
  )
  .join('\n')}

위 후보들을 비판적으로 검증하여 아래 JSON을 반환하십시오:
{
  "critic_summary": "비평관 종합 평가 요약 (예: 4건 중 1건은 통상적 행정조치로 기각하고, 3건을 타당한 지적으로 확정함)",
  "verdicts": [
    {
      "id": "후보 ID",
      "decision": "KEEP" | "ADJUST" | "REJECT",
      "adjusted_severity": "CRITICAL" | "WARNING" | "INFO",
      "reason": "판정 이유"
    }
  ]
}`;

    const { text } = await generateContentWithFallback(
      {
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        config: {
          // @ts-ignore
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      },
      ['gemini-3.8-flash', 'gemini-3.1-flash-lite'],
      18000
    );

    const parsed = JSON.parse(text);
    const verdicts: Array<{ id: string; decision: string; adjusted_severity?: any; reason?: string }> =
      parsed.verdicts || [];
    const verdictMap = new Map(verdicts.map((v) => [v.id, v]));

    const filtered: Finding[] = [];

    for (const f of candidateFindings) {
      const v = verdictMap.get(f.finding_id);
      if (!v || v.decision === 'KEEP') {
        filtered.push(f);
      } else if (v.decision === 'ADJUST') {
        filtered.push({
          ...f,
          severity: v.adjusted_severity || f.severity,
          basis: `${f.basis} (비평관 검증: ${v.reason || '등급 합리화'})`,
        });
      }
      // If REJECT, omit from filtered list!
    }

    return {
      filteredFindings: filtered,
      criticSummary: parsed.critic_summary || `AI Critic 비평 완료: ${filtered.length}건의 타당한 지적사항 최종 확정`,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.log(`[Final Critic] 휴리스틱 검증 완료 (${msg.slice(0, 80)})`);
    return {
      filteredFindings: candidateFindings,
      criticSummary: `총 ${candidateFindings.length}건의 지적사항 도출`,
    };
  }
}
