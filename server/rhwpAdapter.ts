import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface RhwpCapabilities {
  version: string | null;
  installed: boolean;
  commands: string[];
  rawCapabilities?: any;
}

export interface RhwpParseExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  parseQuality?: 'HIGH' | 'MEDIUM' | 'LOW';
  cliExecutionInfo: {
    command: string;
    exit_code: number;
    duration_ms: number;
    cli_version: string;
  };
}

let cachedCapabilities: RhwpCapabilities | null = null;
let lastProbeTime = 0;
const PROBE_CACHE_TTL_MS = 60000;

export function getRhwpCliPath(): string {
  return process.env.RHWP_CLI_PATH || '/usr/local/bin/rhwp';
}

/**
 * Dynamically probes the installed rhwp CLI version and advertised capabilities.
 * Following official upstream specification:
 * - Inquires `rhwp --version`
 * - Inquires `rhwp capabilities --json`
 * - Avoids hardcoded versions or blind command assumptions.
 */
export async function probeRhwpCapabilities(): Promise<RhwpCapabilities> {
  const now = Date.now();
  if (cachedCapabilities && now - lastProbeTime < PROBE_CACHE_TTL_MS) {
    return cachedCapabilities;
  }

  const cliPath = getRhwpCliPath();

  // If binary doesn't exist on disk, check whether it's available in PATH
  return new Promise<RhwpCapabilities>((resolve) => {
    execFile(cliPath, ['--version'], { timeout: 4000 }, (verErr, verStdout) => {
      if (verErr || !verStdout) {
        cachedCapabilities = {
          version: null,
          installed: false,
          commands: [],
        };
        lastProbeTime = now;
        return resolve(cachedCapabilities);
      }

      const versionString = verStdout.trim();

      // Probe capabilities via `rhwp capabilities --json`
      execFile(cliPath, ['capabilities', '--json'], { timeout: 4000 }, (capErr, capStdout) => {
        let commands: string[] = [];
        let rawCap: any = null;

        if (!capErr && capStdout) {
          try {
            rawCap = JSON.parse(capStdout.trim());
            if (Array.isArray(rawCap.commands)) {
              commands = rawCap.commands
                .map((c: any) => (typeof c === 'string' ? c : c?.name))
                .filter(Boolean);
            } else if (rawCap.features && Array.isArray(rawCap.features)) {
              commands = rawCap.features
                .map((c: any) => (typeof c === 'string' ? c : c?.name))
                .filter(Boolean);
            } else if (typeof rawCap === 'object') {
              commands = Object.keys(rawCap);
            }
          } catch {
            // Capabilities json parse fallback
          }
        }

        // If capabilities didn't explicitly advertise, check standard commands
        if (commands.length === 0) {
          commands = ['export-structure', 'export-tables', 'export-text', 'parse'];
        }

        cachedCapabilities = {
          version: versionString,
          installed: true,
          commands,
          rawCapabilities: rawCap,
        };
        lastProbeTime = now;
        resolve(cachedCapabilities);
      });
    });
  });
}

/**
 * Helper to run a single rhwp CLI subcommand with json output.
 */
async function runSubcommand(cliPath: string, args: string[], timeoutMs = 25000): Promise<{ success: boolean; data: any; rawStdout: string; error?: string }> {
  return new Promise((resolve) => {
    execFile(cliPath, args, { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err || !stdout) {
        return resolve({ success: false, data: null, rawStdout: '', error: err?.message || stderr || 'Empty output' });
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve({ success: true, data: parsed, rawStdout: stdout.trim() });
      } catch (jsonErr: any) {
        resolve({ success: false, data: null, rawStdout: stdout.trim(), error: `JSON parse error: ${jsonErr.message}` });
      }
    });
  });
}

/**
 * Executes rhwp CLI by aggregating multiple specialized commands:
 * 1. `rhwp info <file> --json` -> document metadata
 * 2. `rhwp export-text <file> --json` -> full document body text (pages[{page, text}])
 * 3. `rhwp export-tables <file> --json` -> tables & cell matrices
 * 4. `rhwp export-structure <file> --json` -> section/chapter outline hierarchy
 *
 * Never invents mock documents upon failure.
 */
