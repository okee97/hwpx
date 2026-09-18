# [01_PRODUCT_SPEC] HWP 문서 AI 자동 검토 시스템 제품 명세서 (v1.1)

## 1. 제품 개요 (Product Overview)
본 제품은 공공기관, 지자체, 교육기관 및 기업에서 생산되는 한글(HWP/HWPX) 규격 공문서 및 사업계획서를 자동으로 파싱하고, 규정 준수 및 품질을 점검하는 **AI 기반 HWP 문서 검토 플랫폼**입니다.

### 1.1 핵심 가치
- **비표준 바이너리 포맷(HWP 5.0)의 개방형 IR(Intermediate Representation)화**: Rust 기반 `rhwp` CLI 엔진을 활용하여 OLE2 바이너리 및 XML 스트림을 구조화된 JSON 데이터로 고속 파싱.
- **문서 구조 보존**: 단순 텍스트 추출을 넘어 문단(Paragraph), 스타일(Heading/Body), 폰트(CharShape), 표(Table/Cell/Span) 정보를 온전히 보존.
- **다차원 AI 검토 파이프라인**: 공문서 작성 규칙(대통령령), 개인정보(주민등록번호 등) 비식별화, 행정 맞춤법 및 권장 순화어 감사.

---

## 2. 시스템 아키텍처 (System Architecture)

```
[클라이언트: Next.js / React]
      │ (Multipart HWP Upload / Inspection UI)
      ▼
[API 게이트웨이: FastAPI / Express Proxy]
      │
      ├─► [스토리지 서비스]: 임시 파일 저장 및 유효성 검사 (.hwp, .hwpx)
      │
      ├─► [파싱 서비스]: `rhwp` CLI 엔진 호출 (`rhwp parse <file> --format json`)
      │         │
      │         ▼
      │    [HWP 5.0 OLE/IR 추출] -> [Pydantic v2 스키마 검증 (HwpParseResult)]
      │
      └─► [AI 검토 엔진 (후속 슬라이스)]: Gemini 2.5 API 및 규칙 엔진
```

---

## 3. 개발 단계 및 세로 슬라이스 (Vertical Slices)

### 슬라이스 1: 프로젝트 기반 구축 및 HWP 파싱 세로 슬라이스 (현재 구현)
- **FastAPI 백엔드 구조 수립**: 디렉터리 레이아웃, 설정, 라우터, 스키마, 서비스 계층 분리.
- **Pydantic v2 모델 정의**: `03_DATA_SCHEMA.md`에 정의된 Document, Metadata, Section, Paragraph, Table, Cell, ParseResult 스키마 구현.
- **Next.js / TypeScript 타입 동기화**: 백엔드 Pydantic 모델과 1:1 매칭되는 프론트엔드 타입 시스템 구축.
- **HWP 파싱 파이프라인 (rhwp CLI)**:
  1. HWP 파일 업로드 엔드포인트 (`POST /api/v1/documents/upload`)
  2. 서버 측 `rhwp` CLI 프로세스 호출 및 파싱 실행
  3. JSON IR 구조화 및 Pydantic 스키마 검증
  4. 프론트엔드 검사기(Viewer)를 통한 구조화된 메타데이터, 문단, 표, IR JSON 시각화.

### 슬라이스 2: AI 검토 규칙 엔진 및 결과 피드백 (후속 확장)
- 행정 규정, 개인정보 패턴, 맞춤법/순화어 검사 및 LLM 프롬프트 파이프라인.
- 문서 뷰어 내 문단별 인라인 하이라이트 및 수정 권고안(Diff) 제시.
