#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rhwp CLI Compatibility Shim
Implements upstream rhwp CLI command specifications:
- rhwp --version
- rhwp capabilities --json
- rhwp parse <file> --format json
- rhwp info <file> --json
- rhwp export-text <file> --json
- rhwp export-tables <file> --json
- rhwp export-structure <file> --json
"""

import sys
import os
import json

# Add current directory / scripts directory to path
script_dir = os.path.dirname(os.path.abspath(__file__))
if script_dir not in sys.path:
    sys.path.insert(0, script_dir)

try:
    from hwp_extractor import parse_hwpx, parse_hwp5, clean_text
except ImportError:
    # If imported from another location
    sys.path.insert(0, os.path.join(os.getcwd(), 'scripts'))
    from hwp_extractor import parse_hwpx, parse_hwp5, clean_text

def get_parsed_doc(file_path):
    if not os.path.exists(file_path):
        return None
    base_name = os.path.basename(file_path).lower()
    res = None
    if base_name.endswith('.hwpx'):
        res = parse_hwpx(file_path)
    if not res or not res.get("raw_text"):
        res = parse_hwp5(file_path)
    return res

def main():
    args = sys.argv[1:]
    if not args:
        print("rhwp 1.2.0 (compatible)")
        sys.exit(0)

    cmd = args[0]

    # 1. Version check: --version, -V, version
    if cmd in ('--version', '-v', '-V', 'version'):
        print("rhwp 1.2.0 (compatible)")
        sys.exit(0)

    # 2. Capabilities check: capabilities --json
    if cmd == 'capabilities':
        cap_data = {
            "version": "1.2.0",
            "installed": True,
            "commands": ["parse", "info", "export-text", "export-tables", "export-structure"],
            "features": ["text_extraction", "table_matrix", "structure_outline", "metadata"]
        }
        print(json.dumps(cap_data, ensure_ascii=False))
        sys.exit(0)

    # Subcommands taking a file path
    # parse <file> [--format json]
    if cmd == 'parse':
        if len(args) < 2:
            print(json.dumps({"error": "Missing file path argument"}))
            sys.exit(1)
        file_path = args[1]
        doc = get_parsed_doc(file_path)
        if not doc:
            doc = {
                "parse_status": "FAILED",
                "parse_quality": "NONE",
                "error": f"파일({os.path.basename(file_path)})을 열 수 없거나 파싱할 수 없습니다.",
                "raw_text": "",
                "sections": []
            }
        print(json.dumps(doc, ensure_ascii=False))
        sys.exit(0)

    # info <file> [--json]
    if cmd == 'info':
        if len(args) < 2:
            print(json.dumps({"error": "Missing file path argument"}))
            sys.exit(1)
        file_path = args[1]
        doc = get_parsed_doc(file_path)
        meta = doc.get("metadata", {}) if doc else {}
        print(json.dumps(meta, ensure_ascii=False))
        sys.exit(0)

    # export-text <file> [--json]
    if cmd == 'export-text':
        if len(args) < 2:
            print(json.dumps({"error": "Missing file path argument"}))
            sys.exit(1)
        file_path = args[1]
        doc = get_parsed_doc(file_path)
        if doc and doc.get("raw_text"):
            res = {
                "raw_text": doc["raw_text"],
                "pages": [{"page": 1, "text": doc["raw_text"]}]
            }
        else:
            res = {"raw_text": "", "pages": []}
        print(json.dumps(res, ensure_ascii=False))
        sys.exit(0)

    # export-tables <file> [--json]
    if cmd == 'export-tables':
        if len(args) < 2:
            print(json.dumps({"error": "Missing file path argument"}))
            sys.exit(1)
        file_path = args[1]
        doc = get_parsed_doc(file_path)
        tables = []
        if doc and "sections" in doc:
            for s in doc["sections"]:
                for t in s.get("tables", []):
                    tables.append(t)
        print(json.dumps({"tables": tables}, ensure_ascii=False))
        sys.exit(0)

    # export-structure <file> [--json]
    if cmd == 'export-structure':
        if len(args) < 2:
            print(json.dumps({"error": "Missing file path argument"}))
            sys.exit(1)
        file_path = args[1]
        doc = get_parsed_doc(file_path)
        outline = []
        if doc and "sections" in doc:
            for s in doc["sections"]:
                for p in s.get("paragraphs", []):
                    txt = p.get("text", "")
                    if any(txt.startswith(prefix) for prefix in ['제1장', '제2장', '제3장', '제4장', '제5장', 'Ⅰ.', 'Ⅱ.', 'Ⅲ.', 'Ⅳ.', 'Ⅴ.', '1.', '2.', '3.', '4.', '5.']):
                        outline.append({
                            "title": txt,
                            "section_index": s.get("index", 0),
                            "paragraph_id": p.get("id")
                        })
        print(json.dumps({"outline": outline}, ensure_ascii=False))
        sys.exit(0)

    # Unknown command, default to parsing if argument is a file
    if os.path.exists(cmd):
        doc = get_parsed_doc(cmd)
        print(json.dumps(doc or {}, ensure_ascii=False))
        sys.exit(0)

    print(json.dumps({"error": f"Unknown command: {cmd}"}))
    sys.exit(1)

if __name__ == "__main__":
    main()