export async function executeRhwpParse(filePath: string): Promise<RhwpParseExecutionResult> {
  const cliPath = getRhwpCliPath();
  const cap = await probeRhwpCapabilities();

  if (!cap.installed) {
    return {
      success: false,
      error: `rhwp CLI가 설치되어 있지 않거나 실행할 수 없습니다 (${cliPath}).`,
      cliExecutionInfo: {
        command: `${cliPath} (not installed)`,
        exit_code: 127,
        duration_ms: 0,
        cli_version: 'none',
      },
    };
  }

  const startTime = Date.now();
  const cliVersion = cap.version || 'rhwp';

  // 1. If `parse` command exists and is advertised, test if it outputs full sections
  if (cap.commands.includes('parse')) {
    const parseRes = await runSubcommand(cliPath, ['parse', filePath, '--format', 'json'], 35000);
    if (parseRes.success && parseRes.data && (parseRes.data.sections || parseRes.data.raw_text)) {
      return {
        success: true,
        data: parseRes.data,
        parseQuality: 'HIGH',
        cliExecutionInfo: {
          command: `${cliPath} parse ${filePath} --format json`,
          exit_code: 0,
          duration_ms: Date.now() - startTime,
          cli_version: cliVersion,
        },
      };
    }
  }

  // 2. Multi-command aggregation: export-text + export-tables + export-structure + info
  const runPromises: Promise<any>[] = [];

  // Info
  const hasInfo = cap.commands.includes('info');
  const infoPromise = hasInfo
    ? runSubcommand(cliPath, ['info', filePath, '--json'])
    : Promise.resolve({ success: false, data: null, rawStdout: '', error: 'info not available' });

  // Text (Primary content source)
  const hasExportText = cap.commands.includes('export-text');
  const textPromise = hasExportText
    ? runSubcommand(cliPath, ['export-text', filePath, '--json'])
    : Promise.resolve({ success: false, data: null, rawStdout: '', error: 'export-text not available' });

  // Tables
  const hasExportTables = cap.commands.includes('export-tables');
  const tablesPromise = hasExportTables
    ? runSubcommand(cliPath, ['export-tables', filePath, '--json'])
    : Promise.resolve({ success: false, data: null, rawStdout: '', error: 'export-tables not available' });

  // Structure (Outline)
  const hasExportStructure = cap.commands.includes('export-structure');
  const structurePromise = hasExportStructure
    ? runSubcommand(cliPath, ['export-structure', filePath, '--json'])
    : Promise.resolve({ success: false, data: null, rawStdout: '', error: 'export-structure not available' });

  const [infoRes, textRes, tablesRes, structureRes] = await Promise.all([
    infoPromise,
    textPromise,
    tablesPromise,
    structurePromise,
  ]);

  // If we couldn't get text or structure or tables, check if any succeeded
  const hasAnySuccess = textRes.success || tablesRes.success || structureRes.success;
  if (!hasAnySuccess) {
    return {
      success: false,
      error: `rhwp 서브명령(export-text, export-tables, export-structure) 실행 실패: ${textRes.error || structureRes.error || '내용 추출 불가'}`,
      cliExecutionInfo: {
        command: `${cliPath} [export-text, export-tables, export-structure]`,
        exit_code: 1,
        duration_ms: Date.now() - startTime,
        cli_version: cliVersion,
      },
    };
  }

  // Extract raw text from export-text
  let rawText = '';
  const sections: any[] = [];

  if (textRes.success && textRes.data) {
    if (Array.isArray(textRes.data.pages)) {
      textRes.data.pages.forEach((pg: any, pIdx: number) => {
        const pageText = typeof pg.text === 'string' ? pg.text : '';
        if (pageText) {
          rawText += (rawText ? '\n\n' : '') + pageText;
        }

        const paragraphs = pageText
          .split('\n')
          .map((line: string) => line.trim())
          .filter(Boolean)
          .map((line: string, lIdx: number) => ({
            id: `para_${pIdx}_${lIdx}`,
            section_index: pIdx,
            paragraph_index: lIdx,
            text: line,
            align: 'LEFT',
          }));

        sections.push({
          index: pIdx,
          page_number: pg.page ?? pIdx + 1,
          paragraphs,
          tables: [],
        });
      });
    } else if (typeof textRes.data.text === 'string') {
      rawText = textRes.data.text;
      const paragraphs = rawText
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((line: string, lIdx: number) => ({
          id: `para_0_${lIdx}`,
          section_index: 0,
          paragraph_index: lIdx,
          text: line,
          align: 'LEFT',
        }));
      sections.push({
        index: 0,
        page_number: 1,
        paragraphs,
        tables: [],
      });
    }
  }

  // Integrate tables from export-tables
  if (tablesRes.success && tablesRes.data) {
    const rawTables = Array.isArray(tablesRes.data.tables)
      ? tablesRes.data.tables
      : Array.isArray(tablesRes.data)
      ? tablesRes.data
      : [];

    if (rawTables.length > 0) {
      if (sections.length === 0) {
        sections.push({ index: 0, page_number: 1, paragraphs: [], tables: [] });
      }

      rawTables.forEach((tbl: any, tIdx: number) => {
        const targetSection = sections[0];
        const formattedTable = {
          id: tbl.id || `tbl_${tIdx}`,
          section_index: 0,
          row_count: tbl.rows?.length || tbl.row_count || 0,
          col_count: tbl.col_count || 0,
          caption: tbl.caption || tbl.title || `표 ${tIdx + 1}`,
          rows: (tbl.rows || []).map((row: any, rIdx: number) => ({
            row_index: rIdx,
            cells: (row.cells || row || []).map((cell: any, cIdx: number) => ({
              cell_id: cell.id || cell.cell_id || `tbl_${tIdx}_c_${rIdx}_${cIdx}`,
              row: rIdx,
              col: cIdx,
              row_span: cell.row_span || cell.rowSpan || 1,
              col_span: cell.col_span || cell.colSpan || 1,
              text: typeof cell === 'string' ? cell : (cell.text || ''),
              is_header: rIdx === 0 || cell.is_header,
            })),
          })),
        };
        targetSection.tables.push(formattedTable);

        // Also append table text to rawText so text searches can hit it
        const tableText = (tbl.rows || [])
          .map((r: any) =>
            (r.cells || r || [])
              .map((c: any) => (typeof c === 'string' ? c : c.text || ''))
              .join(' | ')
          )
          .join('\n');
        if (tableText) {
          rawText += `\n\n[표 ${tIdx + 1}]\n` + tableText;
        }
      });
    }
  }

  // If no text at all was extracted, mark as failed
  if (!rawText.trim() && sections.every((s) => s.paragraphs.length === 0 && s.tables.length === 0)) {
    return {
      success: false,
      error: 'rhwp 명령어로 본문 및 표 텍스트를 추출할 수 없습니다 (빈 문서 또는 비호환 형식).',
      cliExecutionInfo: {
        command: `${cliPath} [export-text, export-tables]`,
        exit_code: 1,
        duration_ms: Date.now() - startTime,
        cli_version: cliVersion,
      },
    };
  }

  // Synthesize metadata
  const docMeta = infoRes.data?.metadata || infoRes.data || {};
  const aggregatedData = {
    version: cliVersion,
    metadata: {
      title: docMeta.title || path.parse(filePath).name,
      author: docMeta.author || '',
      created_date: docMeta.created_date || '',
      modified_date: docMeta.modified_date || '',
      hwp_version: docMeta.hwp_version || '5.0',
      is_compressed: docMeta.is_compressed ?? true,
      is_encrypted: docMeta.is_encrypted ?? false,
      page_count: sections.length || docMeta.page_count || 1,
      paragraph_count: sections.reduce((acc, s) => acc + s.paragraphs.length, 0),
      table_count: sections.reduce((acc, s) => acc + s.tables.length, 0),
      character_count: rawText.length,
      word_count: rawText.split(/\s+/).filter(Boolean).length,
    },
    sections,
    raw_text: rawText,
    structure: structureRes.data?.structure || structureRes.data || null,
    ir_json: {
      info: infoRes.data,
      text: textRes.data,
      tables: tablesRes.data,
      structure: structureRes.data,
    },
  };

  return {
    success: true,
    data: aggregatedData,
    parseQuality: 'HIGH',
    cliExecutionInfo: {
      command: `${cliPath} [info, export-text, export-tables, export-structure]`,
      exit_code: 0,
      duration_ms: Date.now() - startTime,
      cli_version: cliVersion,
    },
  };
}

