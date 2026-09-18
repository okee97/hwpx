import React from 'react';
import { UploadCloud, ShieldCheck, Terminal, CheckCircle2, Layers, ShieldAlert, Sparkles, Building2 } from 'lucide-react';
import { DocumentStatus } from '../types';

interface PipelineStepperProps {
  status: DocumentStatus | 'IDLE';
  durationMs?: number;
  currentStep?: 'upload' | 'parse' | 'metadata' | 'rules' | 'findings';
}

export const PipelineStepper: React.FC<PipelineStepperProps> = ({ status, durationMs, currentStep }) => {
  const steps = [
    {
      id: 'upload',
      name: 'HWP 파일 업로드',
      desc: 'Multipart 바이너리 수신',
      icon: UploadCloud,
      active: status !== 'IDLE',
      completed: ['PARSING', 'PARSED', 'REVIEWING', 'COMPLETED'].includes(status),
    },
    {
      id: 'rhwp_cli',
      name: 'rhwp 고속 파싱',
      desc: 'HwpParseResult IR 생성',
      icon: Terminal,
      active: status === 'PARSING',
      completed: ['PARSED', 'REVIEWING', 'COMPLETED'].includes(status),
    },
    {
      id: 'metadata_ai',
      name: 'Metadata Extractor',
      desc: '사업정보 6대 필드 AI 추출',
      icon: Sparkles,
      active: currentStep === 'metadata',
      completed: ['PARSED', 'REVIEWING', 'COMPLETED'].includes(status),
    },
    {
      id: 'authoritative',
      name: '사업정보 확인 (Screen 2)',
      desc: 'Authoritative Metadata 확정',
      icon: Building2,
      active: currentStep === 'metadata',
      completed: ['REVIEWING', 'COMPLETED'].includes(status),
    },
    {
      id: 'rule_engine',
      name: 'Rule Engine 검토',
      desc: '키워드 2건 + 법령 1건 검사',
      icon: ShieldAlert,
      active: currentStep === 'rules' || status === 'REVIEWING',
      completed: ['COMPLETED'].includes(status),
    },
    {
      id: 'decision',
      name: '검토 결과 & 의사결정',
      desc: '[수용]/[불수용] 확정 저장',
      icon: CheckCircle2,
      active: currentStep === 'findings',
      completed: status === 'COMPLETED',
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 mb-3 border-b border-slate-100">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
          <h2 className="text-sm font-semibold text-slate-900">
            문서 검토 파이프라인 진행 상태 (End-to-End Vertical Pipeline)
          </h2>
        </div>
        <div className="text-xs text-slate-500 mt-1 sm:mt-0 font-mono">
          상태: <span className="font-semibold text-blue-700">{status}</span>
          {durationMs !== undefined && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">
              {durationMs} ms
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          const isDone = step.completed;
          const isCurrent = step.active && !isDone;

          return (
            <div
              key={step.id}
              className={`relative flex items-center md:flex-col md:items-start p-3 rounded-lg border transition-all ${
                isDone
                  ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                  : isCurrent
                  ? 'bg-blue-50 border-blue-300 text-blue-900 ring-2 ring-blue-100'
                  : 'bg-slate-50 border-slate-200/80 text-slate-500'
              }`}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <div
                  className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-semibold ${
                    isDone
                      ? 'bg-emerald-600 text-white'
                      : isCurrent
                      ? 'bg-blue-600 text-white animate-pulse'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isDone ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-3.5 h-3.5" />}
                </div>
                <span className="text-[11px] font-mono text-slate-400">Step {idx + 1}</span>
              </div>

              <div className="ml-3 md:ml-0 mt-1">
                <div className="text-xs font-semibold">{step.name}</div>
                <div className="text-[11px] text-slate-500">{step.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

