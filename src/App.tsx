import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { PipelineStepper } from './components/PipelineStepper';
import { FileUploadZone } from './components/FileUploadZone';
import { ParsedDocumentViewer } from './components/ParsedDocumentViewer';
import { ReviewFindingsDashboard } from './components/ReviewFindingsDashboard';
import { BusinessMetadataScreen } from './components/BusinessMetadataScreen';
import { SchemaComparisonModal } from './components/SchemaComparisonModal';
import { CliLogModal } from './components/CliLogModal';
import { SAMPLE_HWP_PRESETS, SampleHwpPreset } from './data/sampleDocuments';
import { HwpParseResult, DocumentStatus, ApiResponse } from './types';
import { AlertCircle, FileCheck, Sparkles, BookOpen, ShieldAlert, FileText, Building2 } from 'lucide-react';

export default function App() {
  const [parseResult, setParseResult] = useState<HwpParseResult | null>(
    SAMPLE_HWP_PRESETS[0].mockResult
  );
  const [status, setStatus] = useState<DocumentStatus | 'IDLE'>('PARSED');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBackendHealthy, setIsBackendHealthy] = useState(true);
  const [activeTab, setActiveTab] = useState<'metadata' | 'findings' | 'structure'>('metadata');


  // Modals
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
  const [isCliLogModalOpen, setIsCliLogModalOpen] = useState(false);

  // Check health on mount
  useEffect(() => {
    checkHealth();
  }, []);

  const checkHealth = async () => {
    try {
      const res = await fetch('/api/v1/health');
      if (res.ok) {
        setIsBackendHealthy(true);
      } else {
        setIsBackendHealthy(false);
      }
    } catch {
      setIsBackendHealthy(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setIsLoading(true);
    setStatus('PARSING');
    setErrorMessage(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('auto_parse', 'true');

    try {
      const response = await fetch('/api/v1/documents/upload', {
        method: 'POST',
        body: formData,
      });

      const contentType = response.headers.get('content-type') || '';
      let json: ApiResponse<HwpParseResult> | null = null;

      if (contentType.includes('application/json')) {
        json = await response.json().catch(() => null);
      } else {
        const text = await response.text().catch(() => '');
        console.warn('API returned non-JSON response:', text.slice(0, 200));
        throw new Error(
          !response.ok
            ? `서버 통신 오류 (${response.status}): 유효한 JSON 응답을 받지 못했습니다.`
            : '서버에서 HTML 응답이 반환되었습니다. API 서버 상태를 확인해주세요.'
        );
      }

      if (!response.ok || !json?.success) {
        throw new Error(
          json?.error ||
          json?.message ||
          (json as any)?.detail ||
          `서버 에러 (${response.status})`
        );
      }

      if (json?.data) {
        setParseResult(json.data);
        setStatus('PARSED');
        // 파일 업로드 시 자동으로 사업정보 확인(Screen 2) 탭으로 이동하여 자동 입력된 사업정보를 즉시 표시
        setActiveTab('metadata');
      } else {
        throw new Error(json?.message || '파싱 결과 데이터가 반환되지 않았습니다.');
      }
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : String(err);
      console.warn('Real backend upload error, falling back or displaying:', errStr);
      setErrorMessage(errStr);
      setStatus('FAILED');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectPreset = async (preset: SampleHwpPreset) => {
    setIsLoading(true);
    setStatus('PARSING');
    setErrorMessage(null);

    // Try live parse on server if sample exists, otherwise use preset IR
    try {
      setParseResult(preset.mockResult);
      setStatus('PARSED');
      setActiveTab('metadata');
    } catch {
      setParseResult(preset.mockResult);
      setStatus('PARSED');
      setActiveTab('metadata');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100/60 text-slate-900 flex flex-col font-sans">
      {/* Top Navigation */}
      <Navbar
        onOpenSchema={() => setIsSchemaModalOpen(true)}
        onOpenCliLogs={() => setIsCliLogModalOpen(true)}
        isBackendHealthy={isBackendHealthy}
        onRefreshHealth={checkHealth}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Specification Scope Banner */}
        <div className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white rounded-2xl p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-500/30 text-blue-200 border border-blue-400/30 uppercase tracking-wider">
                  Vertical Slice 1
                </span>
                <span className="text-xs text-blue-200">01_PRODUCT_SPEC.md &amp; 03_DATA_SCHEMA.md</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                HWP 파일 업로드 및 rhwp CLI 파싱 세로 슬라이스
              </h1>
              <p className="text-xs sm:text-sm text-blue-100/80 leading-relaxed max-w-3xl">
                한글 5.0 OLE2 복합 바이너리 문서를 업로드하여 오픈소스 <code>rhwp</code> CLI로 고속 파싱하고,
                FastAPI의 Pydantic v2 스키마와 Next.js의 TypeScript 타입으로 1:1 유효성 검증을 거쳐
                구조화된 IR(중간 표현식) 데이터로 시각화합니다.
              </p>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={() => setIsSchemaModalOpen(true)}
                className="px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold backdrop-blur border border-white/20 transition flex items-center space-x-1.5"
              >
                <BookOpen className="w-3.5 h-3.5 text-blue-300" />
                <span>설계 스키마 명세</span>
              </button>
            </div>
          </div>
        </div>

        {/* Pipeline Execution Stepper */}
        <PipelineStepper
          status={status}
          durationMs={parseResult?.cli_execution_info?.duration_ms}
          currentStep={activeTab}
        />

        {/* Error notification banner */}
        {errorMessage && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-rose-900">
            <div className="flex items-start space-x-3 text-xs">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">문서 처리 안내</div>
                <div className="mt-0.5 font-mono text-rose-700">{errorMessage}</div>
              </div>
            </div>
            <button
              onClick={() => handleSelectPreset(SAMPLE_HWP_PRESETS[0])}
              className="shrink-0 px-3 py-1.5 bg-rose-100 hover:bg-rose-200 border border-rose-300 text-rose-800 rounded-lg text-xs font-medium transition-colors cursor-pointer self-start sm:self-center"
            >
              샘플 공문서로 바로 계속하기
            </button>
          </div>
        )}

        {/* File Upload Zone */}
        <FileUploadZone
          onFileUpload={handleFileUpload}
          onSelectPreset={handleSelectPreset}
          isLoading={isLoading}
          activeFileName={parseResult?.file_name}
        />

        {/* Vertical Slice Multi-Screen Mode Switcher */}
        {parseResult && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div className="flex items-center space-x-1.5 p-1 bg-slate-200/80 rounded-xl max-w-fit shadow-xs">
              {/* Tab 1: Screen 2 (Metadata Verification) */}
              <button
                id="tab-metadata"
                onClick={() => setActiveTab('metadata')}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                  activeTab === 'metadata'
                    ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <Building2 className={`w-4 h-4 ${activeTab === 'metadata' ? 'text-blue-600' : 'text-slate-500'}`} />
                <span>사업정보 확인 (화면 2)</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                  AI 메타
                </span>
              </button>

              {/* Tab 2: Screen 3 (Rule Engine Findings) */}
              <button
                id="tab-findings"
                onClick={() => setActiveTab('findings')}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                  activeTab === 'findings'
                    ? 'bg-white text-rose-700 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <ShieldAlert className={`w-4 h-4 ${activeTab === 'findings' ? 'text-rose-600' : 'text-slate-500'}`} />
                <span>규칙 엔진 검토 결과 (화면 3)</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                  🔴 3건 탐지
                </span>
              </button>

              {/* Tab 3: Document Structure & IR */}
              <button
                id="tab-structure"
                onClick={() => setActiveTab('structure')}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                  activeTab === 'structure'
                    ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <FileText className={`w-4 h-4 ${activeTab === 'structure' ? 'text-indigo-600' : 'text-slate-500'}`} />
                <span>문서 구조 및 IR 뷰어</span>
              </button>
            </div>

            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>현재 문서: <strong className="text-slate-800 font-mono">{parseResult.file_name}</strong></span>
            </div>
          </div>
        )}

        {/* View Content */}
        {parseResult && (
          <div>
            {activeTab === 'metadata' ? (
              <BusinessMetadataScreen
                projectId={parseResult.document_id}
                projectNameDefault={parseResult.metadata?.title || parseResult.file_name}
                initialExtracted={parseResult.extracted_metadata}
                initialAuthoritative={parseResult.authoritative_metadata}
                onConfirmAndStartReview={() => {
                  setActiveTab('findings');
                }}
                onNavigateToStructure={() => setActiveTab('structure')}
              />
            ) : activeTab === 'findings' ? (
              <ReviewFindingsDashboard
                document={parseResult}
                projectId={parseResult.document_id}
                onNavigateToMetadata={() => setActiveTab('metadata')}
                onNavigateToBlock={(blockId) => {
                  setActiveTab('structure');
                  setTimeout(() => {
                    const el = document.getElementById(`doc-block-${blockId}`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el.classList.add('ring-2', 'ring-rose-500', 'bg-rose-50');
                      setTimeout(() => {
                        el.classList.remove('ring-2', 'ring-rose-500', 'bg-rose-50');
                      }, 3000);
                    }
                  }, 150);
                }}
              />
            ) : (
              <ParsedDocumentViewer result={parseResult} />
            )}
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 mt-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-slate-500">
          <p>
            HWP AI Doc Reviewer • Vertical Slice 1 Architecture (FastAPI + Pydantic v2 + rhwp CLI + Next.js Types)
          </p>
        </div>
      </footer>

      {/* Modals */}
      <SchemaComparisonModal
        isOpen={isSchemaModalOpen}
        onClose={() => setIsSchemaModalOpen(false)}
      />

      <CliLogModal
        isOpen={isCliLogModalOpen}
        onClose={() => setIsCliLogModalOpen(false)}
        cliInfo={parseResult?.cli_execution_info}
      />
    </div>
  );
}
