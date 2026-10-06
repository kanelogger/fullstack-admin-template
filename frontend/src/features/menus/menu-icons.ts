import type { Component } from "vue";
import {
  Activity,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CircleAlert,
  FileText,
  Home,
  KeyRound,
  LockKeyhole,
  Menu,
  MessageSquare,
  MousePointer2,
  Paperclip,
  Settings2,
  SlidersHorizontal,
  UserRound
} from "@lucide/vue";
import { useRenderIcon } from "@/components/ReIcon/src/hooks";

const legacyElementIcons: Record<string, Component> = {
  HomeFilled: Home,
  SetUp: Settings2,
  UserFilled: UserRound,
  Menu,
  OfficeBuilding: Building2,
  Postcard: BriefcaseBusiness,
  Tools: SlidersHorizontal,
  Collection: BookOpen,
  Operation: Activity,
  Message: MessageSquare,
  Paperclip,
  Document: FileText,
  Key: KeyRound,
  Pointer: MousePointer2,
  WarningFilled: CircleAlert,
  User: UserRound,
  Lock: LockKeyhole
};

/** Resolve persisted menu icon aliases to bundled Lucide icons. */
export function resolveMenuIcon(iconName: string | Component | null | undefined): Component | undefined {
  if (!iconName) return undefined;
  if (typeof iconName !== "string") return iconName;
  return legacyElementIcons[iconName] ?? useRenderIcon(iconName);
}
