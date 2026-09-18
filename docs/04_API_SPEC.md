# [04_API_SPEC] REST API 명세서 (v1.1)

본 문서는 HWP AI 자동 검토 시스템의 백엔드 API 명세서입니다.

---

## 1. 개요 및 공통 응답 규격

모든 API 응답은 일관된 JSON envelope 형식(`ApiResponse<T>`)을 따릅니다.

```json
{
  "success": true,
  "message": "성공 메시지",
  "data": { ... },
  "error": null
}
```

---

## 2. 문서 파싱 API

### POST `/api/v1/documents/upload`
- **설명**: HWP / HWPX 바이너리 파일을 업로드하여 `rhwp` CLI를 통해 JSON 구조체로 파싱합니다.
- **Content-Type**: `multipart/form-data`
- **Request Parameters**:
  - `file`: File (필수, `.hwp` 또는 `.hwpx`)
  - `auto_parse`: boolean (기본값: true)
- **Response**: `ApiResponse<HwpParseResult>`

---

## 3. 규칙 엔진 및 지적사항(Finding) API

### POST `/api/v1/projects/{id}/rules/execute`
- **설명**: 프로젝트 내 문서의 `DocumentBlock`을 순회하여 대표 룰(주민등록번호, 자동연장 독소조항)을 검사하고 Finding을 생성하여 저장합니다.
- **Path Parameter**:
  - `id`: string (프로젝트 또는 문서 ID)
- **Request Body** (선택):
  ```json
  {
    "document_id": "doc-sample-1",
    "blocks": [
      {
        "block_id": "para_4",
        "block_type": "PARAGRAPH",
        "native_locator": { "section_index": 0, "paragraph_index": 3 },
        "text": "나. 비공개 민감 정보(주민등록번호, 계좌번호 등)의 외부 유출 사전 차단 필터링 구축"
      }
    ],
    "raw_text": "..."
  }
  ```
- **Response**: `ApiResponse<RuleExecuteResponse>`
  ```json
  {
    "success": true,
    "message": "프로젝트 'doc-sample-1'에 대해 2개 대표 규칙 실행 완료. 총 2건의 Finding이 탐지되었습니다.",
    "data": {
      "project_id": "doc-sample-1",
      "total_findings": 2,
      "findings": [ ... ],
      "executed_rules_count": 2,
      "executed_at": "2026-09-17T03:45:00Z"
    }
  }
  ```

---

### GET `/api/v1/projects/{id}/findings`
- **설명**: 해당 프로젝트에서 탐지된 모든 Finding 지적사항 목록을 조회합니다.
- **Path Parameter**:
  - `id`: string (프로젝트 ID)
- **Response**: `ApiResponse<List<Finding>>`

---

### GET `/api/v1/projects/{id}/findings/{finding_id}`
- **설명**: 특정 지적사항의 상세 정보(원문 위치, 권고 문안, 법적 근거, 사용자 결정)를 조회합니다.
- **Path Parameters**:
  - `id`: string (프로젝트 ID)
  - `finding_id`: string (지적사항 ID)
- **Response**: `ApiResponse<Finding>`

---

### PUT `/api/v1/projects/{id}/findings/{finding_id}/decision`
- **설명**: 사용자가 검토 카드에서 [수용] 또는 [불수용]을 선택했을 때 결정을 저장합니다.
- **Path Parameters**:
  - `id`: string (프로젝트 ID)
  - `finding_id`: string (지적사항 ID)
- **Request Body**:
  ```json
  {
    "decision": "ACCEPTED", // "ACCEPTED" (수용) 또는 "REJECTED" (불수용)
    "reason": "발주부서와 협의 완료하여 생년월일 대체 문안을 수용함" // 선택
  }
  ```
- **Response**: `ApiResponse<Finding>`
  ```json
  {
    "success": true,
    "message": "Finding 'finding-rule-keyword-001-para_4'에 대해 '수용' 결정이 성공적으로 저장되었습니다.",
    "data": {
      "finding_id": "finding-rule-keyword-001-para_4",
      "project_id": "doc-sample-1",
      "rule_id": "RULE-KEYWORD-001",
      "decision": "ACCEPTED",
      "decision_reason": "발주부서와 협의 완료하여 생년월일 대체 문안을 수용함",
      "decided_at": "2026-09-17T03:46:12Z"
    }
  }
  ```

---

## 4. 사업 메타데이터 API (Metadata Extractor & Authoritative)

### POST `/api/v1/projects/{id}/metadata/extract`
- **설명**: 파싱된 HWP DocumentBlock들을 기반으로 Gemini AI 및 지능형 휴리스틱을 가동하여 사업정보를 비동기/동기로 추출합니다.
- **Path Parameter**:
  - `id`: string (프로젝트 ID)
- **Request Body** (선택):
  ```json
  {
    "blocks": [ ... ],
    "raw_text": "...",
    "async_mode": false
  }
  ```
- **Response**: `ApiResponse<ExtractedMetadata>`

---

### GET `/api/v1/projects/{id}/metadata/extracted`
- **설명**: 해당 프로젝트에서 AI가 추출한 원본 사업정보(Extracted Metadata) 및 신뢰도 점수를 조회합니다.
- **Path Parameter**:
  - `id`: string (프로젝트 ID)
- **Response**: `ApiResponse<ExtractedMetadata>`

---

### PUT `/api/v1/projects/{id}/metadata/authoritative`
- **설명**: 사용자가 화면 2에서 확인하고 수정한 최종 사업정보를 저장하고, 신규 버전의 스냅샷을 생성합니다.
- **Path Parameter**:
  - `id`: string (프로젝트 ID)
- **Request Body**:
  ```json
  {
    "project_name": "2026년 지능형 차세대 행정정보시스템 구축",
    "client_name": "서울특별시 강남구",
    "client_type": "LOCAL_GOVERNMENT",
    "governing_law": "LOCAL_CONTRACT_ACT",
    "procurement_method": "NEGOTIATION",
    "budget_amount": 550000000,
    "estimated_price": 500000000,
    "project_period": "계약체결일로부터 8개월",
    "note": "지자체 발주 확인 완료, 지방계약법 적용 확정"
  }
  ```
- **Response**: `ApiResponse<AuthoritativeMetadata>`

---

### GET `/api/v1/projects/{id}/metadata/authoritative`
- **설명**: 최신 버전의 Authoritative Metadata 및 스냅샷 정보를 조회합니다.
- **Path Parameter**:
  - `id`: string (프로젝트 ID)
- **Response**: `ApiResponse<AuthoritativeMetadata>`

