import React, { useState } from 'react';
import {
  X,
  MapPin,
  FileText,
  Copy,
  Check,
  ExternalLink,
  BookOpen,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { Finding, CATEGORY_META } from '../types/finding';

interface SourceViewerModalProps {
  finding: Finding | null;
  onClose: () => void;
  onNavigateToDocumentViewer?: (blockId: string) => void;
}

export const SourceViewerModal: React.FC<SourceViewerModalProps> = ({
  finding,
  onClose,
  onNavigateToDocumentViewer,
}) => {
  const [copied, setCopied] = useState(false);

  if (!finding) return null;

  const primaryRef = finding.source_refs[0];
  const locator = primaryRef?.native_locator;
  const categoryMeta = CATEGORY_META[finding.category] || CATEGORY_META.RULE_FIX;

  const handleCopyText = () => {
    if (finding.original_text) {
      navigator.clipboard.writeText(finding.original_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleJumpToViewer = () => {
    if (primaryRef && onNavigateToDocumentViewer) {
      onNavigateToDocumentViewer(primaryRef.block_id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 헤더 */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <span className={`px-2.5 py-1 rounded-md text-xs font-bold border ${categoryMeta.badgeClass}`}>
              {categoryMeta.label}
            </span>
            <span className="text-xs font-mono font-medium text-slate-500 bg-slate-200/80 px-2 py-0.5 rounded">
              {finding.rule_id}
            </span>
            <h3 className="text-sm font-bold text-slate-900 truncate max-w-md">
              {finding.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 모달 본문 */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {/* HWP Native Locator 좌표 정보 */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-blue-600" />
                <span>HWP 원본 문서 위치 좌표 (Native Locator)</span>
              </span>
              <span className="text-xs font-mono font-semibold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                Block ID: {primaryRef?.block_id || 'para_0'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                <span className="text-slate-500 block">구역 (Section)</span>
                <span className="font-bold text-slate-800 text-sm">
                  {locator?.section_index !== undefined ? `${locator.section_index}구역` : '0구역'}
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                <span className="text-slate-500 block">문단 (Paragraph)</span>
                <span className="font-bold text-slate-800 text-sm">
                  {locator?.paragraph_index !== undefined
                    ? `${locator.paragraph_index + 1}번째 문단`
                    : '해당 없음'}
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                <span className="text-slate-500 block">표 (Table)</span>
                <span className="font-bold text-slate-800 text-sm">
                  {locator?.table_index !== undefined
                    ? `${locator.table_index + 1}번째 표`
                    : '일반 문단'}
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                <span className="text-slate-500 block">셀 좌표 (Row / Col)</span>
                <span className="font-bold text-slate-800 text-sm">
                  {locator?.row !== undefined && locator?.col !== undefined
                    ? `${locator.row + 1}행 ${locator.col + 1}열`
                    : '-'}
                </span>
              </div>
            </div>
          </div>

          {/* 원문 내용 표시 영역 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-slate-500" />
                <span>문서 원문 발췌 내용</span>
              </span>
              <button
                onClick={handleCopyText}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded transition"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700 font-semibold">복사 완료</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>원문 복사</span>
                  </>
                )}
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 text-slate-100 font-serif leading-relaxed text-sm whitespace-pre-wrap border border-slate-800 shadow-inner">
              {finding.original_text}
            </div>

            {finding.matched_keyword && (
              <div className="mt-2 text-xs text-slate-500 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span>
                  탐지 트리거 키워드:{' '}
                  <span className="font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                    {finding.matched_keyword}
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* 권고안 및 법적 근거 요약 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="bg-emerald-50/70 border border-emerald-200 p-3 rounded-xl">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900 mb-1">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                <span>수정/협의 권고안</span>
              </div>
              <p className="text-xs text-emerald-950 leading-relaxed font-medium">
                {finding.recommendation}
              </p>
            </div>

            <div className="bg-blue-50/70 border border-blue-200 p-3 rounded-xl">
              <div className="flex items-center gap-1.5 text-xs font-bold text-blue-900 mb-1">
                <BookOpen className="w-3.5 h-3.5 text-blue-600" />
                <span>관련 법령 / 기준</span>
              </div>
              <p className="text-xs text-blue-950 leading-relaxed font-medium">
                {finding.basis}
              </p>
            </div>
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            의사결정 상태: <strong className="text-slate-800">{finding.decision}</strong>
          </span>
          <div className="flex items-center gap-2">
            {primaryRef && onNavigateToDocumentViewer && (
              <button
                onClick={handleJumpToViewer}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>문서 뷰어로 이동</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 transition"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
