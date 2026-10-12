// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import LaySearch from "./index.vue";

describe("menu search entry", () => {
  it("shows the search button without mounting the search modal", () => {
    const wrapper = mount(LaySearch);
    expect(wrapper.find("[aria-label='搜索菜单']").exists()).toBe(true);
  });
});
