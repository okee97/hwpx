export type ClientType =
  | 'LOCAL_GOVERNMENT'
  | 'CENTRAL_GOVERNMENT'
  | 'PUBLIC_INSTITUTION'
  | 'EDUCATIONAL'
  | 'OTHER'
  | 'UNKNOWN';

export type GoverningLaw =
  | 'LOCAL_CONTRACT_ACT'
  | 'STATE_CONTRACT_ACT'
  | 'PUBLIC_ENTERPRISE_RULE'
  | 'OTHER'
  | 'UNKNOWN';

export type CompetitionMethod =
  | 'OPEN_COMPETITIVE'
  | 'RESTRICTED_COMPETITIVE'
  | 'NOMINATED_COMPETITIVE'
  | 'PRIVATE_CONTRACT'
  | 'UNKNOWN';

export type AwardMethod =
  | 'NEGOTIATION'
  | 'QUALIFICATION_REVIEW'
  | 'LOWEST_PRICE'
  | 'TWO_STAGE'
  | 'SPEC_PRICE_SIMULTANEOUS'
  | 'OTHER'
  | 'UNKNOWN';

export type EvidenceStatus =
  | 'EXPLICIT'      // 문서 명시
  | 'INFERRED'      // 문맥상 판단
  | 'CALCULATED'    // 산출/계산값
  | 'CONFLICT'      // 상충 정보 있음
  | 'UNVERIFIED';   // 확인 불가

export interface EvidenceQuote {
  block_id?: string;
  quote: string;
  note?: string;
  status: EvidenceStatus;
}

export type ProcurementMethod =
  | 'NEGOTIATION'
  | 'RESTRICTED_COMPETITIVE'
  | 'OPEN_COMPETITIVE'
  | 'PRIVATE_CONTRACT'
  | 'UNKNOWN';

export interface CalculatedCandidate {
  label: string;
  amount: number;
  note: string;
}

export interface ExtractedMetadata {
  project_id: string;
  project_name?: string | null;
  client_name?: string | null;
  demand_agency?: string | null;     // 수요기관/발주처 (예: ○○부, ○○구청)
  contract_agency?: string | null;   // 계약기관/조달기관 (예: 조달청, 자체계약)
  client_type: ClientType;
  governing_law: GoverningLaw;
  procurement_method: ProcurementMethod; // 하위 호환 필드
  competition_method?: CompetitionMethod; // 경쟁방법 (일반/제한/지명/수의)
  award_method?: AwardMethod; // 낙찰방법 (협상/적격심사/최저가 등)
  procurement_method_reason?: string;
  extracted_snippets?: Record<string, string>;
  is_ai_powered?: boolean;
  analysis_engine?: 'AI' | 'RULE_FALLBACK';
  model_used?: string;
  fallback_used?: boolean;
  budget_amount?: number | null;
  estimated_price?: number | null;
  calculated_candidates?: CalculatedCandidate[]; // 자동 덮어쓰지 않는 참고 계산값 (예: 총사업예산 ÷ 1.1)
  derived_estimated_price?: number | null;
  derivation_note?: string | null;
  requires_user_confirmation?: boolean;
  project_period?: string | null;
  confidence_scores: Record<string, number>;
  evidence_status?: Record<string, EvidenceStatus>;
  evidence_quotes?: Record<string, EvidenceQuote>;
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
  competition_method?: CompetitionMethod;
  award_method?: AwardMethod;
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
  competition_method?: CompetitionMethod;
  award_method?: AwardMethod;
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
  UNKNOWN: { label: '미지정 / 확인 필요', desc: '문서에서 명확히 확인되지 않음 (담당자 확정 필요)' },
};

export const GOVERNING_LAW_LABELS: Record<GoverningLaw, { label: string; short: string }> = {
  LOCAL_CONTRACT_ACT: { label: '지방자치단체를 당사자로 하는 계약에 관한 법률 (지방계약법)', short: '지방계약법' },
  STATE_CONTRACT_ACT: { label: '국가를 당사자로 하는 계약에 관한 법률 (국가계약법)', short: '국가계약법' },
  PUBLIC_ENTERPRISE_RULE: { label: '공기업·준정부기관 계약사무규칙', short: '공기업계약규칙' },
  OTHER: { label: '기타 관계 법령', short: '기타' },
  UNKNOWN: { label: '미지정 / 법령 확인 필요', short: '미지정' },
};

