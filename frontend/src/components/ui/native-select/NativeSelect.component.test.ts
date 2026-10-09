import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { NativeSelect, NativeSelectOption } from ".";

let wrapper: VueWrapper | undefined;
afterEach(() => wrapper?.unmount());
describe("NativeSelect feature model integration", () => {
  it("preserves large string IDs and makes the new filter available to the load handler", async () => {
    const observed: unknown[] = [];
    wrapper = mount(defineComponent({
      components: { NativeSelect, NativeSelectOption },
      setup() { const id = ref(""); return { id, load: () => observed.push(id.value) }; },
      template: `<NativeSelect v-model="id" @update:model-value="load"><NativeSelectOption value="">全部</NativeSelectOption><NativeSelectOption value="9007199254740993">总部</NativeSelectOption></NativeSelect>`
    }));
    await wrapper.get("select").setValue("9007199254740993");
    expect(observed).toEqual(["9007199254740993"]);
  });

  it("preserves numeric pagination values from bound native options", async () => {
    const observed: unknown[] = [];
    wrapper = mount(defineComponent({
      components: { NativeSelect, NativeSelectOption },
      setup() { const pageSize = ref(10); return { pageSize, load: () => observed.push(pageSize.value) }; },
      template: `<NativeSelect v-model.number="pageSize" @update:model-value="load"><NativeSelectOption :value="10">10</NativeSelectOption><NativeSelectOption :value="20">20</NativeSelectOption></NativeSelect>`
    }));
    await wrapper.get("select").setValue("20");
    expect(observed).toEqual([20]);
  });
});
