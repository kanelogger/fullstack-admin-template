import type { Component } from "vue";

export type MultiFrameEntry = [string, Component];

const MAP = new Map<string, Component>();

export const useMultiFrame = () => {
  function setMap(path: string, Comp: Component) {
    MAP.set(path, Comp);
  }

  function getMap(path: string): Component | undefined;
  function getMap(): MultiFrameEntry[];
  function getMap(path?: string): Component | MultiFrameEntry[] | undefined {
    if (path) {
      return MAP.get(path);
    }
    return [...MAP.entries()];
  }

  function delMap(path: string) {
    MAP.delete(path);
  }

  return {
    setMap,
    getMap,
    delMap,
    MAP
  };
};
