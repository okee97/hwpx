import React, { useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  MapPin,
  Sparkles,
  BookOpen,
  ArrowRight,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import { Finding, DecisionStatus, CATEGORY_META } from '../types/finding';
import { Eye } from 'lucide-react';

interface FindingCardProps {
  finding: Finding;
  projectId: string;
  onDecisionChange: (findingId: string, decision: DecisionStatus, reason?: string) => Promise<void>;
  onNavigateToBlock?: (blockId: string) => void;
  onViewSource?: (finding: Finding) => void;
}

export const FindingCard: React.FC<FindingCardProps> = ({
  finding,
  projectId,
  onDecisionChange,
  onNavigateToBlock,
  onViewSource,
}) => {

  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [showReasonInput, setShowReasonInput] = useState<boolean>(false);
  const [reasonText, setReasonText] = useState<string>(finding.decision_reason || '');
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const handleDecision = async (decision: DecisionStatus) => {
    try {
      setIsUpdating(true);
      await onDecisionChange(finding.finding_id, decision, reasonText.trim() || undefined);
      setShowReasonInput(false);
    } catch (err) {
      console.error('Failed to update decision:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  // 문제 원문에서 키워드 하이라이트 처리
  const renderHighlightedText = (text: string, keyword: string) => {
    if (!keyword || !text.includes(keyword)) {
      return <span>{text}</span>;
    }
    const parts = text.split(keyword);
    return (
      <span>
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            {part}
            {i < parts.length - 1 && (
              <mark className="bg-red-100 text-red-900 font-semibold px-1 py-0.5 rounded border border-red-300">
                {keyword}
              </mark>
            )}
          </React.Fragment>
        ))}
      </span>
    );
  };

  const isAccepted = finding.decision === 'ACCEPTED';
  const isRejected = finding.decision === 'REJECTED';
  const isPending = finding.decision === 'PENDING';

  const categoryMeta = CATEGORY_META[finding.category] || CATEGORY_META.RULE_FIX;

  return (
    <div
      id={`finding-card-${finding.finding_id}`}
      className={`rounded-xl border transition-all duration-200 overflow-hidden shadow-sm ${
        isAccepted
          ? 'bg-emerald-50/40 border-emerald-300 ring-1 ring-emerald-200'
          : isRejected
          ? 'bg-slate-50 border-slate-300 opacity-90'
          : finding.category === 'FAIRNESS'
          ? 'bg-white border-purple-200 hover:border-purple-300 hover:shadow'
          : finding.category === 'AI_REVIEW'
          ? 'bg-white border-cyan-200 hover:border-cyan-300 hover:shadow'
          : 'bg-white border-rose-200 hover:border-rose-300 hover:shadow'
      }`}
    >
      {/* 카드 헤더 */}
      <div className="p-4 sm:p-5 pb-3 border-b border-slate-100 bg-gradient-to-r from-transparent via-transparent to-slate-50/50">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* 1. 카테고리 라벨 (4개 카테고리 대응) */}
            <span
              id={`finding-badge-cat-${finding.finding_id}`}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide border shadow-2xs ${categoryMeta.badgeClass}`}
            >
              <span className="w-2 h-2 rounded-full bg-current opacity-80"></span>
              {categoryMeta.label}
            </span>

            {/* 심각도 및 룰 식별자 */}
            <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200">
              {finding.rule_id}
            </span>

            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
              <AlertOctagon className="w-3 h-3 text-amber-600" />
              {finding.severity}
            </span>

            {/* 원문 보기 버튼 (상단 헤더) */}
            <button
              id={`btn-view-source-${finding.finding_id}`}
              onClick={() => {
                if (onViewSource) {
                  onViewSource(finding);
                } else if (onNavigateToBlock && finding.source_refs[0]) {
                  onNavigateToBlock(finding.source_refs[0].block_id);
                }
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-white text-slate-700 hover:text-blue-700 border border-slate-300 hover:border-blue-300 hover:bg-blue-50/50 transition shadow-2xs cursor-pointer ml-1"
              title="HWP 원본 문서 위치 및 세부 원문 보기"
            >
              <Eye className="w-3.5 h-3.5 text-blue-600" />
              <span>원문 보기</span>
            </button>
          </div>

          {/* 의사결정 상태 배지 */}
          <div className="flex items-center gap-2">
            {isAccepted && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                수용 완료
              </span>
            )}
            {isRejected && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-700 border border-slate-300">
                <XCircle className="w-3.5 h-3.5 text-slate-500" />
                불수용 (원문 유지)
              </span>
            )}
            {isPending && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                검토 대기중
              </span>
            )}

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
              title={isExpanded ? '접기' : '펼치기'}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>


        {/* 문제 제목 */}
        <div className="mt-2.5">
          <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{finding.title}</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 ml-7">
            규칙명: <span className="font-medium text-slate-700">{finding.rule_name}</span> • 매칭 키워드:{' '}
            <span className="font-semibold text-rose-700 bg-rose-50 px-1 rounded">
              "{finding.matched_keyword}"
            </span>
          </p>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 sm:p-5 space-y-4 text-sm">
          {/* 2. 문제 원문 텍스트 (original_text) */}
          <div className="rounded-lg border border-rose-200/80 bg-rose-50/50 p-3.5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-bold text-rose-900 uppercase tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-600"></span>
                탐지된 문서 원문
              </span>

              {finding.source_refs && finding.source_refs.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-rose-700">
                  <MapPin className="w-3.5 h-3.5" />
                  <span className="font-mono">{finding.source_refs[0].block_id}</span>
                  {finding.source_refs[0].native_locator && (
                    <span className="text-rose-600 font-sans">
                      (구역 {finding.source_refs[0].native_locator.section_index}
                      {finding.source_refs[0].native_locator.paragraph_index !== undefined
                        ? ` • 문단 ${finding.source_refs[0].native_locator.paragraph_index + 1}`
                        : ''}
                      )
                    </span>
                  )}
                  <button
                    onClick={() => {
                      if (onViewSource) {
                        onViewSource(finding);
                      } else if (onNavigateToBlock && finding.source_refs[0]) {
                        onNavigateToBlock(finding.source_refs[0].block_id);
                      }
                    }}
                    className="ml-2 text-xs font-semibold text-blue-700 hover:text-blue-900 underline flex items-center gap-0.5 cursor-pointer"
                  >
                    <Eye className="w-3 h-3" />
                    <span>원문 상세 보기</span>
                  </button>
                  {onNavigateToBlock && (
                    <button
                      onClick={() => onNavigateToBlock(finding.source_refs[0].block_id)}
                      className="ml-1.5 text-xs underline font-semibold text-slate-600 hover:text-slate-900"
                    >
                      (뷰어 이동)
                    </button>
                  )}

                </div>
              )}
            </div>

            <p className="text-sm font-serif text-slate-800 leading-relaxed bg-white/80 p-2.5 rounded border border-rose-100">
              {renderHighlightedText(finding.original_text, finding.matched_keyword)}
            </p>
          </div>

          {/* 3. 권고 문안 및 관련 근거 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* 권고 문안 (Recommendation) */}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900 mb-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <span>수정 권고 문안 (Recommendation)</span>
                </div>
                <p className="text-xs sm:text-sm text-emerald-950 font-medium leading-relaxed bg-white/90 p-2.5 rounded border border-emerald-100">
                  {finding.recommendation}
                </p>
              </div>
              <div className="mt-2 text-[11px] text-emerald-700 flex items-center gap-1">
                <ArrowRight className="w-3 h-3" />
                <span>수용 시 이 수정 권고안이 계약/공문서 초안에 반영됩니다.</span>
              </div>
            </div>

            {/* 관련 법령 및 규정 근거 (Basis) */}
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-blue-900 mb-1.5">
                  <BookOpen className="w-4 h-4 text-blue-600" />
                  <span>관련 근거 및 법적 기준 (Basis)</span>
                </div>
                <p className="text-xs sm:text-sm text-blue-950 leading-relaxed bg-white/90 p-2.5 rounded border border-blue-100">
                  {finding.basis}
                </p>
              </div>
              <div className="mt-2 text-[11px] text-blue-700">
                <span>공공 감사 및 개인정보보호 컴플라이언스 기준 준수</span>
              </div>
            </div>
          </div>

          {/* 사유 입력창 (선택사항) */}
          {showReasonInput && (
            <div className="pt-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                결정 사유 / 검토 의견 기록 (선택)
              </label>
              <textarea
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="예: 발주부서 사전 협의 완료에 따라 권고안 수용함 / 법령 특정 허용 조항 확인으로 원문 유지"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white text-slate-800"
                rows={2}
              />
            </div>
          )}

          {/* 기존 결정 기록 표시 */}
          {finding.decision_reason && !showReasonInput && (
            <div className="text-xs bg-slate-100 p-2 rounded text-slate-700 flex items-start gap-1.5">
              <span className="font-semibold text-slate-900 shrink-0">기록된 사유:</span>
              <span>{finding.decision_reason}</span>
            </div>
          )}

          {/* 4. [수용] / [불수용] 버튼 (클릭 시 API 호출 및 상태 반영) */}
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowReasonInput(!showReasonInput)}
                className="text-xs text-slate-500 hover:text-slate-800 underline transition-colors"
              >
                {showReasonInput ? '사유 입력 닫기' : '사유/비고 작성'}
              </button>
              {finding.decided_at && (
                <span className="text-[11px] text-slate-400">
                  최근 결정: {new Date(finding.decided_at).toLocaleTimeString('ko-KR')}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              {/* [수용] 버튼 */}
              <button
                id={`btn-accept-${finding.finding_id}`}
                onClick={() => handleDecision('ACCEPTED')}
                disabled={isUpdating}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-xs ${
                  isAccepted
                    ? 'bg-emerald-600 text-white shadow ring-2 ring-emerald-500/50'
                    : 'bg-emerald-50 hover:bg-emerald-600 text-emerald-800 hover:text-white border border-emerald-300 hover:border-emerald-600'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isUpdating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span>수용 (권고 반영)</span>
              </button>

              {/* [불수용] 버튼 */}
              <button
                id={`btn-reject-${finding.finding_id}`}
                onClick={() => handleDecision('REJECTED')}
                disabled={isUpdating}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-xs ${
                  isRejected
                    ? 'bg-slate-700 text-white shadow ring-2 ring-slate-400/50'
                    : 'bg-slate-100 hover:bg-slate-700 text-slate-700 hover:text-white border border-slate-300 hover:border-slate-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isUpdating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                <span>불수용 (원문 유지)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
