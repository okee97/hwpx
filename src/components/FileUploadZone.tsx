import React, { useRef, useState } from 'react';
import { UploadCloud, FileText, CheckCircle2, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { SAMPLE_HWP_PRESETS, SampleHwpPreset } from '../data/sampleDocuments';

interface FileUploadZoneProps {
  onFileUpload: (file: File) => void;
  onSelectPreset: (preset: SampleHwpPreset) => void;
  isLoading: boolean;
  activeFileName?: string;
}

export const FileUploadZone: React.FC<FileUploadZoneProps> = ({
  onFileUpload,
  onSelectPreset,
  isLoading,
  activeFileName,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      validateAndUpload(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndUpload(e.target.files[0]);
    }
  };

  const validateAndUpload = (file: File) => {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (ext !== '.hwp' && ext !== '.hwpx') {
      alert('한글 문서(.hwp 또는 .hwpx) 파일만 업로드 가능합니다.');
      return;
    }
    onFileUpload(file);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: Drag & Drop Dropzone */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <UploadCloud className="w-4 h-4 text-blue-600" />
              <span>HWP 문서 파일 업로드</span>
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              지원 형식: .hwp (5.0 OLE), .hwpx (OWPML)
            </span>
          </div>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[160px] ${
              isDragOver
                ? 'border-blue-500 bg-blue-50/50'
                : 'border-slate-300 hover:border-blue-400 bg-slate-50/50 hover:bg-white'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".hwp,.hwpx"
              onChange={handleFileChange}
              className="hidden"
            />

            {isLoading ? (
              <div className="flex flex-col items-center space-y-2">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                <p className="text-sm font-medium text-slate-800">
                  rhwp CLI로 문서 파싱 중...
                </p>
                <p className="text-xs text-slate-500 font-mono">
                  rhwp parse {activeFileName || 'document.hwp'} --format json
                </p>
              </div>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 mb-3">
                  <FileText className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-slate-800">
                  이곳에 한글(.hwp, .hwpx) 파일을 끌어다 놓거나 클릭하여 선택
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  최대 50MB까지 지원 • 바이너리 복합 포맷 자동 디코딩
                </p>
                {activeFileName && (
                  <div className="mt-3 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    현재 로드된 파일: {activeFileName}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right: Quick Sample Presets */}
        <div className="lg:w-80 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-200 pt-4 lg:pt-0 lg:pl-6">
          <div>
            <div className="flex items-center space-x-1.5 mb-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <h4 className="text-xs font-bold text-slate-900 tracking-wide">
                표준 공문서 샘플로 즉시 테스트
              </h4>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              실제 HWP 파일이 없는 경우, 표준 기안문 양식을 원클릭으로 로드하여 파싱 파이프라인을 검증할 수 있습니다.
            </p>

            <div className="space-y-2">
              {SAMPLE_HWP_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => onSelectPreset(preset)}
                  disabled={isLoading}
                  className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 transition group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                      {preset.category}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      {(preset.fileSize / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <div className="text-xs font-medium text-slate-900 line-clamp-1 group-hover:text-blue-600">
                    {preset.name}
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                    <span>{preset.fileName}</span>
                    <ArrowRight className="w-3 h-3 text-slate-400 group-hover:translate-x-0.5 transition" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
            <span>CLI 바이너리 경로:</span>
            <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600 font-mono">
              /usr/local/bin/rhwp
            </code>
          </div>
        </div>
      </div>
    </div>
  );
};
