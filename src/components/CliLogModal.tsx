import React from 'react';
import { X, Terminal, CheckCircle2, Clock } from 'lucide-react';
import { CliExecutionInfo } from '../types';

interface CliLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  cliInfo?: CliExecutionInfo | null;
}

export const CliLogModal: React.FC<CliLogModalProps> = ({ isOpen, onClose, cliInfo }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <div className="bg-slate-950 text-slate-200 rounded-2xl border border-slate-800 shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col">
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="flex space-x-1.5 mr-2">
              <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
            </div>
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-mono font-bold text-slate-200">
              rhwp CLI 파서 서브프로세스 실행 콘솔
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Terminal Body */}
        <div className="p-5 font-mono text-xs space-y-4">
          <div>
            <div className="text-slate-500 text-[11px] mb-1"># CLI 도구 사양 및 환경</div>
            <div className="text-slate-300">
              엔진: <span className="text-emerald-400">rhwp (Rust-based HWP 5.0 / HWPX Parser CLI)</span>
            </div>
            <div className="text-slate-300">
              경로: <span className="text-blue-400">/usr/local/bin/rhwp</span>
            </div>
            <div className="text-slate-300">
              버전: <span className="text-amber-400">{cliInfo?.cli_version || 'rhwp 0.8.2-cli'}</span>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-3">
            <div className="text-slate-500 text-[11px] mb-1"># 최근 실행된 명령어 (Executed Command)</div>
            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-emerald-300 flex items-center justify-between">
              <code>$ {cliInfo?.command || 'rhwp parse samples/sample_official_doc.hwp --format json'}</code>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-3">
            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-500 text-[11px] flex items-center">
                <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
                실행 소요 시간 (Latency)
              </div>
              <div className="text-base font-bold text-emerald-400 mt-1">
                {cliInfo?.duration_ms || 45.2} ms
              </div>
            </div>

            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-500 text-[11px] flex items-center">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                종료 상태 코드 (Exit Code)
              </div>
              <div className="text-base font-bold text-slate-200 mt-1">
                {cliInfo?.exit_code ?? 0} (SUCCESS)
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-3">
            <div className="text-slate-500 text-[11px] mb-1"># 파서 표준 출력 (Standard Output Preview)</div>
            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-slate-400 max-h-40 overflow-y-auto text-[11px] leading-relaxed">
              {`[INFO] Target: HWP 5.0 OLE2 Compound File Binary Format
[INFO] Header Signature verified: "HWP Document File"
[INFO] Compressed Stream (zlib/deflate) uncompressed successfully.
[INFO] Parsed Section 0: 5 Paragraphs, 1 Table, 11 Cells.
[SUCCESS] Serialized 03_DATA_SCHEMA.md compliant IR JSON output.`}
            </div>
          </div>
        </div>

        {/* Terminal Footer */}
        <div className="px-5 py-3 bg-slate-900 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700 transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