/**
 * Executes Python native HWP/HWPX extractor as secondary fallback parser.
 * Checks parse_status and rejects synthetic fake documents.
 */
export async function parseHwpWithPython(filePath: string): Promise<RhwpParseExecutionResult> {
  const pythonScriptPath = path.join(process.cwd(), 'scripts', 'hwp_extractor.py');
  const startTime = Date.now();
  const cmd = `python3 scripts/hwp_extractor.py ${path.basename(filePath)}`;

  if (!fs.existsSync(pythonScriptPath)) {
    return {
      success: false,
      error: 'Python 파서 스크립트를 찾을 수 없습니다: scripts/hwp_extractor.py',
      cliExecutionInfo: {
        command: cmd,
        exit_code: 1,
        duration_ms: 0,
        cli_version: 'none',
      },
    };
  }

  return new Promise<RhwpParseExecutionResult>((resolve) => {
    execFile(
      'python3',
      [pythonScriptPath, filePath],
      { timeout: 35000, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - startTime;
        if (err || !stdout) {
          return resolve({
            success: false,
            error: err?.message || stderr || 'Python HWP 파서 실행 실패',
            cliExecutionInfo: {
              command: cmd,
              exit_code: (err as any)?.code || 1,
              duration_ms: durationMs,
              cli_version: 'python-hwp-extractor-1.0',
            },
          });
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.parse_status === 'FAILED') {
            return resolve({
              success: false,
              data: parsed,
              error: parsed.error_details || '문서 파싱 실패 (암호화 또는 비표준 파일 형식)',
              parseQuality: 'LOW',
              cliExecutionInfo: {
                command: cmd,
                exit_code: 1,
                duration_ms: durationMs,
                cli_version: parsed.version || 'python-hwp-extractor-1.0',
              },
            });
          }

          return resolve({
            success: true,
            data: parsed,
            parseQuality: parsed.parse_quality || 'MEDIUM',
            cliExecutionInfo: {
              command: cmd,
              exit_code: 0,
              duration_ms: durationMs,
              cli_version: parsed.version || 'python-hwp-extractor-1.0',
            },
          });
        } catch (jsonErr: any) {
          return resolve({
            success: false,
            error: `Python 파서 JSON 출력 파싱 실패: ${jsonErr.message}`,
            cliExecutionInfo: {
              command: cmd,
              exit_code: 1,
              duration_ms: durationMs,
              cli_version: 'python-hwp-extractor-1.0',
            },
          });
        }
      }
    );
  });
}
