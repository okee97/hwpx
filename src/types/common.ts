/**
 * 공통 타입 정의 (03_DATA_SCHEMA.md 규격)
 */

export type DocumentStatus =
  | 'UPLOADED'
  | 'PARSING'
  | 'PARSED'
  | 'REVIEWING'
  | 'COMPLETED'
  | 'FAILED';

export type DocumentFormat = 'hwp' | 'hwpx';

export type SeverityLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL' | 'WARNING' | 'INFO';

export type TextAlignment = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFY';

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}
