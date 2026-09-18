import { SeverityLevel } from './common';

export type RuleCategoryType =
  | 'RULE_FIX'
  | 'RULE_WARN'
  | 'RULE_RECOMMEND'
  | 'RULE_INFO'
  | 'FAIRNESS'
  | 'AI_REVIEW';

export type DecisionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';


export interface NativeLocator {
  section_index: number;
  paragraph_index?: number;
  table_index?: number;
  row?: number;
  col?: number;
}

export interface SourceRef {
  block_id: string;
  native_locator: NativeLocator;
  text?: string;
}

export interface DocumentBlock {
  block_id: string;
  block_type: string;
  native_locator: NativeLocator;
  text: string;
  style_name?: string;
}

export interface Finding {
  finding_id: string;
  project_id: string;
  rule_id: string;
  rule_name: string;
  category: RuleCategoryType;
  severity: SeverityLevel;
  title: string;
  original_text: string;
  matched_keyword: string;
  source_refs: SourceRef[];
  basis: string;
  recommendation: string;
  decision: DecisionStatus;
  decision_reason?: string | null;
  decided_at?: string | null;
  created_at: string;
}

export interface DecisionUpdateDto {
  decision: DecisionStatus;
  reason?: string;
}

export interface RuleExecuteResponse {
  project_id: string;
  total_findings: number;
  findings: Finding[];
  executed_rules_count: number;
  executed_at: string;
}

export interface ReviewPipelineResponse {
  project_id: string;
  total_findings: number;
  findings: Finding[];
  merged_count: number;
  filtered_by_validator_count: number;
  stage_counts: {
    rule_findings: number;
    fairness_findings: number;
    general_findings: number;
  };
  executed_at: string;
}

export const CATEGORY_META: Record<
  string,
  { label: string; badgeClass: string; textClass: string; borderClass: string; iconBg: string; description: string }
> = {
  RULE_FIX: {
    label: '즉시 수정',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
    textClass: 'text-rose-700',
    borderClass: 'border-rose-200',
    iconBg: 'bg-rose-50',
    description: '필수 법령 위반, 독소조항 등 즉시 조치 필요',
  },
  RULE_WARN: {
    label: '확인 필요',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    textClass: 'text-amber-700',
    borderClass: 'border-amber-200',
    iconBg: 'bg-amber-50',
    description: '공문서 표준 서식 및 권고사항 확인 필요',
  },
  RULE_RECOMMEND: {
    label: '확인 필요',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    textClass: 'text-amber-700',
    borderClass: 'border-amber-200',
    iconBg: 'bg-amber-50',
    description: '표준 서식 권고사항',
  },
  FAIRNESS: {
    label: '공정성 검토',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-200',
    textClass: 'text-purple-700',
    borderClass: 'border-purple-200',
    iconBg: 'bg-purple-50',
    description: '불공정 거래 및 과도한 의무 부과 조항 (상호협의 권고)',
  },
  AI_REVIEW: {
    label: 'AI 추가검토',
    badgeClass: 'bg-cyan-100 text-cyan-800 border-cyan-200',
    textClass: 'text-cyan-700',
    borderClass: 'border-cyan-200',
    iconBg: 'bg-cyan-50',
    description: '문서 간 모순, 누락, 과업-산출내역 불일치 심층 검토',
  },
};

