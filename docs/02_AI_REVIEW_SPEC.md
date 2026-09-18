# [02_AI_REVIEW_SPEC] AI 검토 엔진 및 Metadata Extractor 명세서 (v1.1)

본 문서는 HWP 제안요청서/과업지시서의 사업정보를 지능적으로 분석·추출하는 **Metadata Extractor** 및 Rule Engine 연동 규격을 정의합니다.

---

## 1. Metadata Extractor AI 개요

HWP 문서가 업로드 및 파싱되면, Metadata Extractor는 HWP 문단의 표지와 1장(사업 개요/일반 현황)의 표(Table) 및 문단(Paragraph)을 분석하여 공공입찰의 핵심 사업 메타데이터를 정형화된 스키마로 추출합니다.

### 1.1 핵심 추출 항목 (6대 필드)
1. **수요기관명 (`client_name`)**: 공고 및 발주를 시행하는 기관명 (예: 서울특별시 강남구, 한국지역정보개발원, 행정안전부)
2. **수요기관 유형 (`client_type`)**:
   - `LOCAL_GOVERNMENT`: 지방자치단체 (특별시, 광역시, 도, 시·군·구 및 산하 사업소)
   - `CENTRAL_GOVERNMENT`: 국가기관 / 중앙행정기관 (부·처·청)
   - `PUBLIC_INSTITUTION`: 공공기관 / 공기업 / 준정부기관
   - `EDUCATIONAL`: 교육청 / 국공립학교
   - `OTHER`: 기타 법인 및 단체
3. **적용 계약법 (`governing_law`)**:
   - `LOCAL_CONTRACT_ACT`: 지방자치단체를 당사자로 하는 계약에 관한 법률 (지방계약법)
   - `STATE_CONTRACT_ACT`: 국가를 당사자로 하는 계약에 관한 법률 (국가계약법)
   - `PUBLIC_ENTERPRISE_RULE`: 공기업·준정부기관 계약사무규칙
   - `OTHER`: 기타 특별법
4. **계약방법 (`procurement_method`)**:
   - `NEGOTIATION`: 협상에 의한 계약
   - `RESTRICTED_COMPETITIVE`: 제한경쟁입찰
   - `OPEN_COMPETITIVE`: 일반경쟁입찰
   - `PRIVATE_CONTRACT`: 수의계약
5. **사업예산 (`budget_amount`)**: 부가세 포함 사업 총예산 (예: 500,000,000원)
6. **추정가격 (`estimated_price`)**: 부가세 제외 순수 공급가액 (예: 454,545,455원)
7. **부가 정보**: 사업명(`project_name`), 사업기간(`project_period`), 추출 근거 원문 및 신뢰도(`confidence`).

---

## 2. 2단계 메타데이터 관리 원칙 (Decoupled Metadata Architecture)

데이터의 신뢰성과 사용자 통제권을 보장하기 위해 **AI 추출값**과 **사용자 확정값**을 엄격히 분리하여 영속화합니다.

```
[HWP 파싱 결과 DocumentBlocks]
          │
          ▼
   [Metadata Extractor AI] ───► [Extracted Metadata] (AI 자동 추출 / 원본 보존)
                                        │
                                        ▼ (화면 2: 사업정보 확인 UI 폼)
   [사용자 확인 및 수정] ───────► [Authoritative Metadata] (사용자 확정본 / Snapshot 생성)
                                        │
                                        ▼
                                 [Rule Engine] (Metadata 기반 법령 정합성 룰 검사)
```

1. **Extracted Metadata (`extracted_metadata`)**:
   - AI가 문단/표에서 추출한 값과 출처(SourceRef), 신뢰도 점수(0.0 ~ 1.0).
   - 사용자가 임의로 덮어쓸 수 없는 감사용 원본.
2. **Authoritative Metadata (`authoritative_metadata`)**:
   - 사용자가 화면 2에서 검증하고 수정한 최종 확정 데이터.
   - 수정할 때마다 `version`이 증가하며 스냅샷 이력 관리.
   - **모든 후속 Rule Engine과 Agent는 반드시 Authoritative Metadata를 기준으로 동작함.**

---

## 3. Metadata 기반 Rule Engine 연계 규격

### `RULE-META-001`: 수요기관 유형과 적용 계약법 불일치 조항 탐지
- **분류**: `RULE_FIX` (🔴 즉시 수정)
- **심각도**: `HIGH`
- **탐지 조건**:
  - `AuthoritativeMetadata.client_type == 'LOCAL_GOVERNMENT'` (지방자치단체) 또는 `AuthoritativeMetadata.governing_law == 'LOCAL_CONTRACT_ACT'`로 확정됨.
  - 그러나 제안요청서 본문에 *"국가를 당사자로 하는 계약에 관한 법률"* 또는 *"국가계약법"* 조항이 명시되어 있는 경우.
- **법적 근거**:
  - 지방자치단체를 당사자로 하는 계약에 관한 법률 제4조(다른 법률과의 관계)에 의거, 지자체 발주 용역은 지방계약법이 우선 적용되며 국가계약법 조항을 원용할 수 없습니다.
- **권고 문안**:
  - "본 문서는 지방자치단체 발주 사업이므로, '국가를 당사자로 하는 계약에 관한 법률' 조항을 '지방자치단체를 당사자로 하는 계약에 관한 법률(지방계약법)' 및 동법 시행령으로 수정하십시오."
