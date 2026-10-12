import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";
import { computed, onMounted, reactive, ref } from "vue";
import type { ExceptionLog, LoginLog, OperationLog } from "@template/contracts";
import {
  getExceptionLog,
  getExceptionLogs,
  getLoginLog,
  getLoginLogs,
  getOperationLog,
  getOperationLogs
} from "./audit-logs.service";

export type AuditKind = "login" | "operation" | "exception";
export type AuditRow = LoginLog | OperationLog | ExceptionLog;
export type DetailField = { label: string; value: string; pre?: boolean };

export function useAuditLogPage(props: { kind: AuditKind }) {
  const PAGE_SIZE = 10;
  const loading = ref(false);
  const detailLoading = ref(false);
  const loadError = ref("");
  const actionError = ref("");
  const rows = ref<AuditRow[]>([]);
  const selected = ref<AuditRow | null>(null);
  let detailRequest = 0;
  const { capture: captureDetailFocus, restore: restoreDetailFocus } = useDialogReturnFocus();
  const total = ref(0);
  const page = ref(1);
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
  const resultFilter = computed({
    get: () => (props.kind === "login" ? query.loginResult : query.operationResult),
    set: (value: string) => {
      if (props.kind === "login") query.loginResult = value;
      else query.operationResult = value;
    }
  });
  const query = reactive({
    loginName: "",
    loginResult: "",
    operatorName: "",
    moduleCode: "",
    operationType: "",
    operationResult: "",
    requestPath: "",
    errorType: "",
    handledStatus: "",
    startAt: "",
    endAt: ""
  });

  const title = computed(
    () =>
      ({
        login: "登录日志",
        operation: "操作日志",
        exception: "异常日志"
      })[props.kind]
  );
  const description = computed(
    () =>
      ({
        login: "记录账号密码登录成功与失败的尝试。",
        operation: "记录已迁移模块通过权限校验后的数据变更。",
        exception: "记录服务端处理失败的安全摘要。"
      })[props.kind]
  );
  const columns = computed(
    () =>
      ({
        login: ["登录名", "IP", "结果", "失败原因", "登录时间", ""],
        operation: ["操作人", "模块", "类型", "请求", "结果", "操作时间", ""],
        exception: ["路径", "方法", "异常类型", "异常信息", "状态", "发生时间", ""]
      })[props.kind]
  );

  function formatTime(value: string | null | undefined): string {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function jsonText(value: unknown): string {
    if (value === null || value === undefined) return "—";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "[无法显示]";
    }
  }

  function cells(row: AuditRow): string[] {
    if (props.kind === "login" && "loginName" in row) {
      return [
        row.loginName,
        row.loginIp ?? "—",
        row.loginResult === 1 ? "成功" : "失败",
        row.failureReason ?? "—",
        formatTime(row.loggedAt)
      ];
    }
    if (props.kind === "operation" && "moduleCode" in row) {
      return [
        row.operatorName ?? "—",
        row.moduleCode,
        row.operationType,
        `${row.requestMethod} ${row.requestPath}`,
        row.operationResult === 1 ? "成功" : "失败",
        formatTime(row.operatedAt)
      ];
    }
    if (props.kind === "exception" && "errorType" in row) {
      return [
        row.requestPath,
        row.requestMethod,
        row.errorType,
        row.errorMessage,
        row.handledStatus === 1 ? "已处理" : "未处理",
        formatTime(row.occurredAt)
      ];
    }
    return [];
  }

  function detailFields(row: AuditRow): DetailField[] {
    if (props.kind === "login" && "loginName" in row) {
      return [
        { label: "登录名", value: row.loginName },
        { label: "IP", value: row.loginIp ?? "—" },
        { label: "结果", value: row.loginResult === 1 ? "成功" : "失败" },
        { label: "失败原因", value: row.failureReason ?? "—" },
        { label: "User Agent", value: row.userAgent ?? "—" },
        { label: "登录时间", value: formatTime(row.loggedAt) }
      ];
    }
    if (props.kind === "operation" && "moduleCode" in row) {
      return [
        { label: "操作人", value: row.operatorName ?? "—" },
        { label: "模块", value: row.moduleCode },
        { label: "类型", value: row.operationType },
        { label: "请求", value: `${row.requestMethod} ${row.requestPath}` },
        { label: "结果", value: row.operationResult === 1 ? "成功" : "失败" },
        { label: "请求参数", value: jsonText(row.requestParams), pre: true },
        { label: "错误信息", value: row.errorMessage ?? "—" },
        { label: "操作时间", value: formatTime(row.operatedAt) }
      ];
    }
    if (props.kind === "exception" && "errorType" in row) {
      return [
        { label: "请求", value: `${row.requestMethod} ${row.requestPath}` },
        { label: "异常类型", value: row.errorType },
        { label: "异常信息", value: row.errorMessage },
        { label: "处理状态", value: row.handledStatus === 1 ? "已处理" : "未处理" },
        { label: "堆栈摘要", value: row.stackSummary ?? "—", pre: true },
        { label: "发生时间", value: formatTime(row.occurredAt) }
      ];
    }
    return [];
  }

  async function loadRows() {
    loading.value = true;
    loadError.value = "";
    actionError.value = "";
    try {
      const dates = {
        startAt: query.startAt || undefined,
        endAt: query.endAt || undefined,
        page: page.value,
        pageSize: PAGE_SIZE
      };
      const result =
        props.kind === "login"
          ? await getLoginLogs({
              ...dates,
              loginName: query.loginName.trim() || undefined,
              loginResult: query.loginResult === "" ? undefined : Number(query.loginResult)
            })
          : props.kind === "operation"
            ? await getOperationLogs({
                ...dates,
                operatorName: query.operatorName.trim() || undefined,
                moduleCode: query.moduleCode.trim() || undefined,
                operationType: query.operationType.trim() || undefined,
                operationResult:
                  query.operationResult === "" ? undefined : Number(query.operationResult)
              })
            : await getExceptionLogs({
                ...dates,
                requestPath: query.requestPath.trim() || undefined,
                errorType: query.errorType.trim() || undefined,
                handledStatus: query.handledStatus === "" ? undefined : Number(query.handledStatus)
              });
      rows.value = result.items;
      total.value = result.total;
    } catch (error) {
      rows.value = [];
      total.value = 0;
      loadError.value = error instanceof Error ? error.message : `${title.value}加载失败`;
    } finally {
      loading.value = false;
    }
  }

  async function search() {
    page.value = 1;
    await loadRows();
  }

  function closeDetail() {
    if (selected.value === null) return;
    detailRequest += 1;
    selected.value = null;
    detailLoading.value = false;
  }

  async function showDetail(row: AuditRow) {
    captureDetailFocus();
    const request = ++detailRequest;
    selected.value = row;
    detailLoading.value = true;
    actionError.value = "";
    try {
      const detail =
        props.kind === "login"
          ? await getLoginLog(row.id)
          : props.kind === "operation"
            ? await getOperationLog(row.id)
            : await getExceptionLog(row.id);
      if (request !== detailRequest || selected.value?.id !== row.id) return;
      selected.value = detail;
    } catch (error) {
      if (request !== detailRequest) return;
      closeDetail();
      actionError.value = error instanceof Error ? error.message : "日志详情加载失败";
    } finally {
      if (request === detailRequest) detailLoading.value = false;
    }
  }

  function changePage(nextPage: number) {
    if (nextPage < 1 || nextPage > pageCount.value || loading.value) return;
    page.value = nextPage;
    void loadRows();
  }

  onMounted(loadRows);
  return {
    PAGE_SIZE,
    loading,
    detailLoading,
    loadError,
    actionError,
    rows,
    selected,
    detailRequest,
    captureDetailFocus,
    restoreDetailFocus,
    total,
    page,
    pageCount,
    resultFilter,
    query,
    title,
    description,
    columns,
    formatTime,
    jsonText,
    cells,
    detailFields,
    loadRows,
    search,
    closeDetail,
    showDetail,
    changePage
  };
}