export const PROCUREMENT_METHOD_LABELS: Record<ProcurementMethod, { label: string; desc: string }> = {
  NEGOTIATION: { label: '협상에 의한 계약', desc: '기술제안서 평가(80~90%) + 가격평가(10~20%)' },
  RESTRICTED_COMPETITIVE: { label: '제한경쟁입찰', desc: '지역, 실적, 자격요건 등을 제한하는 경쟁' },
  OPEN_COMPETITIVE: { label: '일반경쟁입찰', desc: '모든 자격보유자의 공개 입찰 참가 허용' },
  PRIVATE_CONTRACT: { label: '수의계약', desc: '소액 또는 특정 사유에 의한 특정업체 직접 계약' },
  UNKNOWN: { label: '미지정 / 확인 필요', desc: '문서상 계약방식 미확인 (담당자 확인 필요)' },
};

export const COMPETITION_METHOD_LABELS: Record<CompetitionMethod, { label: string; desc: string }> = {
  OPEN_COMPETITIVE: { label: '일반경쟁', desc: '참가자격 요건을 갖춘 모든 사업자 공개 참가 허용' },
  RESTRICTED_COMPETITIVE: { label: '제한경쟁', desc: '지역제한, 실적제한, 중소기업자간경쟁 등 특정 요건으로 입찰 참가자 제한' },
  NOMINATED_COMPETITIVE: { label: '지명경쟁', desc: '발주기관이 적격자로 인정한 특정 다수 사업자 지명' },
  PRIVATE_CONTRACT: { label: '수의계약', desc: '경쟁 절차 없이 특정 업체와 단독 계약 체결' },
  UNKNOWN: { label: '미확인 / 직접 선택', desc: '문서에서 경쟁방식이 명시되지 않음 (담당자 확정 필요)' },
};

export const AWARD_METHOD_LABELS: Record<AwardMethod, { label: string; desc: string }> = {
  NEGOTIATION: { label: '협상에 의한 계약', desc: '기술제안서 평가(80~90%)와 가격평가(10~20%) 종합 합산 후 고득점순 협상' },
  QUALIFICATION_REVIEW: { label: '적격심사', desc: '예정가격 이하 최저가격 입찰자부터 계약이행능력 심사하여 낙찰' },
  LOWEST_PRICE: { label: '최저가낙찰제', desc: '예정가격 이하로서 최저가격으로 입찰한 자 낙찰' },
  TWO_STAGE: { label: '2단계 경쟁등', desc: '규격 또는 기술입찰 실시 후 적격자에 한하여 가격입찰' },
  SPEC_PRICE_SIMULTANEOUS: { label: '규격·가격 동시입찰', desc: '규격입찰서와 가격입찰서를 동시 제출 후 규격적격자 대상 개찰' },
  OTHER: { label: '기타 낙찰자 결정방식', desc: '특수 조건에 따른 낙찰 방식' },
  UNKNOWN: { label: '미확인 / 직접 선택', desc: '문서에서 낙찰자 결정방식이 명시되지 않음 (담당자 확정 필요)' },
};

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, { label: string; color: string; badge: string }> = {
  EXPLICIT: { label: '문서 명시', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', badge: '● 문서 명시' },
  INFERRED: { label: '문맥상 판단', color: 'text-blue-700 bg-blue-50 border-blue-200', badge: '● 문맥상 판단' },
  CALCULATED: { label: '산출/계산값', color: 'text-indigo-700 bg-indigo-50 border-indigo-200', badge: '● 산출/계산값' },
  CONFLICT: { label: '상충 정보 있음', color: 'text-amber-700 bg-amber-50 border-amber-200', badge: '▲ 상충 정보' },
  UNVERIFIED: { label: '확인 불가', color: 'text-slate-600 bg-slate-100 border-slate-200', badge: '○ 확인 불가' },
};

