import React, { useState, useEffect } from 'react';
import {
  ExtractedMetadata,
  AuthoritativeMetadata,
  AuthoritativeMetadataUpdateDto,
  ClientType,
  GoverningLaw,
  ProcurementMethod,
  CompetitionMethod,
  AwardMethod,
  EvidenceStatus,
  CLIENT_TYPE_LABELS,
  GOVERNING_LAW_LABELS,
  PROCUREMENT_METHOD_LABELS,
  COMPETITION_METHOD_LABELS,
  AWARD_METHOD_LABELS,
  EVIDENCE_STATUS_LABELS,
} from '../types/metadata';
import {
  Building2,
  Scale,
  Briefcase,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  History,
  AlertTriangle,
  ArrowRight,
  HelpCircle,
  FileCheck2,
  FileSearch,
  Quote,
  Cpu,
} from 'lucide-react';

interface BusinessMetadataScreenProps {
  projectId: string;
  projectNameDefault?: string;
  initialExtracted?: ExtractedMetadata | null;
  initialAuthoritative?: AuthoritativeMetadata | null;
  onConfirmAndStartReview: (confirmedData: AuthoritativeMetadata) => void;
  onNavigateToStructure?: () => void;
}

export const BusinessMetadataScreen: React.FC<BusinessMetadataScreenProps> = ({
  projectId,
  projectNameDefault,
  initialExtracted,
  initialAuthoritative,
  onConfirmAndStartReview,
}) => {
  const [extracted, setExtracted] = useState<ExtractedMetadata | null>(initialExtracted || null);
  const [authoritative, setAuthoritative] = useState<AuthoritativeMetadata | null>(initialAuthoritative || null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [hasAutoPopulated, setHasAutoPopulated] = useState(false);
  const [isReExtracting, setIsReExtracting] = useState(false);

  // Form states
  const [projectName, setProjectName] = useState(
    initialAuthoritative?.project_name || initialExtracted?.project_name || projectNameDefault || ''
  );
  const [clientName, setClientName] = useState(
    initialAuthoritative?.client_name || initialExtracted?.client_name || ''
  );
  const [demandAgency, setDemandAgency] = useState(
    initialExtracted?.demand_agency || initialAuthoritative?.client_name || initialExtracted?.client_name || ''
  );
  const [contractAgency, setContractAgency] = useState(
    initialExtracted?.contract_agency || ''
  );
  const [reviewPlan, setReviewPlan] = useState<any | null>(null);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [clientType, setClientType] = useState<ClientType>(
    initialAuthoritative?.client_type || initialExtracted?.client_type || 'UNKNOWN'
  );
  const [governingLaw, setGoverningLaw] = useState<GoverningLaw>(
    initialAuthoritative?.governing_law || initialExtracted?.governing_law || 'UNKNOWN'
  );

  // Separate Competition Method & Award Method
  const [competitionMethod, setCompetitionMethod] = useState<CompetitionMethod>(
    initialAuthoritative?.competition_method ||
      initialExtracted?.competition_method ||
      (initialExtracted?.procurement_method === 'RESTRICTED_COMPETITIVE'
        ? 'RESTRICTED_COMPETITIVE'
        : initialExtracted?.procurement_method === 'OPEN_COMPETITIVE'
        ? 'OPEN_COMPETITIVE'
        : initialExtracted?.procurement_method === 'PRIVATE_CONTRACT'
        ? 'PRIVATE_CONTRACT'
        : 'UNKNOWN')
  );
  const [awardMethod, setAwardMethod] = useState<AwardMethod>(
    initialAuthoritative?.award_method ||
      initialExtracted?.award_method ||
      (initialExtracted?.procurement_method === 'NEGOTIATION' ? 'NEGOTIATION' : 'UNKNOWN')
  );

  const [procurementMethod, setProcurementMethod] = useState<ProcurementMethod>(
    initialAuthoritative?.procurement_method || initialExtracted?.procurement_method || 'UNKNOWN'
  );
  const [budgetAmount, setBudgetAmount] = useState<number | string>(
    initialAuthoritative?.budget_amount && initialAuthoritative.budget_amount > 0
      ? initialAuthoritative.budget_amount
      : (initialExtracted?.budget_amount && initialExtracted.budget_amount > 0 ? initialExtracted.budget_amount : '')
  );
  const [estimatedPrice, setEstimatedPrice] = useState<number | string>(
    initialAuthoritative?.estimated_price && initialAuthoritative.estimated_price > 0
      ? initialAuthoritative.estimated_price
      : (initialExtracted?.estimated_price && initialExtracted.estimated_price > 0 ? initialExtracted.estimated_price : '')
  );
  const [projectPeriod, setProjectPeriod] = useState(
    initialAuthoritative?.project_period || initialExtracted?.project_period || ''
  );
  const [vatIncluded, setVatIncluded] = useState<boolean | null>(
    initialAuthoritative?.vat_included !== undefined
      ? initialAuthoritative.vat_included
      : (initialExtracted?.vat_included !== undefined ? initialExtracted.vat_included : true)
  );
  const [note, setNote] = useState(initialAuthoritative?.note || '');

  // Sync state on mount/props
  useEffect(() => {
    if (initialAuthoritative) {
      setAuthoritative(initialAuthoritative);
      populateForm(initialAuthoritative);
      setHasAutoPopulated(true);
    } else if (initialExtracted) {
      setExtracted(initialExtracted);
      populateFormFromExtracted(initialExtracted);
      setHasAutoPopulated(true);
    }
    fetchMetadata();
  }, [projectId, initialExtracted, initialAuthoritative]);

  const fetchMetadata = async () => {
    setIsLoading(true);
    try {
      const extRes = await fetch(`/api/v1/projects/${projectId}/metadata/extracted`);
      let extData: ExtractedMetadata | null = null;
      if (extRes.ok) {
        const json = await extRes.json();
        extData = json.data;
        setExtracted(extData);
      }

      const authRes = await fetch(`/api/v1/projects/${projectId}/metadata/authoritative`);
      if (authRes.ok) {
        const json = await authRes.json();
        const authData: AuthoritativeMetadata = json.data;
        setAuthoritative(authData);
        populateForm(authData);
        setHasAutoPopulated(true);
      } else if (extData) {
        populateFormFromExtracted(extData);
        setHasAutoPopulated(true);
      }

      // Fetch AI Review Plan
      try {
        setIsLoadingPlan(true);
        const planRes = await fetch(`/api/v1/projects/${projectId}/review-plan`);
        if (planRes.ok) {
          const planJson = await planRes.json();
          if (planJson.data) {
            setReviewPlan(planJson.data);
          }
        }
      } catch (pe) {
        console.warn('Failed to load review plan:', pe);
      } finally {
        setIsLoadingPlan(false);
      }
    } catch (e) {
      console.warn('Failed to load metadata:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const populateForm = (data: AuthoritativeMetadata) => {
    setProjectName(data.project_name || projectNameDefault || '');
    setClientName(data.client_name || '');
    setDemandAgency(data.demand_agency || data.client_name || '');
    setContractAgency(data.contract_agency || '');
    setClientType(data.client_type || 'UNKNOWN');
    setGoverningLaw(data.governing_law || 'UNKNOWN');
    setCompetitionMethod(data.competition_method || 'UNKNOWN');
    setAwardMethod(data.award_method || 'UNKNOWN');
    setProcurementMethod(data.procurement_method || 'UNKNOWN');
    setBudgetAmount(data.budget_amount && data.budget_amount > 0 ? data.budget_amount : '');
    setEstimatedPrice(data.estimated_price && data.estimated_price > 0 ? data.estimated_price : '');
    setVatIncluded(data.vat_included !== undefined ? data.vat_included : true);
    setProjectPeriod(data.project_period || '');
    setNote(data.note || '');
  };

  const populateFormFromExtracted = (data: ExtractedMetadata) => {
    setProjectName(data.project_name || projectNameDefault || '');
    setClientName(data.client_name || data.demand_agency || '');
    setDemandAgency(data.demand_agency || data.client_name || '');
    setContractAgency(data.contract_agency || '');
    setClientType(data.client_type || 'UNKNOWN');
    setGoverningLaw(data.governing_law || 'UNKNOWN');
    setCompetitionMethod(data.competition_method || 'UNKNOWN');
    setAwardMethod(data.award_method || 'UNKNOWN');
    setProcurementMethod(data.procurement_method || 'UNKNOWN');
    setBudgetAmount(data.budget_amount && data.budget_amount > 0 ? data.budget_amount : '');
    setEstimatedPrice(data.estimated_price && data.estimated_price > 0 ? data.estimated_price : '');
    setVatIncluded(data.vat_included !== undefined ? data.vat_included : true);
    setProjectPeriod(data.project_period || '');
  };

  const handleResetToExtracted = () => {
    if (extracted) {
      populateFormFromExtracted(extracted);
      setSaveSuccessMsg('AI 및 파서가 추출한 원본 값으로 복원했습니다.');
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    }
  };

  const handleReExtractWithAI = async () => {
    setIsReExtracting(true);
    setSaveSuccessMsg(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/metadata/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (res.ok) {
        const json = await res.json();
        const data = json.data;
        if (data) {
          setExtracted(data);
          if (data.authoritative) {
            setAuthoritative(data.authoritative);
            populateForm(data.authoritative);
          } else {
            populateFormFromExtracted(data);
          }
          setSaveSuccessMsg(
            data.is_ai_powered
              ? '✨ AI Document Mapper & Specialist 파이프라인으로 사업정보를 정밀 재추출했습니다.'
              : '사업정보를 재추출했습니다.'
          );
        }
      } else {
        alert('AI 사업정보 재추출 중 오류가 발생했습니다.');
      }
    } catch (e: any) {
      console.error(e);
      alert('AI 재추출 요청 실패: ' + (e?.message || e));
    } finally {
      setIsReExtracting(false);
    }
  };

  const handleAutoRecommendLaw = (selectedType: ClientType) => {
    setClientType(selectedType);
    if (selectedType === 'LOCAL_GOVERNMENT') {
      setGoverningLaw('LOCAL_CONTRACT_ACT');
    } else if (selectedType === 'CENTRAL_GOVERNMENT') {
      setGoverningLaw('STATE_CONTRACT_ACT');
    } else if (selectedType === 'PUBLIC_INSTITUTION') {
      setGoverningLaw('PUBLIC_ENTERPRISE_RULE');
    }
  };

  // Derive legacy combined method for backward compatibility
  const getDerivedProcurementMethod = (comp: CompetitionMethod, awd: AwardMethod): ProcurementMethod => {
    if (awd === 'NEGOTIATION') return 'NEGOTIATION';
    if (comp === 'RESTRICTED_COMPETITIVE') return 'RESTRICTED_COMPETITIVE';
    if (comp === 'OPEN_COMPETITIVE') return 'OPEN_COMPETITIVE';
    if (comp === 'PRIVATE_CONTRACT') return 'PRIVATE_CONTRACT';
    return 'UNKNOWN';
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setSaveSuccessMsg(null);

    const parsedBudget = budgetAmount !== '' ? Number(budgetAmount) : null;
    const parsedEstimated = estimatedPrice !== '' ? Number(estimatedPrice) : null;
    const derivedProc = getDerivedProcurementMethod(competitionMethod, awardMethod);

    const updatePayload: AuthoritativeMetadataUpdateDto = {
      project_name: projectName || '공공 정보화 사업',
      client_name: clientName || '',
      demand_agency: demandAgency || clientName || '',
      contract_agency: contractAgency || null,
      client_type: clientType,
      governing_law: governingLaw,
      procurement_method: derivedProc,
      competition_method: competitionMethod,
      award_method: awardMethod,
      budget_amount: parsedBudget,
      estimated_price: parsedEstimated,
      vat_included: vatIncluded,
      project_period: projectPeriod || null,
      confirmed_by: 'user_officer',
      note: note || '사업정보 확인 완료',
    };

    try {
      const res = await fetch(`/api/v1/projects/${projectId}/metadata/authoritative`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      if (!res.ok) {
        throw new Error(`저장 실패 (${res.status})`);
      }

      const json = await res.json();
      const savedAuth: AuthoritativeMetadata = json.data;
      setAuthoritative(savedAuth);
      setSaveSuccessMsg(`버전 ${savedAuth.version}으로 최종 확정 및 스냅샷 생성 완료!`);

      setTimeout(() => {
        onConfirmAndStartReview(savedAuth);
      }, 500);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const renderEvidenceBadge = (fieldKey: string) => {
    const status: EvidenceStatus = (extracted?.evidence_status as any)?.[fieldKey] || 'UNVERIFIED';
    const info = EVIDENCE_STATUS_LABELS[status] || EVIDENCE_STATUS_LABELS.UNVERIFIED;
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${info.color}`}>
        {info.badge}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Screen 2 Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                화면 2 (Screen 2)
              </span>
              <span className="text-xs font-semibold text-slate-500">
                AI Document Mapper &amp; Authoritative 확정
              </span>
              {authoritative && (
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Version {authoritative.version} 확정본
                </span>
              )}
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              사업 기본정보 검토 및 법령 확정
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 max-w-3xl leading-relaxed">
              AI Document Mapper 및 도메인별 검토 AI가 추출한 사업정보입니다.
              <strong>경쟁방법</strong>(일반/제한경쟁)과 <strong>낙찰자 결정방식</strong>(협상계약/적격심사)을 각각 검증하고,
              적용 법령을 확정하여 <strong>Rule Engine</strong>의 법적 정합성 심사를 시작하십시오.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleReExtractWithAI}
              disabled={isReExtracting}
              className="px-3.5 py-2 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
              title="AI Document Mapper와 Specialist를 가동하여 사업정보를 정밀 재분석합니다."
            >
              {isReExtracting ? (
                <RefreshCw className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              )}
              <span>{isReExtracting ? 'AI Mapper 분석 중...' : 'AI 파이프라인 재분석'}</span>
            </button>
            <button
              type="button"
              onClick={handleResetToExtracted}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition flex items-center gap-1.5"
              title="추출 원본 값으로 복원"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              <span>추출값 복원</span>
            </button>
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg text-xs sm:text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition flex items-center gap-2 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4 text-blue-100" />
              <span>{isSaving ? '확정 저장 중...' : '확인 후 검토 시작'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {saveSuccessMsg && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}

        {/* Evidence Status Summary Banner */}
        {hasAutoPopulated && (
          <div className="mt-4 space-y-2.5">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <span className="p-1 rounded-md bg-blue-600 text-white shrink-0">
                  <FileSearch className="w-3.5 h-3.5" />
                </span>
                <div>
                  <span className="font-bold text-slate-900">
                    {extracted?.is_ai_powered ? 'AI 파이프라인 v4 정밀 근거 검증 완료: ' : '문서 사업정보 추출 완료: '}
                  </span>
                  <span className="text-slate-600">
                    {clientName ? `수요기관(${clientName}), ` : ''}
                    경쟁방식({COMPETITION_METHOD_LABELS[competitionMethod]?.label || '미확인'}),
                    낙찰방식({AWARD_METHOD_LABELS[awardMethod]?.label || '미확인'})
                    {budgetAmount ? `, 예산(${Number(budgetAmount).toLocaleString()}원)` : ', 예산(미기재)'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold bg-white border border-slate-200 text-slate-700">
                  <Cpu className="w-3 h-3 text-blue-600" />
                  {extracted?.model_used || 'gemini-3.8-flash'}
                </span>
              </div>
            </div>

            {/* Metadata Extractor v4 Pipeline Progression Summary */}
            {extracted?.pipeline_stats && (
              <div className="p-2.5 px-3 rounded-lg bg-indigo-50/70 border border-indigo-200/80 text-[11px] text-indigo-900 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-indigo-950 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-indigo-600" />
                    <span>Metadata Extractor v4 진행:</span>
                  </span>
                  <span className="text-indigo-800">
                    AI Explorer: <strong>{extracted.pipeline_stats.exploration_rounds}회 문서 탐색</strong> ({extracted.pipeline_stats.tool_calls_count}회 도구 호출)
                  </span>
                  <span className="text-indigo-300">|</span>
                  <span className="text-indigo-800">
                    Specialists: <strong>{extracted.pipeline_stats.specialists_count}개 분야 분석</strong>
                  </span>
                  <span className="text-indigo-300">|</span>
                  <span className="text-indigo-800">
                    Metadata Judge: <strong>{extracted.pipeline_stats.judge_executed ? '검증 완료' : '진행'}</strong>
                  </span>
                  <span className="text-indigo-300">|</span>
                  <span className="text-indigo-800">
                    Source Validator: <strong>{extracted.pipeline_stats.source_validator.verified_evidence_count}/{extracted.pipeline_stats.source_validator.total_evidence_checked}</strong> 근거 검증 성공
                  </span>
                </div>
                {extracted.pipeline_stats.judge_reexploration_triggered && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-200">
                    🎯 1차 타겟 재탐색 반영
                  </span>
                )}
              </div>
            )}

            {/* Conflict Detected Alert Banner */}
            {extracted?.evidence_status &&
              Object.values(extracted.evidence_status).some((st) => st === 'CONFLICT') && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <div>
                    <strong className="font-bold">상충 정보 감지:</strong> 문서 내 기재 내용(개요 vs 세부내용 또는 본문 vs 표)에 불일치가 발견되었습니다. 상충 항목을 주의 깊게 확인한 후 확정하십시오.
                  </div>
                </div>
              )}
          </div>
        )}

        {/* AI Method Reasoning & Evidence Quotes */}
        {extracted?.procurement_method_reason && (
          <div className="mt-3 p-3.5 rounded-xl bg-indigo-50/90 border border-indigo-200 text-xs text-indigo-950 space-y-2 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="font-bold text-indigo-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>AI 판단 근거 및 원문 인용 (Source Quotes)</span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] bg-indigo-200/80 text-indigo-900 font-semibold">
                편향 없는 사실 기반 판정
              </span>
            </div>
            <p className="text-slate-700 text-[11px] leading-relaxed">
              {extracted.procurement_method_reason}
            </p>

            {extracted.evidence_quotes && Object.keys(extracted.evidence_quotes).length > 0 && (
              <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                {extracted.evidence_quotes.project_name && (
                  <div className="p-2 rounded bg-white/90 border border-indigo-100 flex items-start gap-1.5">
                    <Quote className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-800">[사업명] </span>
                      <span className="text-slate-700">"{extracted.evidence_quotes.project_name.quote}"</span>
                      <span className="ml-1 text-[10px] font-mono text-slate-400">({extracted.evidence_quotes.project_name.block_id})</span>
                    </div>
                  </div>
                )}
                {extracted.evidence_quotes.client_name && (
                  <div className="p-2 rounded bg-white/90 border border-indigo-100 flex items-start gap-1.5">
                    <Quote className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-800">[수요기관] </span>
                      <span className="text-slate-700">"{extracted.evidence_quotes.client_name.quote}"</span>
                      <span className="ml-1 text-[10px] font-mono text-slate-400">({extracted.evidence_quotes.client_name.block_id})</span>
                    </div>
                  </div>
                )}
                {extracted.evidence_quotes.competition_method && (
                  <div className="p-2 rounded bg-white/90 border border-indigo-100 flex items-start gap-1.5">
                    <Quote className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-800">[경쟁방법] </span>
                      <span className="text-slate-700">"{extracted.evidence_quotes.competition_method.quote}"</span>
                      <span className="ml-1 text-[10px] font-mono text-slate-400">({extracted.evidence_quotes.competition_method.block_id})</span>
                    </div>
                  </div>
                )}
                {extracted.evidence_quotes.award_method && (
                  <div className="p-2 rounded bg-white/90 border border-indigo-100 flex items-start gap-1.5">
                    <Quote className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-800">[낙찰자결정] </span>
                      <span className="text-slate-700">"{extracted.evidence_quotes.award_method.quote}"</span>
                      <span className="ml-1 text-[10px] font-mono text-slate-400">({extracted.evidence_quotes.award_method.block_id})</span>
                    </div>
                  </div>
                )}
                {extracted.evidence_quotes.budget_amount && (
                  <div className="p-2 rounded bg-white/90 border border-indigo-100 flex items-start gap-1.5">
                    <Quote className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-800">[사업예산] </span>
                      <span className="text-slate-700">"{extracted.evidence_quotes.budget_amount.quote}"</span>
                      <span className="ml-1 text-[10px] font-mono text-slate-400">({extracted.evidence_quotes.budget_amount.block_id})</span>
                    </div>
                  </div>
                )}
                {extracted.evidence_quotes.estimated_price && (
                  <div className="p-2 rounded bg-white/90 border border-indigo-100 flex items-start gap-1.5">
                    <Quote className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-800">[추정가격] </span>
                      <span className="text-slate-700">"{extracted.evidence_quotes.estimated_price.quote}"</span>
                      <span className="ml-1 text-[10px] font-mono text-slate-400">({extracted.evidence_quotes.estimated_price.block_id})</span>
                    </div>
                  </div>
                )}
                {extracted.evidence_quotes.project_period && (
                  <div className="p-2 rounded bg-white/90 border border-indigo-100 flex items-start gap-1.5">
                    <Quote className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-800">[사업기간] </span>
                      <span className="text-slate-700">"{extracted.evidence_quotes.project_period.quote}"</span>
                      <span className="ml-1 text-[10px] font-mono text-slate-400">({extracted.evidence_quotes.project_period.block_id})</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Grid: Form (Left) & Metadata Architecture (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: The Interactive Form */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-6"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-blue-600" />
              <span>핵심 사업정보 검증 및 확정 (Authoritative Inputs)</span>
            </h3>
            <span className="text-[11px] text-slate-500">
              * 담당자가 검토 후 확정하면 불변 스냅샷이 생성됩니다.
            </span>
          </div>

          {/* Field 1: Project Name */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">
                사업명 (과업명)
              </label>
              {renderEvidenceBadge('project_name')}
            </div>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
              placeholder="예: 2026년 지능형 차세대 행정정보시스템 구축"
            />
          </div>

          {/* Field 2 & 2-1: Demand Agency & Contract Agency */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  수요기관 (실사용 / 발주부서)
                </label>
                {renderEvidenceBadge('client_name')}
              </div>
              <input
                type="text"
                value={clientName}
                onChange={(e) => {
                  setClientName(e.target.value);
                  setDemandAgency(e.target.value);
                }}
                required
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                placeholder="예: 서울특별시 강남구"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                과업의 실수요자/발주부서
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  계약/공고기관 (조달 주체)
                </label>
                <span className="text-[10px] text-slate-400">자체계약 / 조달청</span>
              </div>
              <input
                type="text"
                value={contractAgency}
                onChange={(e) => setContractAgency(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                placeholder="예: 조달청 (또는 자체발주)"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                입찰 공고 및 계약 체결 기관
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  수요기관 유형 (Client Type)
                </label>
                {renderEvidenceBadge('client_type')}
              </div>
              <select
                value={clientType}
                onChange={(e) => handleAutoRecommendLaw(e.target.value as ClientType)}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition"
              >
                <option value="UNKNOWN">미지정 / 확인 필요 (선택 필요)</option>
                <option value="LOCAL_GOVERNMENT">지방자치단체 (시·도, 구청, 시청)</option>
                <option value="CENTRAL_GOVERNMENT">국가기관 / 중앙행정기관 (부·처·청)</option>
                <option value="PUBLIC_INSTITUTION">공공기관 / 공기업 / 준정부기관</option>
                <option value="EDUCATIONAL">교육청 / 국공립학교</option>
                <option value="OTHER">기타 공공단체</option>
              </select>
              <p className="mt-1 text-[11px] text-blue-600">
                * 유형 선택 시 권장 계약법령이 자동 매핑됩니다.
              </p>
            </div>
          </div>

          {/* Field 4: Governing Law */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-blue-600" />
                <span>적용 계약법령 (Governing Law)</span>
              </label>
              {renderEvidenceBadge('governing_law')}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              {(['LOCAL_CONTRACT_ACT', 'STATE_CONTRACT_ACT', 'UNKNOWN'] as GoverningLaw[]).map((law) => {
                const info = GOVERNING_LAW_LABELS[law];
                const isSelected = governingLaw === law;
                return (
                  <button
                    key={law}
                    type="button"
                    onClick={() => setGoverningLaw(law)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'bg-white border-blue-600 ring-2 ring-blue-500/20 shadow-xs'
                        : 'bg-white/60 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-bold ${isSelected ? 'text-blue-900' : 'text-slate-800'}`}>
                        {info.short}
                      </span>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />}
                    </div>
                    <div className="text-[11px] text-slate-500 leading-snug">
                      {info.label}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Warning indicator when Local Government is paired with State Law or vice versa */}
            {clientType === 'LOCAL_GOVERNMENT' && governingLaw === 'STATE_CONTRACT_ACT' && (
              <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  <strong>주의:</strong> 지방자치단체는 원칙적으로 지방계약법이 적용됩니다. 국가계약법을 선택할 경우 법령 불일치 지적사항이 발생할 수 있습니다.
                </span>
              </div>
            )}
          </div>

          {/* Field 5-A: Competition Method (입찰/경쟁 형태) */}
          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <div>
                <label className="text-xs font-bold text-slate-900">
                  1. 입찰(경쟁) 형태 (Competition Method)
                </label>
                <p className="text-[11px] text-slate-500">참가 자격 및 경쟁 범위 결정</p>
              </div>
              {renderEvidenceBadge('competition_method')}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(['RESTRICTED_COMPETITIVE', 'OPEN_COMPETITIVE', 'NOMINATED_COMPETITIVE', 'PRIVATE_CONTRACT', 'UNKNOWN'] as CompetitionMethod[]).map(
                (method) => {
                  const info = COMPETITION_METHOD_LABELS[method];
                  const isSelected = competitionMethod === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setCompetitionMethod(method)}
                      className={`p-2.5 rounded-lg border text-center transition-all ${
                        isSelected
                          ? 'bg-blue-600 text-white font-bold shadow-xs border-blue-600'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-xs">{info.label}</div>
                    </button>
                  );
                }
              )}
            </div>
            <p className="text-[11px] text-slate-500 pt-0.5">
              설명: {COMPETITION_METHOD_LABELS[competitionMethod]?.desc}
            </p>
          </div>

          {/* Field 5-B: Award Method (낙찰자 결정방식) */}
          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <div>
                <label className="text-xs font-bold text-slate-900">
                  2. 낙찰자 결정방식 (Award Method)
                </label>
                <p className="text-[11px] text-slate-500">평가 기준 및 선정 절차</p>
              </div>
              {renderEvidenceBadge('award_method')}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['NEGOTIATION', 'QUALIFICATION_REVIEW', 'LOWEST_PRICE', 'TWO_STAGE'] as AwardMethod[]).map(
                (method) => {
                  const info = AWARD_METHOD_LABELS[method];
                  const isSelected = awardMethod === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setAwardMethod(method)}
                      className={`p-2.5 rounded-lg border text-center transition-all ${
                        isSelected
                          ? 'bg-indigo-600 text-white font-bold shadow-xs border-indigo-600'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-xs">{info.label}</div>
                    </button>
                  );
                }
              )}
            </div>
            <p className="text-[11px] text-slate-500 pt-0.5">
              설명: {AWARD_METHOD_LABELS[awardMethod]?.desc}
            </p>
          </div>

          {/* Combined summary tag */}
          <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-center justify-between">
            <span className="font-semibold">
              종합 계약 분류: <strong>{COMPETITION_METHOD_LABELS[competitionMethod]?.label}</strong> + <strong>{AWARD_METHOD_LABELS[awardMethod]?.label}</strong>
            </span>
            <span className="text-[11px] text-blue-700 font-mono">
              (호환코드: {getDerivedProcurementMethod(competitionMethod, awardMethod)})
            </span>
          </div>

          {/* Field 6 & 7: Budget & Estimated Price */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  사업예산 (원, 부가세 포함)
                </label>
                {renderEvidenceBadge('budget_amount')}
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={budgetAmount}
                  placeholder="문서에 예산 미기재 (직접 입력 가능)"
                  onChange={(e) => {
                    const rawVal = e.target.value;
                    if (rawVal === '') {
                      setBudgetAmount('');
                      setEstimatedPrice('');
                    } else {
                      const numVal = Number(rawVal);
                      setBudgetAmount(numVal);
                      if (estimatedPrice === '') {
                        setEstimatedPrice(Math.round(numVal / 1.1));
                      }
                    }
                  }}
                  className="w-full pl-3.5 pr-8 py-2 rounded-lg border border-slate-300 text-sm font-mono font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-400 placeholder:font-sans placeholder:text-xs"
                />
                <span className="absolute right-3 top-2 text-xs text-slate-400">원</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 font-mono">
                {budgetAmount !== '' && Number(budgetAmount) > 0 ? (
                  `₩ ${Number(budgetAmount).toLocaleString()} 원`
                ) : (
                  <span className="text-slate-400 font-sans text-[11px]">미입력 시 예산 관련 검증은 유예됩니다.</span>
                )}
              </p>
              {/* VAT Included Toggle */}
              <div className="mt-2 flex items-center gap-3 text-xs text-slate-700">
                <span className="font-semibold text-slate-600">부가세:</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="vatIncluded"
                    checked={vatIncluded === true}
                    onChange={() => setVatIncluded(true)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span>포함 (기본)</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="vatIncluded"
                    checked={vatIncluded === false}
                    onChange={() => setVatIncluded(false)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span>별도</span>
                </label>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  추정가격 (원, 부가세 제외)
                </label>
                {renderEvidenceBadge('estimated_price')}
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={estimatedPrice}
                  placeholder="추정가격 미기재 (직접 입력)"
                  onChange={(e) => {
                    const rawVal = e.target.value;
                    setEstimatedPrice(rawVal === '' ? '' : Number(rawVal));
                  }}
                  className="w-full pl-3.5 pr-8 py-2 rounded-lg border border-slate-300 text-sm font-mono font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-400 placeholder:font-sans placeholder:text-xs"
                />
                <span className="absolute right-3 top-2 text-xs text-slate-400">원</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 font-mono">
                {estimatedPrice !== '' && Number(estimatedPrice) > 0 ? (
                  `₩ ${Number(estimatedPrice).toLocaleString()} 원`
                ) : (
                  <span className="text-slate-400 font-sans text-[11px]">미기재 (강제 계산값 대입 금지됨)</span>
                )}
              </p>
              {extracted?.derivation_note && (
                <p className="mt-1 text-[11px] text-indigo-600 bg-indigo-50/70 px-2 py-0.5 rounded border border-indigo-100">
                  💡 {extracted.derivation_note}
                </p>
              )}

              {/* Calculated Candidates (e.g. Budget / 1.1) */}
              {extracted?.calculated_candidates && extracted.calculated_candidates.length > 0 && (
                <div className="mt-2.5 p-2.5 rounded-lg bg-indigo-50/90 border border-indigo-200 text-xs text-indigo-950 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-indigo-900 flex items-center gap-1.5 text-[11px]">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      참고 계산 후보값 (공급가액 역산 등)
                    </span>
                    <span className="text-[10px] text-indigo-600 bg-indigo-100/80 px-1.5 py-0.5 rounded">참고용</span>
                  </div>
                  {extracted.calculated_candidates.map((cand, cIdx) => (
                    <div key={cIdx} className="flex items-center justify-between pt-1 border-t border-indigo-100 text-[11px]">
                      <div>
                        <div className="font-medium text-slate-800">{cand.label}</div>
                        <div className="text-slate-500 text-[10px]">{cand.note}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono font-bold text-indigo-700">₩ {cand.amount.toLocaleString()}원</span>
                        <button
                          type="button"
                          onClick={() => setEstimatedPrice(cand.amount)}
                          className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold transition shadow-2xs"
                          title="이 계산값을 추정가격 입력란에 반영합니다."
                        >
                          반영
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Field 8: Project Period & Note */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  사업기간
                </label>
                {renderEvidenceBadge('project_period')}
              </div>
              <input
                type="text"
                value={projectPeriod}
                onChange={(e) => setProjectPeriod(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-400 placeholder:text-xs"
                placeholder="문서 내 기간 미기재 시 직접 입력 (예: 착수일로부터 6개월)"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                검토자 메모 (Authoritative Note)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-400 placeholder:text-xs"
                placeholder="예: 제한경쟁 및 협상계약 확인, 지자체 발주 검증 완료"
              />
            </div>
          </div>

          {/* Action Row */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              최종 수정자: <strong>user_officer</strong>
            </span>

            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-blue-200" />
              <span>{isSaving ? '확정 저장 중...' : '확인 후 검토 시작'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Right 1 Column: Metadata Decoupled Architecture & Live State */}
        <div className="space-y-4">
          {/* Decoupled State Status Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5 uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              2단계 분리 관리 상태 (Decoupled)
            </h4>

            <div className="space-y-2.5 text-xs">
              {/* Box 1: Extracted */}
              <div className="p-3 rounded-lg bg-blue-50/60 border border-blue-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-blue-900">1. Extracted Metadata</span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-blue-200/70 text-blue-800 font-bold">
                    AI 자동 추출
                  </span>
                </div>
                <div className="text-slate-600 space-y-0.5 text-[11px]">
                  <div>수요기관: <strong>{extracted?.demand_agency || extracted?.client_name || '미감지'}</strong></div>
                  {extracted?.contract_agency && <div>계약기관: <strong className="text-blue-700">{extracted.contract_agency}</strong></div>}
                  <div>경쟁방법: <strong>{COMPETITION_METHOD_LABELS[extracted?.competition_method || 'UNKNOWN']?.label}</strong></div>
                  <div>낙찰방법: <strong>{AWARD_METHOD_LABELS[extracted?.award_method || 'UNKNOWN']?.label}</strong></div>
                  <div>사업예산: {extracted?.budget_amount ? `${Number(extracted.budget_amount).toLocaleString()}원 (${extracted?.vat_included !== false ? '부가세 포함' : '부가세 별도'})` : '문서 미기재'}</div>
                  <div>사업기간: {extracted?.project_period || '문서 미기재'}</div>
                  <div>엔진: <span className="text-indigo-700 font-semibold">{extracted?.analysis_engine === 'AI' ? (extracted.model_used || 'Gemini AI') : '규칙 엔진'}</span></div>
                </div>
              </div>

              {/* Box 2: Authoritative */}
              <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-emerald-900">2. Authoritative Metadata</span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-200/70 text-emerald-800 font-bold">
                    v{authoritative?.version || 1} 확정본
                  </span>
                </div>
                <div className="text-slate-600 space-y-0.5 text-[11px]">
                  <div>수요기관: <strong>{authoritative?.demand_agency || authoritative?.client_name || clientName || '미지정'}</strong></div>
                  {authoritative?.contract_agency && <div>계약기관: <strong className="text-emerald-800">{authoritative.contract_agency}</strong></div>}
                  <div>확정경쟁: <strong>{COMPETITION_METHOD_LABELS[authoritative?.competition_method || competitionMethod]?.label}</strong></div>
                  <div>확정낙찰: <strong>{AWARD_METHOD_LABELS[authoritative?.award_method || awardMethod]?.label}</strong></div>
                  <div>확정법령: <strong className="text-emerald-800">{GOVERNING_LAW_LABELS[authoritative?.governing_law || governingLaw]?.short}</strong></div>
                  <div>확정예산: {authoritative?.budget_amount ? `${Number(authoritative.budget_amount).toLocaleString()}원 (${authoritative?.vat_included !== false ? '부가세 포함' : '부가세 별도'})` : '미기재 (유예)'}</div>
                  <div>확정자: {authoritative?.confirmed_by || 'user_officer'}</div>
                  <div className="text-slate-400 font-mono text-[10px]">
                    {authoritative?.updated_at ? new Date(authoritative.updated_at).toLocaleString() : '미확정'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Evidence Status Legend */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-2.5">
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <FileCheck2 className="w-3.5 h-3.5 text-slate-600" />
              <span>근거 상태 범례 (Evidence Status)</span>
            </h4>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  ● 문서 명시
                </span>
                <span className="text-slate-600">문서 본문/표에 단어 및 숫자가 직접 기재됨</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  ● 문맥상 판단
                </span>
                <span className="text-slate-600">수요기관 명칭 등으로부터 확실하게 도출됨</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  ● 산출/계산값
                </span>
                <span className="text-slate-600">총예산 기준 부가세(10%) 역산 공급가액</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                  ○ 확인 불가
                </span>
                <span className="text-slate-600">문서에 기재되지 않음 (담당자 직접 입력 필요)</span>
              </div>
            </div>
          </div>

          {/* Review Plan Status Card (AI 구매검토관 자율 계획) */}
          <div className="bg-white rounded-2xl border border-indigo-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-indigo-950 flex items-center gap-1.5 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                AI 맞춤형 검토 계획 (Review Plan)
              </h4>
              {isLoadingPlan && <RefreshCw className="w-3 h-3 text-indigo-500 animate-spin" />}
            </div>

            {reviewPlan ? (
              <div className="space-y-2.5 text-xs">
                <div className="p-2.5 rounded-lg bg-indigo-50/70 border border-indigo-100">
                  <div className="text-[11px] font-bold text-indigo-900 mb-0.5">
                    {reviewPlan.project_type_classification}
                  </div>
                  <div className="text-[10px] text-slate-600">
                    전체 {reviewPlan.focus_areas?.length || 0}대 핵심 영역 맞춤 검토 설계 완료
                  </div>
                </div>

                {/* Priority Areas */}
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-semibold text-slate-700">중점 검토 영역 및 우선순위:</div>
                  <div className="space-y-1">
                    {reviewPlan.focus_areas?.slice(0, 4).map((fa: any, fIdx: number) => (
                      <div key={fIdx} className="flex items-start justify-between text-[11px] p-1.5 rounded bg-slate-50 border border-slate-200">
                        <div className="pr-2">
                          <span className="font-medium text-slate-800">{fa.area_name}</span>
                          <div className="text-[10px] text-slate-500 leading-tight mt-0.5">{fa.rationale}</div>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${
                          fa.priority === 'HIGH' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {fa.priority}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Risk Profile Highlights */}
                {reviewPlan.risk_profile && (
                  <div className="p-2 rounded bg-amber-50/80 border border-amber-200 text-[10px] text-amber-900 space-y-0.5">
                    <div className="font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-amber-600" />
                      주요 위험 프로파일
                    </div>
                    <div>법령 정합성: {reviewPlan.risk_profile.statute_violation_risk}</div>
                    <div>공정성/참가자격: {reviewPlan.risk_profile.fairness_barrier_risk}</div>
                    <div>지재권/보안: {reviewPlan.risk_profile.ip_security_risk}</div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                사업정보 확정 시 Document Navigator가 문서를 탐색하여 맞춤형 Review Plan을 즉시 수립합니다.
              </p>
            )}
          </div>

          {/* Quick Preset Testing Card */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-slate-600" />
              <span>빠른 시나리오 프리셋 테스트</span>
            </h4>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              규칙 엔진의 법령 정합성 룰(<code>RULE-META-001</code>) 동작을 테스트하기 위해 아래 프리셋을 적용해 보세요:
            </p>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setClientName('서울특별시 강남구');
                  setClientType('LOCAL_GOVERNMENT');
                  setGoverningLaw('LOCAL_CONTRACT_ACT');
                  setCompetitionMethod('RESTRICTED_COMPETITIVE');
                  setAwardMethod('NEGOTIATION');
                  setNote('지자체 발주 시나리오 (국가계약법 혼용 시 위반 탐지)');
                }}
                className="w-full text-left p-2.5 rounded-lg bg-white border border-slate-200 hover:border-blue-300 text-xs font-medium transition"
              >
                <div className="font-bold text-slate-900">시나리오 A: 지방자치단체 (강남구)</div>
                <div className="text-[11px] text-slate-500">
                  제한경쟁 + 협상계약 + 지방계약법 확정 → 국가계약법 조항 즉시 적발
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setClientName('행정안전부');
                  setClientType('CENTRAL_GOVERNMENT');
                  setGoverningLaw('STATE_CONTRACT_ACT');
                  setCompetitionMethod('OPEN_COMPETITIVE');
                  setAwardMethod('NEGOTIATION');
                  setNote('국가기관 발주 시나리오');
                }}
                className="w-full text-left p-2.5 rounded-lg bg-white border border-slate-200 hover:border-blue-300 text-xs font-medium transition"
              >
                <div className="font-bold text-slate-900">시나리오 B: 중앙행정기관 (행안부)</div>
                <div className="text-[11px] text-slate-500">
                  일반경쟁 + 협상계약 + 국가계약법 확정 → 정상 처리
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
