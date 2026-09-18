# 프로젝트 아키텍처 및 세로 슬라이스 1 명세 (v1.1)

## 1. 프로젝트 폴더 구조 (Project Directory Structure)

```
project-root/
├── backend/                                # FastAPI 백엔드
│   ├── app/
│   │   ├── api/                            # API 라우트 계층
│   │   │   └── v1/
│   │   │       ├── endpoints/
│   │   │       │   ├── documents.py        # HWP 업로드 및 rhwp 파싱 엔드포인트
│   │   │       │   └── health.py           # 헬스체크 및 rhwp CLI 상태 점검
│   │   │       └── router.py               # v1 라우터 통합
│   │   ├── schemas/                        # Pydantic v2 데이터 스키마 (03_DATA_SCHEMA.md)
│   │   │   ├── common.py                   # Enums (Status, Format, Severity) 및 ApiResponse
│   │   │   ├── document.py                 # Document, DocumentMetadata, DocumentUploadResponse
│   │   │   ├── hwp.py                      # HwpParseResult, Section, Paragraph, Table, Cell
│   │   │   └── review.py                   # ReviewRule, Violation, ReviewResult (슬라이스 2 기반)
│   │   ├── services/                       # 비즈니스 로직 계층
│   │   │   ├── rhwp_parser.py              # rhwp CLI 서브프로세스 호출 및 Pydantic 매핑
│   │   │   └── storage.py                  # 멀티파트 파일 검증 및 로컬 스토리지 관리
│   │   ├── config.py                       # 환경설정 (경로, 타임아웃, 업로드 제한)
│   │   └── main.py                         # FastAPI 어플리케이션 진입점 및 CORS
│   └── requirements.txt                    # 백엔드 의존성 목록
│
├── docs/                                   # 프로젝트 설계 문서 모음
│   ├── 01_PRODUCT_SPEC.md                  # 제품 기능 및 세로 슬라이스 요구사항 명세
│   ├── 03_DATA_SCHEMA.md                   # 데이터 모델 및 스키마 명세
│   └── ARCHITECTURE.md                     # 시스템 아키텍처 및 타입 매핑 정의
│
├── src/                                    # 프론트엔드 (Next.js / React)
│   ├── types/                              # Pydantic 스키마와 1:1 매칭되는 TypeScript 정의
│   │   ├── common.ts                       # DocumentStatus, DocumentFormat, SeverityLevel, ApiResponse
│   │   ├── document.ts                     # DocumentMetadata, DocumentResponse, DocumentUploadResponse
│   │   ├── hwp.ts                          # HwpParseResult, HwpSection, HwpParagraph, HwpTable, HwpCell
│   │   ├── review.ts                       # ReviewRule, Violation, CategorySummary, ReviewResult
│   │   └── index.ts                        # Barrel export
│   ├── components/                         # UI 컴포넌트
│   │   ├── FileUploadZone.tsx              # HWP 드래그&드롭 및 파일 선택자, 샘플 문서 선택
│   │   ├── ParsedDocumentViewer.tsx        # 메타데이터, 문단, 행정 표, 전문 텍스트, IR JSON 뷰어
│   │   ├── PipelineStepper.tsx             # 세로 슬라이스 1 파이프라인 진행 상태 (Upload -> CLI -> IR)
│   │   ├── SchemaComparisonModal.tsx       # FastAPI Pydantic vs Next.js TypeScript 스키마 비교 모달
│   │   └── CliLogModal.tsx                 # rhwp CLI 실행 로그 및 표준 출력 뷰어
│   ├── data/
│   │   └── sampleDocuments.ts              # 사전 탑재된 한글 공문서 샘플 데이터
│   ├── App.tsx                             # 통합 세로 슬라이스 인터페이스
│   ├── index.css                           # Tailwind CSS
│   └── main.tsx
│
├── samples/                                # 검증용 샘플 HWP 파일
│   └── sample_official_doc.hwp             # 실제 바이너리 OLE HWP 5.0 테스트 문서
│
└── server.ts                               # 풀스택 런타임 및 API 브릿지 프록시
```

---

## 2. Pydantic v2 ↔ TypeScript 타입 대응표

| Pydantic 모델 (`backend/app/schemas/`) | TypeScript 인터페이스 (`src/types/`) | 역할 및 설명 |
| :--- | :--- | :--- |
| `DocumentStatus` | `DocumentStatus` | `UPLOADED`, `PARSING`, `PARSED`, `REVIEWING`, `COMPLETED`, `FAILED` |
| `DocumentFormat` | `DocumentFormat` | `hwp` (바이너리 5.0) \| `hwpx` (OWPML XML) |
| `DocumentMetadata` | `DocumentMetadata` | 문서 제목, 작성자, HWP 버전, 압축/암호화 여부, 문단/표 수, 글자 수 |
| `HwpTextRun` | `HwpTextRun` | 인라인 텍스트, 글꼴(한컴바탕 등), 크기(pt), 굵기(Bold), 색상 |
| `HwpParagraph` | `HwpParagraph` | 문단 식별자(`para_1`), 구역 인덱스, 스타일(`제목`/`개요`/`본문`), 정렬 |
| `HwpCell` | `HwpCell` | 표 셀 위치(`row`, `col`), 병합(`row_span`, `col_span`), 헤더 여부, 내용 |
| `HwpTable` | `HwpTable` | 표 식별자(`table_1`), 행/열 수, 셀 배열 |
| `HwpSection` | `HwpSection` | 구역 인덱스, 페이지 수, 문단 및 표 컬렉션 |
| `CliExecutionInfo` | `CliExecutionInfo` | 실행 명령어(`rhwp parse ...`), 종료코드, 소요시간(ms) |
| `HwpParseResult` | `HwpParseResult` | 1차 세로 슬라이스 파싱 완료 전체 페이로드 |
| `ReviewRule`, `Violation` | `ReviewRule`, `Violation` | 후속 AI 검토 파이프라인용 엔터티 정의 |

---

## 3. 첫 번째 세로 슬라이스(Vertical Slice 1) 실행 흐름

1. **사용자 액션**: 프론트엔드(`FileUploadZone`)에서 `.hwp` 파일 드롭 또는 원클릭 샘플 선택.
2. **API 전송**: `POST /api/v1/documents/upload`로 Multipart FormData 전송.
3. **스토리지 저장 및 검증**: `StorageService`가 확장자(.hwp/.hwpx) 및 파일 크기 검증 후 안전하게 저장.
4. **`rhwp` CLI 실행**: `RhwpParserService`가 `rhwp parse <path> --format json` 서브프로세스를 가동하여 HWP OLE 스트림 및 섹션 데이터 추출.
5. **Pydantic 유효성 검증**: CLI 표준출력 JSON을 Pydantic `HwpParseResult` 스키마로 인스턴스화하여 타입 무결성 보증.
6. **클라이언트 렌더링**: Next.js/React 프론트엔드가 결과를 수신하여 5가지 뷰(메타데이터 요약, 계층 문단, 실시간 표, 전문 텍스트, 원본 IR JSON)로 즉시 시각화.
