# [03_DATA_SCHEMA] 데이터 모델 및 스키마 명세서 (v1.1)

본 문서는 FastAPI의 Pydantic v2 모델과 Next.js(TypeScript) 인터페이스 간의 규격을 정의합니다.

---

## 1. 열거형 (Enums)

### DocumentStatus
문서의 수명 주기 및 처리 상태를 나타냅니다.
- `UPLOADED`: 파일이 서버에 성공적으로 업로드됨
- `PARSING`: `rhwp` CLI를 통한 구조 파싱 진행 중
- `PARSED`: HWP IR 및 텍스트/테이블 파싱 완료
- `REVIEWING`: AI 규정 검토 진행 중
- `COMPLETED`: 검토 및 리포트 생성 완료
- `FAILED`: 파싱 또는 검토 실패

### DocumentFormat
- `HWP`: 한글 5.0 바이너리 복합 파일 (CFBF/OLE2)
- `HWPX`: OWPML 기반 개방형 XML 한글 파일

### SeverityLevel
- `CRITICAL`: 중대 위반 (법령 위반, 개인정보 노출 등)
- `WARNING`: 주의 및 권고 (공문서 작성 규정, 띄어쓰기 등)
- `INFO`: 단순 참고 및 어휘 순화 제안

---

## 2. 문서 및 메타데이터 스키마 (Document & Metadata)

### DocumentMetadata
```json
{
  "title": "string (문서 제목)",
  "author": "string | null (작성자)",
  "created_date": "string | null (작성 일시)",
  "modified_date": "string | null (수정 일시)",
  "hwp_version": "string (예: 5.0.3.0)",
  "is_compressed": "boolean (zlib 압축 여부)",
  "is_encrypted": "boolean (암호화 여부)",
  "page_count": "number (예상 페이지 수)",
  "paragraph_count": "number (총 문단 수)",
  "table_count": "number (총 표 수)",
  "character_count": "number (글자 수)",
  "word_count": "number (단어 수)"
}
```

### Document
```json
{
  "id": "string (UUID)",
  "title": "string",
  "file_name": "string",
  "file_size": "number (bytes)",
  "file_format": "DocumentFormat (HWP | HWPX)",
  "status": "DocumentStatus",
  "error_message": "string | null",
  "metadata": "DocumentMetadata",
  "created_at": "string (ISO8601)",
  "updated_at": "string (ISO8601)"
}
```

---

## 3. HWP 구조 파싱 스키마 (HwpParseResult)

