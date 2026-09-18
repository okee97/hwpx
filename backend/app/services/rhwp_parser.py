import os
import json
import time
import subprocess
import logging
from datetime import datetime
from typing import Tuple, Dict, Any, Optional

from backend.app.config import settings
from backend.app.schemas.common import DocumentFormat
from backend.app.schemas.document import DocumentMetadata
from backend.app.schemas.hwp import (
    HwpParseResult,
    HwpSection,
    HwpParagraph,
    HwpTextRun,
    HwpTable,
    HwpCell,
    CliExecutionInfo,
)

logger = logging.getLogger(__name__)

class RhwpParserService:
    def __init__(self, cli_path: str = settings.RHWP_CLI_PATH):
        self.cli_path = cli_path

    def parse_document(self, document_id: str, file_path: str) -> HwpParseResult:
        """
        Executes rhwp CLI to parse HWP/HWPX file and validates into HwpParseResult Pydantic schema.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"대상 파일을 찾을 수 없습니다: {file_path}")

        file_name = os.path.basename(file_path)
        file_size = os.path.getsize(file_path)
        ext = os.path.splitext(file_name)[1].lower().replace(".", "")
        doc_format = DocumentFormat.HWPX if ext == "hwpx" else DocumentFormat.HWP

        cmd = [self.cli_path, "parse", file_path, "--format", "json"]
        start_time = time.time()
        
        try:
            process = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=settings.CLI_TIMEOUT_SECONDS,
                check=True
            )
            duration_ms = round((time.time() - start_time) * 1000, 2)
            stdout = process.stdout.strip()
            
            raw_data = json.loads(stdout)
            
            cli_info = CliExecutionInfo(
                command=" ".join(cmd),
                exit_code=process.returncode,
                duration_ms=duration_ms,
                cli_version="rhwp 0.8.2-cli"
            )

            # Map raw JSON to Pydantic models
            meta_dict = raw_data.get("metadata", {})
            metadata = DocumentMetadata(
                title=meta_dict.get("title") or file_name,
                author=meta_dict.get("author"),
                created_date=meta_dict.get("created_date"),
                modified_date=meta_dict.get("modified_date"),
                hwp_version=meta_dict.get("hwp_version", "5.0.3.0"),
                is_compressed=meta_dict.get("is_compressed", False),
                is_encrypted=meta_dict.get("is_encrypted", False),
                page_count=meta_dict.get("page_count", 1),
                paragraph_count=meta_dict.get("paragraph_count", 0),
                table_count=meta_dict.get("table_count", 0),
                character_count=meta_dict.get("character_count", 0),
                word_count=meta_dict.get("word_count", 0),
            )

            sections = []
            for sec_idx, sec in enumerate(raw_data.get("sections", [])):
                paragraphs = []
                for p in sec.get("paragraphs", []):
                    text_runs = [
                        HwpTextRun(**tr) for tr in p.get("text_runs", [])
                    ]
                    paragraphs.append(
                        HwpParagraph(
                            id=p.get("id", f"para_{len(paragraphs)+1}"),
                            section_index=sec_idx,
                            paragraph_index=p.get("paragraph_index", len(paragraphs)),
                            text=p.get("text", ""),
                            style_name=p.get("style_name", "본문"),
                            align=p.get("align", "JUSTIFY"),
                            text_runs=text_runs,
                        )
                    )

                tables = []
                for t in sec.get("tables", []):
                    cells = [HwpCell(**c) for c in t.get("cells", [])]
                    tables.append(
                        HwpTable(
                            id=t.get("id", f"table_{len(tables)+1}"),
                            section_index=sec_idx,
                            row_count=t.get("row_count", 1),
                            col_count=t.get("col_count", 1),
                            cells=cells,
                        )
                    )

                sections.append(
                    HwpSection(
                        index=sec_idx,
                        page_count=sec.get("page_count", 1),
                        paragraphs=paragraphs,
                        tables=tables,
                    )
                )

            return HwpParseResult(
                document_id=document_id,
                version=raw_data.get("version", "0.8.2-cli"),
                file_name=file_name,
                file_size=file_size,
                format=doc_format,
                metadata=metadata,
                sections=sections,
                raw_text=raw_data.get("raw_text", ""),
                ir_json=raw_data.get("ir_json", {}),
                cli_execution_info=cli_info,
                parsed_at=datetime.utcnow()
            )

        except subprocess.CalledProcessError as e:
            logger.error(f"rhwp CLI 실패 (exit code: {e.returncode}): {e.stderr}")
            raise RuntimeError(f"rhwp 파싱 오류: {e.stderr or e.stdout}")
        except json.JSONDecodeError as e:
            logger.error(f"rhwp JSON 디코딩 실패: {e}")
            raise RuntimeError(f"rhwp 출력 형식 오류 (JSON 디코딩 실패): {str(e)}")

parser_service = RhwpParserService()
