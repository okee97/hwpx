import { SeverityLevel } from './common';

export interface ReviewCategory {
  id: string;
  name: string;
  description: string;
}

export interface ReviewRule {
  id: string;
  category_id: string;
  name: string;
  description: string;
  severity: SeverityLevel;
  enabled: boolean;
}

export interface Violation {
  id: string;
  rule_id: string;
  rule_name: string;
  category: string;
  severity: SeverityLevel;
  paragraph_id?: string | null;
  target_text: string;
  message: string;
  suggestion?: string | null;
  start_offset?: number | null;
  end_offset?: number | null;
}

export interface CategorySummary {
  category: string;
  total_issues: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
}

export interface ReviewResult {
  id: string;
  document_id: string;
  total_violations: number;
  score: number;
  summary: string;
  categories_summary: CategorySummary[];
  violations: Violation[];
  reviewed_at: string;
}
