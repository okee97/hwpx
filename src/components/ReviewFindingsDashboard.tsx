import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  AlertTriangle,
  Info,
  Layers,
  FileCheck,
  Search,
  CheckCheck,
  Building2,
  Sparkles,
  Cpu,
  GitMerge,
  Scale,
  FileSearch,
  Eye,
  ArrowRight,
} from 'lucide-react';
import { Finding, DecisionStatus, RuleCategoryType, ReviewPipelineResponse } from '../types/finding';
import { HwpParseResult, DocumentBlock } from '../types';
import { AuthoritativeMetadata, GOVERNING_LAW_LABELS, CLIENT_TYPE_LABELS } from '../types/metadata';
import { FindingCard } from './FindingCard';
import { SourceViewerModal } from './SourceViewerModal';

interface ReviewFindingsDashboardProps {
  document: HwpParseResult;
  projectId?: string;
  onNavigateToBlock?: (blockId: string) => void;
  onNavigateToMetadata?: () => void;
}

type CategoryTabFilter = 'ALL' | 'RULE_FIX' | 'RULE_WARN' | 'FAIRNESS' | 'AI_REVIEW';

export const ReviewFindingsDashboard: React.FC<ReviewFindingsDashboardProps> = ({
  document,
  projectId = document.document_id || 'default-project',
  onNavigateToBlock,
  onNavigateToMetadata,
}) => {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [authoritativeMeta, setAuthoritativeMeta] = useState<AuthoritativeMetadata | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [pipelineStage, setPipelineStage] = useState<string | null>(null);
  const [lastPipelineSummary, setLastPipelineSummary] = useState<ReviewPipelineResponse | null>(null);
  const [criticSummary, setCriticSummary] = useState<string | null>(null);
  const [reviewPlan, setReviewPlan] = useState<any | null>(null);

  // 필터 상태 (4개 카테고리 탭 + 검토 상태 필터)
  const [categoryFilter, setCategoryFilter] = useState<CategoryTabFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'ACCEPTED' | 'REJECTED'>('ALL');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  // 원문 보기 모달 상태
  const [selectedFindingForSource, setSelectedFindingForSource] = useState<Finding | null>(null);

  // 알림 상태
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // DocumentBlock 추출 유틸리티
  const extractDocumentBlocks = (doc: HwpParseResult): DocumentBlock[] => {
    const blocks: DocumentBlock[] = [];
    if (doc.sections && doc.sections.length > 0) {
      doc.sections.forEach((sec, sIdx) => {
        if (sec.paragraphs) {
          sec.paragraphs.forEach((p, pIdx) => {
            if (p.text && p.text.trim()) {
              blocks.push({
                block_id: p.id || `para_${sIdx}_${pIdx}`,
                block_type: 'PARAGRAPH',
                native_locator: {
                  section_index: sIdx,
                  paragraph_index: pIdx,
                },
                text: p.text,
                style_name: p.style_name,
              });
            }
          });
        }
        if (sec.tables) {
          sec.tables.forEach((tbl, tIdx) => {
            const tableId = tbl.id || `tbl_${sIdx}_${tIdx}`;
            if (tbl.cells) {
              tbl.cells.forEach((c) => {
                if (c.text && c.text.trim()) {
                  blocks.push({
                    block_id: `${tableId}_c_${c.row}_${c.col}`,
                    block_type: 'TABLE_CELL',
                    native_locator: {
                      section_index: sIdx,
                      table_index: tIdx,
                      row: c.row,
                      col: c.col,
                    },
                    text: c.text,
                    style_name: '표내용',
                  });
                }
              });
            }
          });
        }
      });
    }

    if (blocks.length === 0 && doc.raw_text) {
      doc.raw_text.split('\n').forEach((line, idx) => {
        if (line.trim()) {
          blocks.push({
            block_id: `para_${idx + 1}`,
            block_type: 'PARAGRAPH',
            native_locator: {
              section_index: 0,
              paragraph_index: idx,
            },
            text: line.trim(),
          });
        }
      });
    }

    return blocks;
  };

  // 1. AI 종합 검토 파이프라인 전체 실행 (Rule -> Fairness -> General -> Merger)
  const executeFullReviewPipeline = async () => {
    setIsLoading(true);
    setPipelineStage('AI 검토 파이프라인(Rule Engine + Fairness + General + Merger) 가동 중...');
    try {
      const blocks = extractDocumentBlocks(document);
      const res = await fetch(`/api/v1/projects/${projectId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: document.document_id,
          blocks,
          raw_text: document.raw_text,
          authoritative_metadata: authoritativeMeta || undefined,
        }),
      });

      if (!res.ok) {
        let errMsg = `서버 응답 오류 (${res.status})`;
        try {
          const errJson = await res.json();
          if (errJson?.error) errMsg = errJson.error;
          else if (errJson?.message) errMsg = errJson.message;
        } catch {
          // ignore
        }
        throw new Error(errMsg);
      }

      const json = await res.json();
      if (json.success && json.data) {
        const pipelineData = json.data;
        setLastPipelineSummary(pipelineData);
        setFindings(pipelineData.findings || []);
        if (pipelineData.critic_summary) {
          setCriticSummary(pipelineData.critic_summary);
        }
        if (pipelineData.review_plan) {
          setReviewPlan(pipelineData.review_plan);
        }

        showNotice(
          `AI 구매검토관 v3 자율 검토 완료! (총 ${pipelineData.total_findings || pipelineData.findings?.length || 0}건 도출 및 수석 비평관 엄격 검증 완료)`,
          'success'
        );
      }
    } catch (err: any) {
      console.error('Full Review Pipeline Error:', err);
      showNotice(`AI 종합 검토 실행 중 오류: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
      setPipelineStage(null);
    }
  };

  // 2. 단독 규칙 엔진 실행
  const executeRuleEngineOnly = async () => {
    setIsLoading(true);
    setPipelineStage('기본 규칙 엔진(Rule Engine) 분석 중...');
    try {
      const blocks = extractDocumentBlocks(document);
      const res = await fetch(`/api/v1/projects/${projectId}/rules/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: document.document_id,
          blocks,
          raw_text: document.raw_text,
        }),
      });

      if (!res.ok) {
        let errMsg = `서버 응답 오류 (${res.status})`;
        try {
          const errJson = await res.json();
          if (errJson?.error) errMsg = errJson.error;
          else if (errJson?.message) errMsg = errJson.message;
        } catch {
          // ignore
        }
        throw new Error(errMsg);
      }

      const json = await res.json();
      if (json.success && json.data) {
        setFindings(json.data.findings || []);
        showNotice(
          `규칙 엔진 실행 완료: 대표 룰 검사 결과 총 ${json.data.total_findings || 0}건의 지적사항이 탐지되었습니다.`,
          'success'
        );
      }
    } catch (err: any) {
      console.error('Rule Engine Execution Error:', err);
      showNotice(`규칙 엔진 실행 중 오류: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
      setPipelineStage(null);
    }
  };

  // 기존 Finding 및 Authoritative Metadata 불러오기
  const fetchFindings = async () => {
    try {
      fetch(`/api/v1/projects/${projectId}/metadata/authoritative`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j && j.data) setAuthoritativeMeta(j.data);
        })
        .catch(() => {});

      const res = await fetch(`/api/v1/projects/${projectId}/findings`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data && json.data.length > 0) {
          setFindings(json.data);
          return;
        }
      }
      // 초기 로드 시 자동으로 AI 종합 검토 1회 실행
      await executeFullReviewPipeline();
    } catch (err) {
      console.warn('Could not fetch existing findings, running full pipeline instead:', err);
      await executeFullReviewPipeline();
    }
  };

  useEffect(() => {
    if (document) {
      fetchFindings();
    }
  }, [document.document_id, projectId]);

  // 결정 변경 API 호출 (PUT /api/v1/projects/{id}/findings/{finding_id}/decision)
  const handleDecisionChange = async (
    findingId: string,
    decision: DecisionStatus,
    reason?: string
  ) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/findings/${findingId}/decision`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason }),
      });

      if (!res.ok) {
        throw new Error(`결정 저장 실패 (${res.status})`);
      }

      const json = await res.json();
      if (json.success && json.data) {
        const updatedFinding: Finding = json.data;
        setFindings((prev) =>
          prev.map((f) => (f.finding_id === findingId ? updatedFinding : f))
        );

        const label = decision === 'ACCEPTED' ? '수용(반영)' : '불수용(원문 유지)';
        showNotice(`'${updatedFinding.title}' 항목이 [${label}] 처리되었습니다.`, 'success');
      }
    } catch (err: any) {
      console.error('Decision Update Error:', err);
      showNotice(`결정 반영 중 오류가 발생했습니다: ${err.message}`, 'error');
      throw err;
    }
  };

  const showNotice = (msg: string, type: 'success' | 'info' | 'error') => {
    setNotification({ message: msg, type });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === msg ? null : curr));
    }, 4500);
  };

  // 통계 연산
  const stats = useMemo(() => {
    const total = findings.length;
    const pending = findings.filter((f) => f.decision === 'PENDING').length;
    const accepted = findings.filter((f) => f.decision === 'ACCEPTED').length;
    const rejected = findings.filter((f) => f.decision === 'REJECTED').length;

    // 4개 카테고리별 카운트
    const fixCount = findings.filter((f) => f.category === 'RULE_FIX').length;
    const warnCount = findings.filter(
      (f) => f.category === 'RULE_WARN' || f.category === 'RULE_RECOMMEND' || f.category === 'RULE_INFO'
    ).length;
    const fairnessCount = findings.filter((f) => f.category === 'FAIRNESS').length;
    const aiReviewCount = findings.filter((f) => f.category === 'AI_REVIEW').length;

    const completed = accepted + rejected;
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      total,
      pending,
      accepted,
      rejected,
      fixCount,
      warnCount,
      fairnessCount,
      aiReviewCount,
      completed,
      progressPercent,
    };
  }, [findings]);

  // 필터링 로직 (4개 카테고리 + 상태 + 검색어)
  const filteredFindings = useMemo(() => {
    return findings.filter((finding) => {
      // 1. 카테고리 탭 매칭
      let matchCat = true;
      if (categoryFilter === 'RULE_FIX') {
        matchCat = finding.category === 'RULE_FIX';
      } else if (categoryFilter === 'RULE_WARN') {
        matchCat =
          finding.category === 'RULE_WARN' ||
          finding.category === 'RULE_RECOMMEND' ||
          finding.category === 'RULE_INFO';
      } else if (categoryFilter === 'FAIRNESS') {
        matchCat = finding.category === 'FAIRNESS';
      } else if (categoryFilter === 'AI_REVIEW') {
        matchCat = finding.category === 'AI_REVIEW';
      }

      // 2. 상태 필터 매칭
      const matchStatus = statusFilter === 'ALL' ? true : finding.decision === statusFilter;

      // 3. 키워드 검색
      let matchSearch = true;
      if (searchKeyword.trim()) {
        const q = searchKeyword.toLowerCase();
        matchSearch =
          finding.title.toLowerCase().includes(q) ||
          finding.original_text.toLowerCase().includes(q) ||
          finding.rule_name.toLowerCase().includes(q) ||
          finding.matched_keyword.toLowerCase().includes(q);
      }

      return matchCat && matchStatus && matchSearch;
    });
  }, [findings, categoryFilter, statusFilter, searchKeyword]);

  return (
    <div className="space-y-6" id="review-findings-dashboard">
      {/* 알림 토스트 */}
      {notification && (
        <div
          className={`p-3.5 rounded-xl text-xs sm:text-sm font-medium flex items-center justify-between shadow-xs transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
              : notification.type === 'error'
              ? 'bg-rose-50 text-rose-900 border border-rose-200'
              : 'bg-blue-50 text-blue-900 border border-blue-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : notification.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-blue-600 shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-slate-400 hover:text-slate-700 ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* 상단 파이프라인 제어 & 상태 헤더 카드 */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 flex items-center gap-1">
                <Cpu className="w-3 h-3 text-indigo-700" />
                <span>AI Multi-Agent Pipeline</span>
              </span>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-indigo-600" />
                <span>AI 종합 검토 및 Findings 대시보드</span>
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 mt-1.5">
              규칙 엔진(Rule Engine)과 공정성 에이전트(Fairness), 종합 품질 에이전트(General), Result Merger를 연동하여
              문서 내 법률 위반, 독소조항, 모순/누락 및 불공정 요구사항을 통합 검출합니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onNavigateToMetadata && (
              <button
                onClick={onNavigateToMetadata}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition cursor-pointer"
              >
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                <span>사업정보 확인</span>
              </button>
            )}

            {/* 단독 규칙 엔진 실행 버튼 */}
            <button
              id="btn-run-rule-engine-only"
              onClick={executeRuleEngineOnly}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-300 transition disabled:opacity-50 cursor-pointer"
              title="키워드/메타데이터 기반 규칙 엔진만 빠르게 실행"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>규칙 엔진만</span>
            </button>

            {/* AI 종합 검토 파이프라인 실행 버튼 */}
            <button
              id="btn-run-full-review-pipeline"
              onClick={executeFullReviewPipeline}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              <Sparkles className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? '파이프라인 실행 중...' : 'AI 종합 검토 파이프라인 가동'}</span>
            </button>
          </div>
        </div>

        {/* 파이프라인 진행 상태 알림 */}
        {isLoading && pipelineStage && (
          <div className="mt-4 p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-xs text-indigo-900 flex items-center gap-2.5 animate-pulse">
            <Cpu className="w-4 h-4 text-indigo-600 shrink-0 animate-spin" />
            <span className="font-semibold">{pipelineStage}</span>
          </div>
        )}

        {/* 확정된 Authoritative Metadata 스트립 */}
        {authoritativeMeta && (
          <div className="mt-3 p-3 rounded-lg bg-blue-50/70 border border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-700 shrink-0" />
              <span className="font-semibold text-blue-900">
                확정 기준: {authoritativeMeta.client_name} ({CLIENT_TYPE_LABELS[authoritativeMeta.client_type]?.label || authoritativeMeta.client_type})
              </span>
              <span className="text-slate-300">|</span>
              <span className="font-semibold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded text-[11px] border border-emerald-200">
                적용 법령: {GOVERNING_LAW_LABELS[authoritativeMeta.governing_law]?.short || authoritativeMeta.governing_law}
              </span>
              <span className="text-slate-500 text-[11px]">(버전 v{authoritativeMeta.version})</span>
            </div>

            {onNavigateToMetadata && (
              <button
                onClick={onNavigateToMetadata}
                className="text-[11px] text-blue-700 hover:text-blue-900 font-bold underline cursor-pointer"
              >
                법령/수요기관 변경 →
              </button>
            )}
          </div>
        )}

        {/* AI 구매검토관 v3: 맞춤형 Review Plan & 수석 비평관(Final Critic) 요약 배너 */}
        {(criticSummary || reviewPlan) && (
          <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-indigo-50/90 to-purple-50/70 border border-indigo-200 text-xs space-y-3 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-indigo-950 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>AI 구매검토관 v3 심층 자율 검토 결과 보고</span>
                {reviewPlan && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                    {reviewPlan.project_type_classification || '맞춤형 계획 가동'}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-indigo-700 font-mono">
                Document Navigator 자율 탐색 + 8대 전문영역 + 수석 비평관 필터링 완료
              </span>
            </div>

            {/* Final Critic Summary */}
            {criticSummary && (
              <div className="p-3 rounded-lg bg-white/90 border border-indigo-100 space-y-1">
                <div className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-indigo-600" />
                  <span>수석 비평관(Final Critic) 종합 평가 및 필터링 의견:</span>
                </div>
                <p className="text-slate-700 text-[11px] leading-relaxed whitespace-pre-wrap pl-5">
                  {criticSummary}
                </p>
              </div>
            )}

            {/* Review Plan Focus Areas Summary */}
            {reviewPlan?.focus_areas && reviewPlan.focus_areas.length > 0 && (
              <div className="pt-1">
                <div className="text-[11px] font-semibold text-slate-700 mb-1.5">
                  자율 탐색 및 정밀 점검이 수행된 주요 과업 영역:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {reviewPlan.focus_areas.map((fa: any, idx: number) => (
                    <span
                      key={idx}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium border ${
                        fa.priority === 'HIGH'
                          ? 'bg-rose-50 text-rose-800 border-rose-200 font-bold'
                          : 'bg-white text-slate-700 border-slate-200'
                      }`}
                      title={fa.rationale}
                    >
                      <span>{fa.area_name}</span>
                      <span className="text-[9px] opacity-75">({fa.priority})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 파이프라인 아키텍처 다이어그램 & 실행 요약 */}
        {lastPipelineSummary && (
          <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-200">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <GitMerge className="w-4 h-4 text-indigo-600" />
                <span>AI 파이프라인 단계별 처리 현황</span>
              </span>
              <span className="text-slate-500 text-[11px]">
                실행 시각: {lastPipelineSummary.executed_at ? new Date(lastPipelineSummary.executed_at).toLocaleTimeString() : '방금 전'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                <span className="text-slate-500 block text-[11px]">1. Rule Engine</span>
                <span className="text-sm font-bold text-slate-800">
                  {lastPipelineSummary.stage_counts?.rule_findings ?? 0}건 검출
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-lg border border-purple-200">
                <span className="text-purple-700 block text-[11px]">2. Fairness Agent</span>
                <span className="text-sm font-bold text-purple-900">
                  {lastPipelineSummary.stage_counts?.fairness_findings ?? 0}건 검출
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-lg border border-cyan-200">
                <span className="text-cyan-700 block text-[11px]">3. Specialist Review</span>
                <span className="text-sm font-bold text-cyan-900">
                  {lastPipelineSummary.stage_counts?.general_findings ?? (lastPipelineSummary.findings?.length ?? 0)}건 검출
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-lg border border-indigo-200">
                <span className="text-indigo-700 block text-[11px]">4. Result Merger</span>
                <span className="text-sm font-bold text-indigo-900">
                  {lastPipelineSummary.merged_count ? `중복 ${lastPipelineSummary.merged_count}건 병합 ` : ''}(최종 {lastPipelineSummary.total_findings ?? lastPipelineSummary.findings?.length ?? 0}건)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 요약 통계 카드 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mt-4 pt-4 border-t border-slate-100">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-600" /> 총 지적 건수
            </span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-bold text-slate-900">{stats.total}</span>
              <span className="text-[11px] text-indigo-600 font-semibold bg-indigo-50 px-1.5 py-0.5 rounded">
                공정성 {stats.fairnessCount} / AI {stats.aiReviewCount}
              </span>
            </div>
          </div>

          <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3">
            <span className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-600" /> 검토 대기 (PENDING)
            </span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-bold text-amber-900">{stats.pending}</span>
              <span className="text-[11px] text-amber-700">미결정 항목</span>
            </div>
          </div>

          <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-3">
            <span className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> 수용 완료 (ACCEPTED)
            </span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-bold text-emerald-900">{stats.accepted}</span>
              <span className="text-[11px] text-emerald-700">권고안 반영</span>
            </div>
          </div>

          <div className="bg-slate-100 border border-slate-300 rounded-lg p-3">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5 text-slate-500" /> 불수용 (REJECTED)
            </span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-bold text-slate-800">{stats.rejected}</span>
              <span className="text-[11px] text-slate-500">원문 유지</span>
            </div>
          </div>
        </div>

        {/* 검토 완료율 프로그레스 바 */}
        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <FileCheck className="w-4 h-4 text-indigo-600" />
            <span>검토 의사결정 진행률:</span>
            <span className="font-bold text-slate-900">
              {stats.completed}/{stats.total} 완료 ({stats.progressPercent}%)
            </span>
          </div>
          <div className="w-48 sm:w-64 bg-slate-200 h-2 rounded-full overflow-hidden">
            <div
              className="bg-indigo-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${stats.progressPercent}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* 4개 카테고리 필터 탭 바 (User Requirement: [즉시 수정], [확인 필요], [공정성 검토], [AI 추가검토]) */}
      <div className="space-y-3">
        <div
          id="review-category-tabs"
          className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-100 rounded-xl border border-slate-200"
        >
          {/* 전체 */}
          <button
            id="tab-cat-all"
            onClick={() => setCategoryFilter('ALL')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              categoryFilter === 'ALL'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <span>전체</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] ${
                categoryFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {findings.length}
            </span>
          </button>

          {/* 1. 즉시 수정 (RULE_FIX) */}
          <button
            id="tab-cat-fix"
            onClick={() => setCategoryFilter('RULE_FIX')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              categoryFilter === 'RULE_FIX'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-rose-700 hover:bg-rose-50'
            }`}
          >
            <span>🔴 즉시 수정</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] ${
                categoryFilter === 'RULE_FIX' ? 'bg-white text-rose-700 font-extrabold' : 'bg-rose-100 text-rose-800'
              }`}
            >
              {stats.fixCount}
            </span>
          </button>

          {/* 2. 확인 필요 (RULE_WARN) */}
          <button
            id="tab-cat-warn"
            onClick={() => setCategoryFilter('RULE_WARN')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              categoryFilter === 'RULE_WARN'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-amber-800 hover:bg-amber-50'
            }`}
          >
            <span>🟡 확인 필요</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] ${
                categoryFilter === 'RULE_WARN' ? 'bg-white text-amber-800 font-extrabold' : 'bg-amber-100 text-amber-900'
              }`}
            >
              {stats.warnCount}
            </span>
          </button>

          {/* 3. 공정성 검토 (FAIRNESS) */}
          <button
            id="tab-cat-fairness"
            onClick={() => setCategoryFilter('FAIRNESS')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              categoryFilter === 'FAIRNESS'
                ? 'bg-purple-700 text-white shadow-xs'
                : 'text-purple-800 hover:bg-purple-50'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>🟣 공정성 검토</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] ${
                categoryFilter === 'FAIRNESS' ? 'bg-white text-purple-800 font-extrabold' : 'bg-purple-100 text-purple-900'
              }`}
            >
              {stats.fairnessCount}
            </span>
          </button>

          {/* 4. AI 추가검토 (AI_REVIEW) */}
          <button
            id="tab-cat-ai-review"
            onClick={() => setCategoryFilter('AI_REVIEW')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              categoryFilter === 'AI_REVIEW'
                ? 'bg-cyan-700 text-white shadow-xs'
                : 'text-cyan-800 hover:bg-cyan-50'
            }`}
          >
            <FileSearch className="w-3.5 h-3.5" />
            <span>🟢 AI 추가검토</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] ${
                categoryFilter === 'AI_REVIEW' ? 'bg-white text-cyan-800 font-extrabold' : 'bg-cyan-100 text-cyan-900'
              }`}
            >
              {stats.aiReviewCount}
            </span>
          </button>
        </div>

        {/* 보조 필터 바 (결정 상태 및 검색어) */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
          {/* 상태 필터 버튼들 */}
          <div className="flex items-center gap-1 overflow-x-auto text-xs">
            <span className="font-semibold text-slate-500 mr-1 flex items-center gap-1">
              <Filter className="w-3 h-3" /> 결정 상태:
            </span>
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                statusFilter === 'ALL' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              전체
            </button>
            <button
              onClick={() => setStatusFilter('PENDING')}
              className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                statusFilter === 'PENDING'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              대기중 ({stats.pending})
            </button>
            <button
              onClick={() => setStatusFilter('ACCEPTED')}
              className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                statusFilter === 'ACCEPTED'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
              }`}
            >
              수용 ({stats.accepted})
            </button>
            <button
              onClick={() => setStatusFilter('REJECTED')}
              className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                statusFilter === 'REJECTED'
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              불수용 ({stats.rejected})
            </button>
          </div>

          {/* 검색 입력란 */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="제목, 원문, 키워드 검색..."
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              className="pl-8 pr-3 py-1 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-48 sm:w-60 bg-slate-50"
            />
            {searchKeyword && (
              <button
                onClick={() => setSearchKeyword('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 탐지된 지적사항 카드 목록 */}
      <div className="space-y-4">
        {filteredFindings.length > 0 ? (
          filteredFindings.map((finding) => (
            <FindingCard
              key={finding.finding_id}
              finding={finding}
              projectId={projectId}
              onDecisionChange={handleDecisionChange}
              onNavigateToBlock={onNavigateToBlock}
              onViewSource={(targetFinding) => setSelectedFindingForSource(targetFinding)}
            />
          ))
        ) : (
          <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300 p-8">
            <CheckCheck className="w-12 h-12 text-indigo-500 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800">
              {findings.length === 0
                ? '현재 탐지된 지적사항이 없습니다.'
                : '선택한 카테고리/필터 조건에 일치하는 지적사항이 없습니다.'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-md mx-auto">
              {findings.length === 0
                ? '아래 [AI 종합 검토 파이프라인 가동] 버튼을 눌러 규칙 엔진과 AI 에이전트 분석을 시작하세요.'
                : '상단 탭에서 [전체] 또는 다른 카테고리를 선택해 보세요.'}
            </p>
            {findings.length === 0 && (
              <button
                onClick={executeFullReviewPipeline}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI 종합 검토 파이프라인 즉시 실행</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* HWP 원문 상세 보기 모달 */}
      <SourceViewerModal
        finding={selectedFindingForSource}
        onClose={() => setSelectedFindingForSource(null)}
        onNavigateToDocumentViewer={onNavigateToBlock}
      />
    </div>
  );
};
