import {
  DashboardOverviewSchema,
  type DashboardOverview
} from "@/contracts";
import { getSupabaseClient } from "@/shared/supabase/client";

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const { data, error } = await getSupabaseClient().rpc("dashboard_overview");
  if (error) throw new Error("首页数据加载失败或当前账号无读取权限");
  return DashboardOverviewSchema.parse(data);
}
