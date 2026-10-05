import { describe, expect, it } from "vitest";
import {
  AttachmentSchema,
  CreateAttachmentMetadataRequestSchema
} from "./attachments.ts";

describe("attachment contracts", () => {
  it("preserves BIGINT identifiers as decimal strings", () => {
    const result = AttachmentSchema.safeParse({
      id: "9007199254740993",
      originalName: "report.pdf",
      storagePath: "910000000000003/00000000-0000-4000-8000-000000000001.pdf",
      mimeType: "application/pdf",
      fileExt: "pdf",
      fileSize: 1024,
      businessModule: "PROJECT",
      businessRecordId: "9007199254740994",
      referenceStatus: 1,
      uploadUserId: "910000000000003",
      uploadedAt: "2026-10-02T10:00:00.000Z"
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("9007199254740993");
      expect(result.data.businessRecordId).toBe("9007199254740994");
    }
  });

  it("keeps unreferenced metadata empty and requires both reference fields", () => {
    expect(CreateAttachmentMetadataRequestSchema.safeParse({
      originalName: "report.pdf",
      mimeType: "application/pdf",
      fileExt: "pdf",
      fileSize: 1024,
      businessModule: null,
      businessRecordId: null
    }).success).toBe(true);

    expect(CreateAttachmentMetadataRequestSchema.safeParse({
      originalName: "report.pdf",
      mimeType: "application/pdf",
      fileExt: "pdf",
      fileSize: 1024,
      businessModule: "PROJECT",
      businessRecordId: "7"
    }).success).toBe(true);

    expect(CreateAttachmentMetadataRequestSchema.safeParse({
      originalName: "report.pdf",
      mimeType: "application/pdf",
      fileExt: "pdf",
      fileSize: 1024,
      businessModule: "PROJECT",
      businessRecordId: null
    }).success).toBe(false);
  });

  it("rejects files above the private bucket limit", () => {
    expect(CreateAttachmentMetadataRequestSchema.safeParse({
      originalName: "large.pdf",
      mimeType: "application/pdf",
      fileExt: "pdf",
      fileSize: 20 * 1024 * 1024 + 1,
      businessModule: null,
      businessRecordId: null
    }).success).toBe(false);
  });

  it("requires a supported and matching extension/MIME pair", () => {
    expect(CreateAttachmentMetadataRequestSchema.safeParse({
      originalName: "report.pdf",
      mimeType: "application/pdf",
      fileExt: "pdf",
      fileSize: 1024,
      businessModule: null,
      businessRecordId: null
    }).success).toBe(true);
    expect(CreateAttachmentMetadataRequestSchema.safeParse({
      originalName: "report.html",
      mimeType: "text/html",
      fileExt: "html",
      fileSize: 1024,
      businessModule: null,
      businessRecordId: null
    }).success).toBe(false);
    expect(CreateAttachmentMetadataRequestSchema.safeParse({
      originalName: "report.pdf",
      mimeType: "image/png",
      fileExt: "pdf",
      fileSize: 1024,
      businessModule: null,
      businessRecordId: null
    }).success).toBe(false);
  });
});
