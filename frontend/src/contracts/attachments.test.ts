import { describe, expect, it } from "vitest";
import {
  AttachmentSchema,
  CreateAttachmentMetadataRequestSchema
} from "./attachments";

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

  it("preserves optional business module and record ID fields independently", () => {
    expect(CreateAttachmentMetadataRequestSchema.safeParse({
      originalName: "report.pdf",
      mimeType: "application/pdf",
      fileExt: "pdf",
      fileSize: 1024,
      businessModule: "PROJECT",
      businessRecordId: null
    }).success).toBe(true);
  });

  it("rejects files above the private bucket limit", () => {
    expect(CreateAttachmentMetadataRequestSchema.safeParse({
      originalName: "large.bin",
      mimeType: "application/octet-stream",
      fileExt: "bin",
      fileSize: 20 * 1024 * 1024 + 1,
      businessModule: null,
      businessRecordId: null
    }).success).toBe(false);
  });
});
