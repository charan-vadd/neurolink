/**
 * URL Downloader Utility
 * Provides safe URL downloading with content-length validation
 * Prevents empty downloads by validating response headers
 */

import { logger } from "./logger.js";

/**
 * Error thrown when content-length validation fails
 */
export class ContentLengthError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly contentLength: number | null,
  ) {
    super(message);
    this.name = "ContentLengthError";
  }
}

/**
 * Options for downloading from URL
 */
export interface DownloadOptions {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Custom headers to include in the request */
  headers?: Record<string, string>;
  /** Whether to validate content-length header (default: true) */
  validateContentLength?: boolean;
  /** Minimum acceptable content length (default: 1) */
  minContentLength?: number;
}

/**
 * Download result containing the response data and metadata
 */
export interface DownloadResult {
  /** Downloaded data as ArrayBuffer */
  data: ArrayBuffer;
  /** Content type from response headers */
  contentType: string | null;
  /** Content length from response headers */
  contentLength: number;
  /** Response status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
}

/**
 * Downloads content from a URL with content-length validation
 *
 * @param url - The URL to download from
 * @param options - Download options including timeout and headers
 * @returns Promise resolving to the download result
 * @throws ContentLengthError if content-length is 0 or missing when validation is enabled
 * @throws Error for network errors or non-OK responses
 *
 * @example
 * ```typescript
 * const result = await downloadFromUrl('https://example.com/image.png');
 * console.log(`Downloaded ${result.contentLength} bytes`);
 * ```
 */
export async function downloadFromUrl(
  url: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const {
    timeout = 30000,
    headers = {},
    validateContentLength = true,
    minContentLength = 1,
  } = options;

  logger.debug(`[URLDownloader] Starting download from: ${url}`, {
    timeout,
    validateContentLength,
    minContentLength,
  });

  // Setup timeout with AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "NeuroLink/1.0 (+https://github.com/juspay/neurolink)",
        ...headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Check for non-OK responses
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    // Get content-length from headers
    const contentLengthHeader = response.headers.get("content-length");
    const len = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;

    logger.debug(`[URLDownloader] Response received`, {
      status: response.status,
      contentLength: len,
      contentType: response.headers.get("content-type"),
    });

    // IMG-013: Validate content-length to prevent empty downloads
    if (validateContentLength) {
      if (len === null) {
        logger.warn(
          `[URLDownloader] Content-Length header missing for: ${url}`,
        );
        // Allow missing content-length but log a warning
        // Some servers don't send content-length for chunked responses
      } else if (len === 0) {
        // Throw error for 0-length responses
        throw new ContentLengthError(
          `Response has content-length of 0, resulting in empty download`,
          url,
          len,
        );
      } else if (len < minContentLength) {
        throw new ContentLengthError(
          `Response content-length (${len}) is below minimum threshold (${minContentLength})`,
          url,
          len,
        );
      }
    }

    // Download the content
    const data = await response.arrayBuffer();

    // Verify actual content matches content-length
    if (len !== null && data.byteLength !== len) {
      logger.warn(
        `[URLDownloader] Content-length mismatch: header=${len}, actual=${data.byteLength}`,
      );
    }

    // Verify actual content is not empty
    if (validateContentLength && data.byteLength === 0) {
      throw new ContentLengthError(
        `Downloaded content is empty (0 bytes)`,
        url,
        0,
      );
    }

    // Build response headers record
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    logger.debug(`[URLDownloader] Download completed successfully`, {
      url,
      actualSize: data.byteLength,
      contentType: response.headers.get("content-type"),
    });

    return {
      data,
      contentType: response.headers.get("content-type"),
      contentLength: data.byteLength,
      status: response.status,
      headers: responseHeaders,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Download timeout after ${timeout}ms: ${url}`);
    }

    // Re-throw ContentLengthError as-is
    if (error instanceof ContentLengthError) {
      throw error;
    }

    throw error;
  }
}

/**
 * Downloads content from a URL and returns it as a base64 string
 *
 * @param url - The URL to download from
 * @param options - Download options
 * @returns Promise resolving to base64-encoded string
 */
export async function downloadAsBase64(
  url: string,
  options: DownloadOptions = {},
): Promise<{ base64: string; contentType: string | null }> {
  const result = await downloadFromUrl(url, options);

  // Convert ArrayBuffer to base64
  const bytes = new Uint8Array(result.data);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  return {
    base64,
    contentType: result.contentType,
  };
}

/**
 * Validates a URL before downloading
 *
 * @param url - The URL to validate
 * @returns Object with isValid flag and any error message
 */
export function validateUrl(url: string): { isValid: boolean; error?: string } {
  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        isValid: false,
        error: `Unsupported protocol: ${parsed.protocol}`,
      };
    }

    return { isValid: true };
  } catch {
    return {
      isValid: false,
      error: `Invalid URL format: ${url}`,
    };
  }
}
