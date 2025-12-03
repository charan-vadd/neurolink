/**
 * URL Downloader Tests
 * Tests for content-length validation and URL downloading functionality
 * Addresses IMG-013: Missing Content-Length Validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  downloadFromUrl,
  downloadAsBase64,
  validateUrl,
  ContentLengthError,
} from "../../src/lib/utils/urlDownloader.js";

// Mock fetch for testing
const mockFetch = vi.fn();

describe("URL Downloader", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Content-Length Validation (IMG-013)", () => {
    it("should throw ContentLengthError when content-length is 0", async () => {
      // Mock response with content-length: 0
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "content-length": "0",
          "content-type": "text/plain",
        }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Expect error to be thrown for 0-length response
      await expect(
        downloadFromUrl("https://example.com/empty.txt"),
      ).rejects.toThrow(ContentLengthError);

      await expect(
        downloadFromUrl("https://example.com/empty.txt"),
      ).rejects.toThrow("content-length of 0");
    });

    it("should throw ContentLengthError when actual content is empty", async () => {
      // Mock response without content-length header but empty body
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "content-type": "text/plain",
        }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(
        downloadFromUrl("https://example.com/empty.txt"),
      ).rejects.toThrow(ContentLengthError);

      await expect(
        downloadFromUrl("https://example.com/empty.txt"),
      ).rejects.toThrow("Downloaded content is empty");
    });

    it("should throw ContentLengthError when content-length is below minimum threshold", async () => {
      // Mock response with small content-length
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "content-length": "5",
          "content-type": "text/plain",
        }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(5)),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(
        downloadFromUrl("https://example.com/small.txt", {
          minContentLength: 10,
        }),
      ).rejects.toThrow(ContentLengthError);
    });

    it("should succeed when content-length is greater than 0", async () => {
      // Mock response with valid content-length
      const testData = new TextEncoder().encode("Hello World");
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "content-length": testData.length.toString(),
          "content-type": "text/plain",
        }),
        arrayBuffer: vi.fn().mockResolvedValue(testData.buffer),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await downloadFromUrl("https://example.com/valid.txt");

      expect(result.contentLength).toBe(testData.length);
      expect(result.status).toBe(200);
      expect(result.contentType).toBe("text/plain");
    });

    it("should skip content-length validation when validateContentLength is false", async () => {
      // Mock response with content-length: 0
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "content-length": "0",
          "content-type": "text/plain",
        }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Should not throw when validation is disabled
      const result = await downloadFromUrl("https://example.com/empty.txt", {
        validateContentLength: false,
      });

      expect(result.contentLength).toBe(0);
    });

    it("should include URL and content-length in ContentLengthError", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "content-length": "0",
          "content-type": "text/plain",
        }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      };
      mockFetch.mockResolvedValue(mockResponse);

      try {
        await downloadFromUrl("https://example.com/empty.txt");
        expect.fail("Should have thrown ContentLengthError");
      } catch (error) {
        expect(error).toBeInstanceOf(ContentLengthError);
        const contentLengthError = error as ContentLengthError;
        expect(contentLengthError.url).toBe("https://example.com/empty.txt");
        expect(contentLengthError.contentLength).toBe(0);
      }
    });
  });

  describe("HTTP Error Handling", () => {
    it("should throw error for non-OK responses", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Headers({}),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(
        downloadFromUrl("https://example.com/notfound.txt"),
      ).rejects.toThrow("HTTP error: 404 Not Found");
    });

    it("should throw error for 500 server errors", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers({}),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(
        downloadFromUrl("https://example.com/error.txt"),
      ).rejects.toThrow("HTTP error: 500");
    });
  });

  describe("Timeout Handling", () => {
    it("should throw timeout error when request times out", async () => {
      // Mock fetch that simulates abort when signal is aborted
      mockFetch.mockImplementation((_url: string, options?: RequestInit) => {
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(resolve, 100000);

          // Handle abort signal
          if (options?.signal) {
            options.signal.addEventListener("abort", () => {
              clearTimeout(timeoutId);
              const error = new Error("The operation was aborted");
              error.name = "AbortError";
              reject(error);
            });
          }
        });
      });

      await expect(
        downloadFromUrl("https://example.com/slow.txt", { timeout: 50 }),
      ).rejects.toThrow("timeout");
    }, 5000); // 5 second timeout for the test itself
  });

  describe("downloadAsBase64", () => {
    it("should return base64-encoded content", async () => {
      const testData = new TextEncoder().encode("Hello World");
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "content-length": testData.length.toString(),
          "content-type": "text/plain",
        }),
        arrayBuffer: vi.fn().mockResolvedValue(testData.buffer),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await downloadAsBase64("https://example.com/valid.txt");

      expect(result.base64).toBeTruthy();
      expect(result.contentType).toBe("text/plain");

      // Verify base64 decodes correctly
      const decoded = atob(result.base64);
      expect(decoded).toBe("Hello World");
    });

    it("should throw ContentLengthError for empty content", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "content-length": "0",
          "content-type": "text/plain",
        }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(
        downloadAsBase64("https://example.com/empty.txt"),
      ).rejects.toThrow(ContentLengthError);
    });
  });

  describe("validateUrl", () => {
    it("should accept valid HTTP URLs", () => {
      const result = validateUrl("http://example.com/file.txt");
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should accept valid HTTPS URLs", () => {
      const result = validateUrl("https://example.com/file.txt");
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should reject FTP URLs", () => {
      const result = validateUrl("ftp://example.com/file.txt");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Unsupported protocol");
    });

    it("should reject file URLs", () => {
      const result = validateUrl("file:///etc/passwd");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Unsupported protocol");
    });

    it("should reject invalid URL format", () => {
      const result = validateUrl("not-a-valid-url");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Invalid URL format");
    });
  });

  describe("Custom Headers", () => {
    it("should include custom headers in request", async () => {
      const testData = new TextEncoder().encode("test");
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "content-length": testData.length.toString(),
          "content-type": "text/plain",
        }),
        arrayBuffer: vi.fn().mockResolvedValue(testData.buffer),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await downloadFromUrl("https://example.com/test.txt", {
        headers: {
          Authorization: "Bearer token123",
          "X-Custom-Header": "custom-value",
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/test.txt",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer token123",
            "X-Custom-Header": "custom-value",
          }),
        }),
      );
    });
  });
});
