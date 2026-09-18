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
              commands = rawCap.commands;
            } else if (rawCap.features && Array.isArray(rawCap.features)) {
              commands = rawCap.features;
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
 * Executes rhwp CLI using officially advertised commands.
 * Prioritizes:
 * 1. `rhwp export-structure <file> --json`
 * 2. `rhwp parse <file> --format json`
 * 3. `rhwp export-text <file> --json`
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

  // Determine command based on advertised capabilities
  let args: string[] = [];
  if (cap.commands.includes('export-structure')) {
    args = ['export-structure', filePath, '--json'];
  } else if (cap.commands.includes('parse')) {
    args = ['parse', filePath, '--format', 'json'];
  } else if (cap.commands.includes('export-text')) {
    args = ['export-text', filePath, '--json'];
  } else {
    args = ['export-structure', filePath, '--json'];
  }

  const commandStr = `${cliPath} ${args.join(' ')}`;

  return new Promise<RhwpParseExecutionResult>((resolve) => {
    execFile(cliPath, args, { timeout: 35000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      const cliVersion = cap.version || 'rhwp';

      if (err || !stdout) {
        return resolve({
          success: false,
          error: err?.message || stderr || 'rhwp CLI 실행 실패',
          cliExecutionInfo: {
            command: commandStr,
            exit_code: (err as any)?.code || 1,
            duration_ms: durationMs,
            cli_version: cliVersion,
          },
        });
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        return resolve({
          success: true,
          data: parsed,
          parseQuality: 'HIGH',
          cliExecutionInfo: {
            command: commandStr,
            exit_code: 0,
            duration_ms: durationMs,
            cli_version: cliVersion,
          },
        });
      } catch (jsonErr: any) {
        return resolve({
          success: false,
          error: `rhwp CLI 출력 JSON 파싱 실패: ${jsonErr.message}`,
          cliExecutionInfo: {
            command: commandStr,
            exit_code: 1,
            duration_ms: durationMs,
            cli_version: cliVersion,
          },
        });
      }
    });
  });
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