### HwpTextRun (인라인 글자 모양)
- `text`: 문자열 조각
- `font_family`: 폰트명 (한컴바탕, 맑은 고딕 등)
- `font_size`: 포인트 크기 (pt)
- `is_bold`: 굵게 여부
- `is_italic`: 기울임 여부
- `color`: 색상 코드 (#111827 등)

### HwpParagraph (문단)
- `id`: 고유 식별자 (`para_1`, `para_2` 등)
- `section_index`: 구역 인덱스 (0부터 시작)
- `paragraph_index`: 구역 내 문단 인덱스
- `text`: 문단 전체 평문 텍스트
- `style_name`: 스타일명 (제목, 개요, 본문 등)
- `align`: 정렬 (`LEFT` | `CENTER` | `RIGHT` | `JUSTIFY`)
- `text_runs`: `HwpTextRun[]`

### HwpCell & HwpTable (표 구조)
- **HwpCell**:
  - `row`: 행 번호 (0-based)
  - `col`: 열 번호 (0-based)
  - `row_span`: 병합 행 수
  - `col_span`: 병합 열 수
  - `text`: 셀 텍스트 내용
  - `is_header`: 표 헤더 여부
- **HwpTable**:
  - `id`: 표 식별자 (`table_1`)
  - `section_index`: 구역 번호
  - `row_count`: 행 개수
  - `col_count`: 열 개수
  - `cells`: `HwpCell[]`

### HwpSection (구역)
- `index`: 구역 번호
- `page_count`: 구역 내 페이지 수
- `paragraphs`: `HwpParagraph[]`
- `tables`: `HwpTable[]`

### HwpParseResult (최종 파싱 결과)
- `document_id`: 연결된 문서 ID
- `version`: rhwp CLI 파서 버전
- `file_name`: 원본 파일명
- `file_size`: 파일 크기 (바이트)
- `format`: HWP 또는 HWPX
- `metadata`: `DocumentMetadata`
- `sections`: `HwpSection[]`
- `raw_text`: 문서 전체 추출 텍스트
- `ir_json`: rhwp 중간 표현식(IR) 원본 딕셔너리
- `cli_execution_info`: 실행된 CLI 명령어, 처리 소요 시간(ms), 종료 코드
- `parsed_at`: 파싱 완료 시각 (ISO8601)

---

## 4. 규칙 엔진 및 지적사항 스키마 (Rule Engine & Finding)

### RuleCategoryType
- `RULE_FIX`: 🔴 즉시 수정 (필수 법령 위반, 독소조항 등 즉시 수정 필요)
- `RULE_RECOMMEND`: 🟡 권고 수정 (공문서 표준 서식 권고사항)
- `RULE_INFO`: 🔵 단순 참고 (참고사항 및 가이드)

### DecisionStatus
- `PENDING`: 검토 대기중 (기본값)
- `ACCEPTED`: 수용 완료 (수정 권고안 반영)
- `REJECTED`: 불수용 (원문 유지)

### NativeLocator (HWP 원본 문서 세부 좌표)
```json
{
  "section_index": 0,
  "paragraph_index": 3,
  "table_index": null,
  "row": null,
  "col": null
}
```

### SourceRef (원문 블록 참조)
```json
{
  "block_id": "para_4",
  "native_locator": {
    "section_index": 0,
    "paragraph_index": 3
  },
  "text": "나. 비공개 민감 정보(주민등록번호, 계좌번호 등)의 외부 유출 사전 차단 필터링 구축"
}
```

### DocumentBlock (평탄화된 검토 단위)
```json
{
  "block_id": "para_4",
  "block_type": "PARAGRAPH",
  "native_locator": {
    "section_index": 0,
    "paragraph_index": 3
  },
  "text": "문단 또는 표 셀의 전체 평문 내용",
  "style_name": "개요 2"
}
```

### Finding (검토 지적사항)
```json
{
  "finding_id": "finding-rule-keyword-001-para_4",
  "project_id": "doc-2026-001",
  "rule_id": "RULE-KEYWORD-001",
  "rule_name": "주민등록번호 요구 탐지",
  "category": "RULE_FIX",
  "severity": "HIGH",
  "title": "주민등록번호 수집/요구 조항 탐지",
  "original_text": "나. 비공개 민감 정보(주민등록번호, 계좌번호 등)의 외부 유출 사전 차단 필터링 구축",
  "matched_keyword": "주민등록번호",
  "source_refs": [
    {
      "block_id": "para_4",
      "native_locator": {
        "section_index": 0,
        "paragraph_index": 3
      },
      "text": "..."
    }
  ],
  "basis": "개인정보보호법 제24조의2(주민등록번호 처리의 제한)에 따라 원칙적으로 주민등록번호 처리가 금지됩니다.",
  "recommendation": "주민등록번호 요구 문구를 삭제하고, '생년월일(YYYY.MM.DD)' 또는 마이핀/아이핀 등 대체 수단으로 변경하십시오.",
  "decision": "PENDING",
  "decision_reason": null,
  "decided_at": null,
  "created_at": "2026-09-17T03:45:00Z"
}
```

### DecisionUpdateDto (의사결정 업데이트 요청)
```json
{
  "decision": "ACCEPTED",
  "reason": "발주부서 협의 완료 후 대체 문안 수용"
}
```

---

## 5. 사업 메타데이터 스키마 (Metadata Extractor & Authoritative)

### 5.1 메타데이터 열거형 (Enums)

#### ClientType (수요기관 유형)
- `LOCAL_GOVERNMENT`: 지방자치단체 (시·도, 시·군·구 및 직속기관)
- `CENTRAL_GOVERNMENT`: 국가기관 / 중앙행정기관 (부·처·청)
- `PUBLIC_INSTITUTION`: 공공기관 / 공기업 / 준정부기관
- `EDUCATIONAL`: 교육청 / 국공립학교
- `OTHER`: 기타 공공법인

#### GoverningLaw (적용 계약법령)
- `LOCAL_CONTRACT_ACT`: 지방계약법 (지방자치단체를 당사자로 하는 계약에 관한 법률)
- `STATE_CONTRACT_ACT`: 국가계약법 (국가를 당사자로 하는 계약에 관한 법률)
- `PUBLIC_ENTERPRISE_RULE`: 공기업·준정부기관 계약사무규칙
- `OTHER`: 기타 법령

#### ProcurementMethod (계약방법)
- `NEGOTIATION`: 협상에 의한 계약
- `RESTRICTED_COMPETITIVE`: 제한경쟁입찰
- `OPEN_COMPETITIVE`: 일반경쟁입찰
- `PRIVATE_CONTRACT`: 수의계약

### 5.2 AI 추출 메타데이터 (ExtractedMetadata)
AI가 제안요청서로부터 자동 추출한 데이터 (읽기 전용 및 감사용).

```json
{
  "project_id": "doc-sample-1",
  "project_name": "2026년 지능형 차세대 행정정보시스템 구축",
  "client_name": "서울특별시 강남구",
  "client_type": "LOCAL_GOVERNMENT",
  "governing_law": "LOCAL_CONTRACT_ACT",
  "procurement_method": "NEGOTIATION",
  "budget_amount": 550000000,
  "estimated_price": 500000000,
  "project_period": "계약체결일로부터 8개월",
  "confidence_scores": {
    "client_name": 0.96,
    "client_type": 0.92,
    "governing_law": 0.94,
    "procurement_method": 0.98,
    "budget_amount": 0.91,
    "estimated_price": 0.88
  },
  "source_references": {
    "client_name": "para_2",
    "budget_amount": "table_1_cell_3"
  },
  "extracted_at": "2026-09-17T03:50:00Z",
  "status": "COMPLETED"
}
```

### 5.3 사용자 확정 메타데이터 (AuthoritativeMetadata)
사용자가 화면 2에서 검토 및 수정한 최종 사업정보 (후속 Rule Engine 검사의 절대 기준).

```json
{
  "project_id": "doc-sample-1",
  "version": 1,
  "project_name": "2026년 지능형 차세대 행정정보시스템 구축",
  "client_name": "서울특별시 강남구",
  "client_type": "LOCAL_GOVERNMENT",
  "governing_law": "LOCAL_CONTRACT_ACT",
  "procurement_method": "NEGOTIATION",
  "budget_amount": 550000000,
  "estimated_price": 500000000,
  "project_period": "계약체결일로부터 8개월",
  "confirmed_by": "user_officer",
  "note": "지자체 발주 확인 완료, 지방계약법 적용 확정",
  "updated_at": "2026-09-17T03:52:00Z"
}
```

### 5.4 메타데이터 스냅샷 (MetadataSnapshot)
Authoritative Metadata가 변경될 때마다 자동 보관되는 버전별 스냅샷.

```json
{
  "snapshot_id": "snap-doc-sample-1-v1",
  "project_id": "doc-sample-1",
  "version": 1,
  "data": { ... },
  "created_at": "2026-09-17T03:52:00Z"
}
```


