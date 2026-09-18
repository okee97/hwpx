import React, { useState } from 'react';
import {
  FileText,
  Table as TableIcon,
  AlignLeft,
  FileCode,
  Info,
  Copy,
  Check,
  Calendar,
  User,
  Hash,
  Layers,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { HwpParseResult, HwpTable, HwpParagraph } from '../types';

interface ParsedDocumentViewerProps {
  result: HwpParseResult;
  initialTab?: TabType;
}

type TabType = 'overview' | 'paragraphs' | 'tables' | 'raw_text' | 'ir_json';

export const ParsedDocumentViewer: React.FC<ParsedDocumentViewerProps> = ({ result, initialTab = 'paragraphs' }) => {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [copied, setCopied] = useState(false);

  const meta = result.metadata;
  const sections = result.sections || [];
  const allParagraphs: HwpParagraph[] = sections.flatMap((s) => s.paragraphs || []);
  const allTables: HwpTable[] = sections.flatMap((s) => s.tables || []);

  const handleCopyRawText = () => {
    navigator.clipboard.writeText(result.raw_text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyIrJson = () => {
    navigator.clipboard.writeText(JSON.stringify(result.ir_json, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
      {/* Header Summary Bar */}
      <div className="bg-slate-900 text-white p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 uppercase font-mono">
                {result.format}
              </span>
              <h2 className="text-base sm:text-lg font-bold truncate max-w-xl">
                {meta.title || result.file_name}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300 mt-2 font-mono">
              <span>파일: {result.file_name}</span>
              <span>크기: {(result.file_size / 1024).toFixed(1)} KB</span>
              <span>버전: HWP {meta.hwp_version}</span>
              <span>
                압축:{' '}
                <span className={meta.is_compressed ? 'text-emerald-400' : 'text-slate-400'}>
                  {meta.is_compressed ? '적용(zlib)' : '미적용'}
                </span>
              </span>
            </div>
          </div>

          {result.cli_execution_info && (
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-lg p-2.5 text-right font-mono text-xs">
              <div className="text-slate-400 text-[11px]">rhwp CLI 처리 시간</div>
              <div className="text-emerald-400 font-bold text-sm">
                {result.cli_execution_info.duration_ms} ms
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                종료 코드: {result.cli_execution_info.exit_code} (정상)
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-slate-200 bg-slate-50/70 px-4">
        <div className="flex space-x-1 sm:space-x-2 overflow-x-auto py-2">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span>문서 개요 및 메타데이터</span>
          </button>

          <button
            onClick={() => setActiveTab('paragraphs')}
            className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition whitespace-nowrap ${
              activeTab === 'paragraphs'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <AlignLeft className="w-3.5 h-3.5" />
            <span>문단 구조 ({allParagraphs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('tables')}
            className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition whitespace-nowrap ${
              activeTab === 'tables'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>표 데이터 ({allTables.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('raw_text')}
            className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition whitespace-nowrap ${
              activeTab === 'raw_text'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>전문 텍스트 ({meta.character_count.toLocaleString()}자)</span>
          </button>

          <button
            onClick={() => setActiveTab('ir_json')}
            className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition whitespace-nowrap ${
              activeTab === 'ir_json'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <FileCode className="w-3.5 h-3.5 text-indigo-600" />
            <span>rhwp IR JSON</span>
          </button>
        </div>
      </div>

      {/* Tab Contents */}
      <div className="p-5">
        {/* Tab 1: Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Metric Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] text-slate-500 font-medium">예상 페이지</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{meta.page_count} 쪽</div>
                <div className="text-[10px] text-slate-400 mt-0.5">글자 수 환산 기준</div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] text-slate-500 font-medium">문단 수</div>
                <div className="text-xl font-bold text-blue-600 mt-1">
                  {meta.paragraph_count} 개
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">본문 및 서식 포함</div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] text-slate-500 font-medium">표 개수</div>
                <div className="text-xl font-bold text-indigo-600 mt-1">
                  {meta.table_count} 개
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">행정 서식 표</div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] text-slate-500 font-medium">총 글자 수 (공백포함)</div>
                <div className="text-xl font-bold text-emerald-600 mt-1">
                  {meta.character_count.toLocaleString()} 자
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">{meta.word_count} 단어</div>
              </div>
            </div>

            {/* Detailed Properties Table */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-100/70 px-4 py-2.5 border-b border-slate-200 text-xs font-bold text-slate-800">
                HWP 파일헤더 및 문서 속성 (03_DATA_SCHEMA.md 규격)
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                <div className="grid grid-cols-3 p-3 hover:bg-slate-50/60">
                  <span className="font-medium text-slate-500 flex items-center">
                    <FileText className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                    문서 제목 (Title)
                  </span>
                  <span className="col-span-2 text-slate-900 font-semibold">{meta.title}</span>
                </div>

                <div className="grid grid-cols-3 p-3 hover:bg-slate-50/60">
                  <span className="font-medium text-slate-500 flex items-center">
                    <User className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                    작성자 (Author)
                  </span>
                  <span className="col-span-2 text-slate-900">{meta.author || '미지정'}</span>
                </div>

                <div className="grid grid-cols-3 p-3 hover:bg-slate-50/60">
                  <span className="font-medium text-slate-500 flex items-center">
                    <Calendar className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                    작성 / 수정 일시
                  </span>
                  <span className="col-span-2 text-slate-900 font-mono">
                    {meta.created_date || '2026-09-17 09:15:00'}
                  </span>
                </div>

                <div className="grid grid-cols-3 p-3 hover:bg-slate-50/60">
                  <span className="font-medium text-slate-500 flex items-center">
                    <Hash className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                    한글 엔진 버전 (HWP Version)
                  </span>
                  <span className="col-span-2 text-slate-900 font-mono">
                    HWP {meta.hwp_version} (CFBF 바이너리)
                  </span>
                </div>

                <div className="grid grid-cols-3 p-3 hover:bg-slate-50/60">
                  <span className="font-medium text-slate-500 flex items-center">
                    <Layers className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                    스트림 압축 여부 (zlib)
                  </span>
                  <span className="col-span-2">
                    {meta.is_compressed ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        압축 활성화 (Deflate Stream)
                      </span>
                    ) : (
                      <span className="text-slate-500">일반 비압축 스트림</span>
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-3 p-3 hover:bg-slate-50/60">
                  <span className="font-medium text-slate-500 flex items-center">
                    <Clock className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                    파싱 완료 시각
                  </span>
                  <span className="col-span-2 text-slate-700 font-mono">
                    {new Date(result.parsed_at).toLocaleString('ko-KR')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Paragraphs */}
        {activeTab === 'paragraphs' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500 pb-2 border-b border-slate-100">
              <span>rhwp CLI가 추출한 계층형 문단 목록 (총 {allParagraphs.length}개)</span>
              <span>정렬, 스타일(제목, 개요, 본문), 글꼴 및 크기(pt) 포함</span>
            </div>

            <div className="space-y-2">
              {allParagraphs.map((para) => {
                const run = para.text_runs?.[0];
                return (
                  <div
                    key={para.id}
                    id={`doc-block-${para.id}`}
                    className="p-3 rounded-lg border border-slate-200 hover:border-blue-300 bg-slate-50/30 hover:bg-blue-50/20 transition"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center space-x-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-200 text-slate-700">
                          {para.id}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            para.style_name === '제목'
                              ? 'bg-purple-100 text-purple-800'
                              : para.style_name.includes('개요')
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {para.style_name}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          정렬: {para.align}
                        </span>
                      </div>

                      {run && (
                        <div className="text-[11px] text-slate-400 font-mono">
                          {run.font_family} {run.font_size}pt
                          {run.is_bold && <strong className="ml-1 text-slate-600">Bold</strong>}
                        </div>
                      )}
                    </div>

                    <p
                      className={`text-slate-800 text-sm leading-relaxed ${
                        para.align === 'CENTER'
                          ? 'text-center'
                          : para.align === 'RIGHT'
                          ? 'text-right'
                          : 'text-left'
                      } ${run?.is_bold ? 'font-bold' : 'font-normal'}`}
                    >
                      {para.text}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 3: Tables */}
        {activeTab === 'tables' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between text-xs text-slate-500 pb-2 border-b border-slate-100">
              <span>HWP 본문 내 행정 서식 표 렌더링 (총 {allTables.length}개)</span>
              <span>Cell row_span, col_span, Header 감지 구조 반영</span>
            </div>

            {allTables.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">
                문서 내에 감지된 표가 없습니다.
              </div>
            ) : (
              allTables.map((table) => {
                // Group cells by row for grid display
                const rows: { [key: number]: typeof table.cells } = {};
                table.cells.forEach((cell) => {
                  if (!rows[cell.row]) rows[cell.row] = [];
                  rows[cell.row].push(cell);
                });

                return (
                  <div key={table.id} className="border border-slate-300 rounded-lg overflow-hidden">
                    <div className="bg-slate-100 px-4 py-2 border-b border-slate-300 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <TableIcon className="w-4 h-4 text-blue-600" />
                        <span className="text-xs font-bold text-slate-800 font-mono">
                          {table.id}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500 font-mono">
                        {table.row_count}행 × {table.col_count}열 ({table.cells.length}개 셀)
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <tbody>
                          {Object.keys(rows)
                            .map(Number)
                            .sort((a, b) => a - b)
                            .map((rowIdx) => (
                              <tr key={rowIdx} className="border-b border-slate-200 last:border-b-0">
                                {rows[rowIdx]
                                  .sort((a, b) => a.col - b.col)
                                  .map((cell, cIdx) => (
                                    <td
                                      key={cIdx}
                                      rowSpan={cell.row_span}
                                      colSpan={cell.col_span}
                                      className={`p-3 border-r border-slate-200 last:border-r-0 leading-relaxed ${
                                        cell.is_header
                                          ? 'bg-slate-50 font-bold text-slate-800 text-center w-28 sm:w-36'
                                          : 'text-slate-700 bg-white'
                                      }`}
                                    >
                                      {cell.text}
                                    </td>
                                  ))}
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Tab 4: Raw Text */}
        {activeTab === 'raw_text' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs text-slate-500">
                rhwp text 스트림에서 추출된 평문 전문 (UTF-16LE / PrvText 디코딩)
              </span>
              <button
                onClick={handleCopyRawText}
                className="flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>복사 완료</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>텍스트 복사</span>
                  </>
                )}
              </button>
            </div>

            <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap max-h-[500px] overflow-y-auto">
              {result.raw_text}
            </div>
          </div>
        )}

        {/* Tab 5: IR JSON */}
        {activeTab === 'ir_json' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs text-slate-500">
                rhwp Intermediate Representation (IR) 규격 JSON 데이터 (03_DATA_SCHEMA.md)
              </span>
              <button
                onClick={handleCopyIrJson}
                className="flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>복사 완료</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>JSON 복사</span>
                  </>
                )}
              </button>
            </div>

            <pre className="bg-slate-950 text-emerald-400 rounded-lg p-4 font-mono text-xs leading-relaxed max-h-[500px] overflow-y-auto overflow-x-auto border border-slate-800">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
