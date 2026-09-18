export type ClientType =
  | 'LOCAL_GOVERNMENT'
  | 'CENTRAL_GOVERNMENT'
  | 'PUBLIC_INSTITUTION'
  | 'EDUCATIONAL'
  | 'OTHER';

export type GoverningLaw =
  | 'LOCAL_CONTRACT_ACT'
  | 'STATE_CONTRACT_ACT'
  | 'PUBLIC_ENTERPRISE_RULE'
  | 'OTHER';

export type ProcurementMethod =
  | 'NEGOTIATION'
  | 'RESTRICTED_COMPETITIVE'
  | 'OPEN_COMPETITIVE'
  | 'PRIVATE_CONTRACT';

export interface ExtractedMetadata {
  project_id: string;
  project_name?: string | null;
  client_name?: string | null;
  client_type: ClientType;
  governing_law: GoverningLaw;
  procurement_method: ProcurementMethod;
  procurement_method_reason?: string;
  extracted_snippets?: Record<string, string>;
  is_ai_powered?: boolean;
  budget_amount?: number | null;
  estimated_price?: number | null;
  project_period?: string | null;
  confidence_scores: Record<string, number>;
  source_references: Record<string, string>;
  extracted_at: string;
  status: string;
}

export interface AuthoritativeMetadata {
  project_id: string;
  version: number;
  project_name: string;
  client_name: string;
  client_type: ClientType;
  governing_law: GoverningLaw;
  procurement_method: ProcurementMethod;
  budget_amount?: number | null;
  estimated_price?: number | null;
  project_period?: string | null;
  confirmed_by?: string;
  note?: string | null;
  updated_at: string;
}

export interface AuthoritativeMetadataUpdateDto {
  project_name: string;
  client_name: string;
  client_type: ClientType;
  governing_law: GoverningLaw;
  procurement_method: ProcurementMethod;
  budget_amount?: number | null;
  estimated_price?: number | null;
  project_period?: string | null;
  confirmed_by?: string;
  note?: string | null;
}

export interface MetadataSnapshot {
  snapshot_id: string;
  project_id: string;
  version: number;
  data: AuthoritativeMetadata;
  created_at: string;
}

export const CLIENT_TYPE_LABELS: Record<ClientType, { label: string; desc: string }> = {
  LOCAL_GOVERNMENT: { label: '지방자치단체', desc: '특별시·광역시·도, 시·군·구 및 직속기관 (지방계약법 적용)' },
  CENTRAL_GOVERNMENT: { label: '국가기관 / 중앙행정기관', desc: '부·처·청 및 소속 국가기관 (국가계약법 적용)' },
  PUBLIC_INSTITUTION: { label: '공공기관 / 공기업', desc: '공공기관운영법 대상 공기업 및 준정부기관' },
  EDUCATIONAL: { label: '교육청 / 국공립학교', desc: '시·도 교육청 및 산하 교육지원청, 국공립학교' },
  OTHER: { label: '기타 공공단체', desc: '기타 특별법인 및 출연연구기관' },
};

export const GOVERNING_LAW_LABELS: Record<GoverningLaw, { label: string; short: string }> = {
  LOCAL_CONTRACT_ACT: { label: '지방자치단체를 당사자로 하는 계약에 관한 법률 (지방계약법)', short: '지방계약법' },
  STATE_CONTRACT_ACT: { label: '국가를 당사자로 하는 계약에 관한 법률 (국가계약법)', short: '국가계약법' },
  PUBLIC_ENTERPRISE_RULE: { label: '공기업·준정부기관 계약사무규칙', short: '공기업계약규칙' },
  OTHER: { label: '기타 관계 법령', short: '기타' },
};

export const PROCUREMENT_METHOD_LABELS: Record<ProcurementMethod, { label: string; desc: string }> = {
  NEGOTIATION: { label: '협상에 의한 계약', desc: '기술제안서 평가(80~90%) + 가격평가(10~20%)' },
  RESTRICTED_COMPETITIVE: { label: '제한경쟁입찰', desc: '지역, 실적, 자격요건 등을 제한하는 경쟁' },
  OPEN_COMPETITIVE: { label: '일반경쟁입찰', desc: '모든 자격보유자의 공개 입찰 참가 허용' },
  PRIVATE_CONTRACT: { label: '수의계약', desc: '소액 또는 특정 사유에 의한 특정업체 직접 계약' },
};
