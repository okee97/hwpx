import React from 'react';
import { FileText, Terminal, Code2, CheckCircle2, RefreshCw } from 'lucide-react';

interface NavbarProps {
  onOpenSchema: () => void;
  onOpenCliLogs: () => void;
  isBackendHealthy: boolean;
  onRefreshHealth: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenSchema,
  onOpenCliLogs,
  isBackendHealthy,
  onRefreshHealth,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Left: Brand Identity */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-slate-900 text-lg tracking-tight">HWP Doc Reviewer</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                v1.1 Spec
              </span>
            </div>
            <p className="text-xs text-slate-500 hidden sm:block">
              FastAPI Pydantic &amp; rhwp CLI 파싱 세로 슬라이스 1
            </p>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Health status badge */}
          <button
            onClick={onRefreshHealth}
            title="FastAPI 백엔드 및 rhwp CLI 헬스체크 갱신"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isBackendHealthy ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            <span className="hidden md:inline">rhwp 엔진</span>
            <span className="font-mono text-slate-500">
              {isBackendHealthy ? '연결됨' : '대기중'}
            </span>
            <RefreshCw className="w-3 h-3 text-slate-400" />
          </button>

          {/* Schema compare button */}
          <button
            onClick={onOpenSchema}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 transition"
          >
            <Code2 className="w-3.5 h-3.5 text-blue-600" />
            <span>Pydantic / TS 스키마</span>
          </button>

          {/* CLI Logs button */}
          <button
            onClick={onOpenCliLogs}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-100 transition shadow-xs"
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>CLI 실행 로그</span>
          </button>
        </div>
      </div>
    </header>
  );
};
