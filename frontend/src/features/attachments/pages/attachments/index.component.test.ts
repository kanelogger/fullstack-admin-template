import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn()
}));

vi.mock("@/features/attachments/attachments.service", () => ({
  getAttachments: mocks.list,
  uploadAttachment: mocks.upload,
  downloadAttachment: mocks.download,
  deleteAttachment: mocks.remove
}));
vi.mock("@/stores/modules/permission", () => ({
  usePermissionStoreHook: () => ({
    permissionKeys: new Set(["files.attachments.upload", "files.attachments.read"])
  })
}));

import AttachmentsPage from "./index.vue";

let wrapper: VueWrapper | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  mocks.list.mockReset();
  mocks.upload.mockReset();
});

const emptyPage = { items: [], total: 0, page: 1, pageSize: 10 };

function uploadButton() {
  const button = wrapper!
    .findAll("button")
    .find((candidate) => candidate.text().includes("选择文件并上传"));
  if (!button) throw new Error("upload button not rendered");
  return button;
}

describe("attachment upload control", () => {
  it("clicks the native file input behind the visible upload button", async () => {
    mocks.list.mockResolvedValue(emptyPage);
    wrapper = mount(AttachmentsPage);
    await flushPromises();

    const fileInput = wrapper.get('input[type="file"]');
    const click = vi.spyOn(fileInput.element as HTMLInputElement, "click");

    await uploadButton().trigger("click");

    expect(click).toHaveBeenCalledTimes(1);
  });

  it("uploads the chosen file through the real change handler and clears the input", async () => {
    mocks.list.mockResolvedValue(emptyPage);
    mocks.upload.mockResolvedValue({ id: "1" });
    wrapper = mount(AttachmentsPage);
    await flushPromises();

    await wrapper.get("#attachment-business-module").setValue("  orders  ");
    const fileInput = wrapper.get('input[type="file"]');
    const file = new File(["report"], "report.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput.element, "files", { value: [file], configurable: true });

    await fileInput.trigger("change");
    await flushPromises();

    expect(mocks.upload).toHaveBeenCalledWith(file, {
      businessModule: "orders",
      businessRecordId: null
    });
    expect(wrapper.get('[role="status"]').text()).toBe("已上传 report.pdf");
    expect((fileInput.element as HTMLInputElement).value).toBe("");
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("ignores a change event without a file", async () => {
    mocks.list.mockResolvedValue(emptyPage);
    wrapper = mount(AttachmentsPage);
    await flushPromises();

    const fileInput = wrapper.get('input[type="file"]');
    Object.defineProperty(fileInput.element, "files", { value: [], configurable: true });

    await fileInput.trigger("change");
    await flushPromises();

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
});
