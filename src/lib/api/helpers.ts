/**
 * API Response Helpers
 *
 * Standardized response formatting and error handling for API routes.
 * Reduces duplication across the 20+ API routes.
 */

import { NextResponse } from 'next/server';

/**
 * Standard API response format
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  count?: number;
}

/**
 * Options for success responses
 */
export interface SuccessOptions {
  count?: number;
  status?: number;
}

/**
 * Create a successful JSON response
 */
export function successResponse<T>(
  data: T,
  options: SuccessOptions = {}
): NextResponse<ApiResponse<T>> {
  const { count, status = 200 } = options;

  const body: ApiResponse<T> = {
    success: true,
    data,
  };

  if (count !== undefined) {
    body.count = count;
  }

  return NextResponse.json(body, { status });
}

/**
 * Create an error JSON response
 */
export function errorResponse(
  error: unknown,
  options: { status?: number; prefix?: string } = {}
): NextResponse<ApiResponse> {
  const { status = 500, prefix } = options;

  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'An unexpected error occurred';

  const fullMessage = prefix ? `${prefix}: ${message}` : message;

  return NextResponse.json(
    {
      success: false,
      error: fullMessage,
    },
    { status }
  );
}

/**
 * Create a 400 Bad Request response
 */
export function badRequest(message: string): NextResponse<ApiResponse> {
  return errorResponse(message, { status: 400 });
}

/**
 * Create a 404 Not Found response
 */
export function notFound(message: string = 'Resource not found'): NextResponse<ApiResponse> {
  return errorResponse(message, { status: 404 });
}

/**
 * Wrap an API handler with standardized error handling
 *
 * @example
 * export const GET = withErrorHandler(
 *   async (request) => {
 *     const data = await fetchData();
 *     return successResponse(data);
 *   },
 *   '[API] GET /api/example'
 * );
 */
export function withErrorHandler<T extends unknown[]>(
  handler: (...args: T) => Promise<NextResponse>,
  logPrefix?: string
): (...args: T) => Promise<NextResponse> {
  return async (...args: T): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (logPrefix) {
        console.error(`${logPrefix} error:`, error);
      }
      return errorResponse(error);
    }
  };
}

/**
 * Parse JSON string arrays (common pattern in API routes)
 */
export function parseJsonArray<T>(value: T[] | string | undefined): T[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
