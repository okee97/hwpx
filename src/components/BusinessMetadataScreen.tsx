import React, { useState, useEffect } from 'react';
import {
  ExtractedMetadata,
  AuthoritativeMetadata,
  AuthoritativeMetadataUpdateDto,
  ClientType,
  GoverningLaw,
  ProcurementMethod,
  CLIENT_TYPE_LABELS,
  GOVERNING_LAW_LABELS,
  PROCUREMENT_METHOD_LABELS,
} from '../types/metadata';
import {
  Building2,
  Scale,
  DollarSign,
  Briefcase,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  Clock,
  History,
  AlertTriangle,
  ArrowRight,
  HelpCircle,
  FileCheck2,
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
  onNavigateToStructure,
}) => {
  const [extracted, setExtracted] = useState<ExtractedMetadata | null>(initialExtracted || null);
  const [authoritative, setAuthoritative] = useState<AuthoritativeMetadata | null>(initialAuthoritative || null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [hasAutoPopulated, setHasAutoPopulated] = useState(false);
  const [isReExtracting, setIsReExtracting] = useState(false);

  // Form states (No fabricated fallback numbers/strings)
  const [projectName, setProjectName] = useState(
    initialAuthoritative?.project_name || initialExtracted?.project_name || projectNameDefault || ''
  );
  const [clientName, setClientName] = useState(
    initialAuthoritative?.client_name || initialExtracted?.client_name || ''
  );
  const [clientType, setClientType] = useState<ClientType>(
    initialAuthoritative?.client_type || initialExtracted?.client_type || 'UNKNOWN'
  );
  const [governingLaw, setGoverningLaw] = useState<GoverningLaw>(
    initialAuthoritative?.governing_law || initialExtracted?.governing_law || 'UNKNOWN'
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
  const [note, setNote] = useState(initialAuthoritative?.note || '');

  // Initialize or fetch metadata when projectId or initial props change
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
      // 1. Fetch extracted
      const extRes = await fetch(`/api/v1/projects/${projectId}/metadata/extracted`);
      let extData: ExtractedMetadata | null = null;
      if (extRes.ok) {
        const json = await extRes.json();
        extData = json.data;
        setExtracted(extData);
      }

      // 2. Fetch authoritative
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
    } catch (e) {
      console.warn('Failed to load metadata:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const populateForm = (data: AuthoritativeMetadata) => {
    setProjectName(data.project_name || projectNameDefault || '');
    setClientName(data.client_name || '');
    setClientType(data.client_type || 'UNKNOWN');
    setGoverningLaw(data.governing_law || 'UNKNOWN');
    setProcurementMethod(data.procurement_method || 'UNKNOWN');
    setBudgetAmount(data.budget_amount && data.budget_amount > 0 ? data.budget_amount : '');
    setEstimatedPrice(data.estimated_price && data.estimated_price > 0 ? data.estimated_price : '');
    setProjectPeriod(data.project_period || '');
    setNote(data.note || '');
  };

  const populateFormFromExtracted = (data: ExtractedMetadata) => {
    setProjectName(data.project_name || projectNameDefault || '');
    setClientName(data.client_name || '');
    setClientType(data.client_type || 'UNKNOWN');
    setGoverningLaw(data.governing_law || 'UNKNOWN');
    setProcurementMethod(data.procurement_method || 'UNKNOWN');
    setBudgetAmount(data.budget_amount && data.budget_amount > 0 ? data.budget_amount : '');
    setEstimatedPrice(data.estimated_price && data.estimated_price > 0 ? data.estimated_price : '');
    setProjectPeriod(data.project_period || '');
  };

  const handleResetToExtracted = () => {
    if (extracted) {
      populateFormFromExtracted(extracted);
      setSaveSuccessMsg('AI 추출 원본 값으로 폼을 초기화했습니다.');
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
              ? '✨ Gemini AI가 제안요청서의 선정방식 및 본문을 정독하여 사업정보를 정밀 재추출했습니다.'
              : '사업정보를 성공적으로 재추출했습니다.'
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

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setSaveSuccessMsg(null);

    const parsedBudget = budgetAmount !== '' ? Number(budgetAmount) : null;
    const parsedEstimated = estimatedPrice !== '' ? Number(estimatedPrice) : null;

    const updatePayload: AuthoritativeMetadataUpdateDto = {
      project_name: projectName || '공공 정보화 사업',
      client_name: clientName || '',
      client_type: clientType,
      governing_law: governingLaw,
      procurement_method: procurementMethod,
      budget_amount: parsedBudget,
      estimated_price: parsedEstimated,
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

      // Trigger callback to start/re-run review with this authoritative metadata
      setTimeout(() => {
        onConfirmAndStartReview(savedAuth);
      }, 500);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
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
                Metadata Extractor &amp; Authoritative 확정
              </span>
              {authoritative && (
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Version {authoritative.version} 확정본
                </span>
              )}
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              사업 기본정보 확인 및 법령 확정
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 max-w-3xl leading-relaxed">
              AI가 HWP 본문 및 표에서 6대 핵심 사업 메타데이터를 자동 추출했습니다.
              지자체 발주 여부와 적용 법령을 직접 검증 및 수정하여 <strong>Authoritative Metadata</strong>로 확정하십시오.
              확정된 법령에 따라 <strong>Rule Engine</strong>의 법적 정합성 검사가 실행됩니다.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleReExtractWithAI}
              disabled={isReExtracting}
              className="px-3.5 py-2 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
              title="Gemini AI로 문서 본문 및 표를 정독하여 사업정보를 정밀 재추출합니다."
            >
              {isReExtracting ? (
                <RefreshCw className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              )}
              <span>{isReExtracting ? 'AI 본문 정밀 분석 중...' : 'Gemini AI 재분석'}</span>
            </button>
            <button
              type="button"
              onClick={handleResetToExtracted}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition flex items-center gap-1.5"
              title="AI가 추출한 원본 값으로 복원"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              <span>AI 추출값 초기화</span>
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

        {/* Auto-extracted confirmation banner */}
        {hasAutoPopulated && (
          <div className="mt-4 p-3.5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 text-blue-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-2.5">
              <span className="p-1 rounded-md bg-blue-600 text-white shrink-0">
                <Sparkles className="w-3.5 h-3.5" />
              </span>
              <div>
                <span className="font-bold">
                  {extracted?.is_ai_powered ? 'Gemini AI 문서 정독 사업정보 추출 완료: ' : '한글 문서 사업정보 자동 입력: '}
                </span>
                <span className="text-blue-800">
                  {clientName ? `수요기관(${clientName}), ` : ''}
                  계약방식({PROCUREMENT_METHOD_LABELS[procurementMethod]?.label || '협상에 의한 계약'})
                  {budgetAmount ? `, 예산(${Number(budgetAmount).toLocaleString()}원)` : ', 예산(문서 미기재)'}
                  {projectPeriod ? `, 기간(${projectPeriod})` : ''} 정보가 분석되었습니다.
                </span>
              </div>
            </div>
            <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-200/80 text-blue-900 shrink-0 self-start sm:self-center">
              AI 신뢰도 {Math.round((extracted?.confidence_scores?.procurement_method || extracted?.confidence_scores?.client_name || 0.95) * 100)}%
            </span>
          </div>
        )}

        {/* AI Procurement Method Reasoning Alert */}
        {extracted?.procurement_method_reason && (
          <div className="mt-3 p-3.5 rounded-xl bg-indigo-50/90 border border-indigo-200 text-xs text-indigo-950 flex items-start gap-2.5 shadow-2xs">
            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-indigo-900 flex items-center gap-2">
                <span>AI 계약방법 문맥 정밀 분석 결과</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-indigo-200/80 text-indigo-800 font-bold">
                  단순 키워드 매칭 오류 방지
                </span>
              </div>
              <p className="text-slate-700 text-[11px] leading-relaxed">
                {extracted.procurement_method_reason}
              </p>
              {extracted.extracted_snippets && Object.keys(extracted.extracted_snippets).length > 0 && (
                <div className="pt-1.5 flex flex-wrap gap-2 text-[10px]">
                  {extracted.extracted_snippets.selection_method && (
                    <span className="px-2 py-1 rounded bg-white/80 border border-indigo-200 text-slate-700">
                      <strong>선정방식 발췌:</strong> {extracted.extracted_snippets.selection_method}
                    </span>
                  )}
                  {extracted.extracted_snippets.budget && (
                    <span className="px-2 py-1 rounded bg-white/80 border border-indigo-200 text-slate-700">
                      <strong>예산 발췌:</strong> {extracted.extracted_snippets.budget}
                    </span>
                  )}
                  {extracted.extracted_snippets.period && (
                    <span className="px-2 py-1 rounded bg-white/80 border border-indigo-200 text-slate-700">
                      <strong>기간 발췌:</strong> {extracted.extracted_snippets.period}
                    </span>
                  )}
                </div>
              )}
            </div>
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
              <span>핵심 사업정보 입력 및 수정 (6대 필드)</span>
            </h3>
            <span className="text-[11px] text-slate-500">
              * 필드를 수정하면 자동으로 신규 스냅샷이 생성됩니다.
            </span>
          </div>

          {/* Field 1: Project Name */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              사업명 (과업명)
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
              placeholder="예: 2026년 지능형 차세대 행정정보시스템 구축"
            />
          </div>

          {/* Field 2 & 3: Demand Agency & Agency Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  수요기관명 (발주처)
                </label>
                {extracted?.confidence_scores.client_name && (
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                    AI 신뢰도 {(extracted.confidence_scores.client_name * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                required
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                placeholder="예: 서울특별시 강남구"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                AI 근거: <code>{extracted?.source_references.client_name || 'para_1'}</code> 문단
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                수요기관 유형 (Client Type)
              </label>
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
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                Rule Engine 기준값
              </span>
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

          {/* Field 5: Procurement Method */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">
                계약방법 (Procurement Method)
              </label>
              {extracted?.confidence_scores?.procurement_method && (
                <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                  AI 분석 신뢰도 {(extracted.confidence_scores.procurement_method * 100).toFixed(0)}%
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(['NEGOTIATION', 'RESTRICTED_COMPETITIVE', 'OPEN_COMPETITIVE', 'PRIVATE_CONTRACT', 'UNKNOWN'] as ProcurementMethod[]).map(
                (method) => {
                  const info = PROCUREMENT_METHOD_LABELS[method];
                  const isSelected = procurementMethod === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setProcurementMethod(method)}
                      className={`p-2.5 rounded-lg border text-center transition-all ${
                        isSelected
                          ? 'bg-blue-50 border-blue-500 text-blue-900 font-bold shadow-xs'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-xs">{info.label}</div>
                    </button>
                  );
                }
              )}
            </div>
            {extracted?.procurement_method_reason && (
              <div className="mt-2 text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-start gap-2">
                <span className="font-bold text-indigo-700 shrink-0">AI 판정 근거:</span>
                <span>{extracted.procurement_method_reason}</span>
              </div>
            )}
          </div>

          {/* Field 6 & 7: Budget & Estimated Price */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  사업예산 (원, 부가세 포함)
                </label>
                {budgetAmount !== '' && Number(budgetAmount) > 0 ? (
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                    금액 확인됨
                  </span>
                ) : (
                  <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                    문서 미기재 (직접 입력 가능)
                  </span>
                )}
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
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  추정가격 (원, 부가세 제외)
                </label>
                {estimatedPrice !== '' && Number(estimatedPrice) > 0 && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    부가세 제외 (약 10%)
                  </span>
                )}
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
                  <span className="text-slate-400 font-sans text-[11px]">미기재</span>
                )}
              </p>
              {extracted?.derivation_note && (
                <p className="mt-1 text-[11px] text-indigo-600 bg-indigo-50/70 px-2 py-0.5 rounded border border-indigo-100">
                  💡 {extracted.derivation_note}
                </p>
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
                {projectPeriod ? (
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                    추출/입력 완료
                  </span>
                ) : (
                  <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                    문서 미기재
                  </span>
                )}
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
                placeholder="예: 사업자선정방식 협상계약 확인, 지자체 발주 검증 완료"
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
                  <div>수요기관: <strong>{extracted?.client_name || '미감지'}</strong></div>
                  <div>계약방법: <strong>{PROCUREMENT_METHOD_LABELS[extracted?.procurement_method || 'NEGOTIATION']?.label}</strong></div>
                  <div>사업예산: {extracted?.budget_amount ? `${Number(extracted.budget_amount).toLocaleString()}원` : '문서 미기재'}</div>
                  <div>사업기간: {extracted?.project_period || '문서 미기재'}</div>
                  <div>추출엔진: <span className="text-indigo-700 font-semibold">{extracted?.is_ai_powered ? 'Gemini 2.5 Flash' : '규칙 엔진'}</span></div>
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
                  <div>확정기관: <strong>{authoritative?.client_name || clientName || '미지정'}</strong></div>
                  <div>확정방법: <strong>{PROCUREMENT_METHOD_LABELS[authoritative?.procurement_method || procurementMethod]?.label}</strong></div>
                  <div>확정법령: <strong className="text-emerald-800">{GOVERNING_LAW_LABELS[authoritative?.governing_law || governingLaw]?.short}</strong></div>
                  <div>확정예산: {authoritative?.budget_amount ? `${Number(authoritative.budget_amount).toLocaleString()}원` : '미기재 (유예)'}</div>
                  <div>확정자: {authoritative?.confirmed_by || 'user_officer'}</div>
                  <div className="text-slate-400 font-mono text-[10px]">
                    {authoritative?.updated_at ? new Date(authoritative.updated_at).toLocaleString() : '미확정'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Preset Testing Card (For demonstration) */}
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
                  setNote('지자체 발주 시나리오 (국가계약법 혼용 시 위반 탐지)');
                }}
                className="w-full text-left p-2.5 rounded-lg bg-white border border-slate-200 hover:border-blue-300 text-xs font-medium transition"
              >
                <div className="font-bold text-slate-900">시나리오 A: 지방자치단체 (강남구)</div>
                <div className="text-[11px] text-slate-500">
                  지방계약법 적용 확정 → 본문의 국가계약법 조항 즉시 적발
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setClientName('행정안전부');
                  setClientType('CENTRAL_GOVERNMENT');
                  setGoverningLaw('STATE_CONTRACT_ACT');
                  setNote('국가기관 발주 시나리오');
                }}
                className="w-full text-left p-2.5 rounded-lg bg-white border border-slate-200 hover:border-blue-300 text-xs font-medium transition"
              >
                <div className="font-bold text-slate-900">시나리오 B: 중앙행정기관 (행안부)</div>
                <div className="text-[11px] text-slate-500">
                  국가계약법 적용 확정 → 정상 처리
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
