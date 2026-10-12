import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";
import { requestConfirmation } from "@/composables/use-confirmation";
import { computed, onMounted, reactive, ref } from "vue";
import type { Department, Post } from "@template/contracts/organization";
import { usePermissionStoreHook } from "@/stores/modules/permission";
import {
  deleteDepartment,
  deletePost,
  getDepartments,
  getPosts,
  listDepartmentOptions,
  saveDepartment,
  savePost
} from "./organization.service";

export type Kind = "department" | "post";
export type Status = 0 | 1;
export type Row = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  status: Status;
  description: string | null;
};

export function useOrganizationPage(props: { kind: Kind }) {
  const permissions = computed(() => new Set(usePermissionStoreHook().permissionKeys));
  const resource = computed(() => (props.kind === "department" ? "departments" : "posts"));
  const label = computed(() => (props.kind === "department" ? "部门" : "岗位"));
  const codeLabel = computed(() => (props.kind === "department" ? "部门编码" : "岗位编码"));
  const nameLabel = computed(() => (props.kind === "department" ? "部门名称" : "岗位名称"));
  const canRead = computed(() => permissions.value.has(`organization.${resource.value}.read`));
  const canCreate = computed(() => permissions.value.has(`organization.${resource.value}.create`));
  const canUpdate = computed(() => permissions.value.has(`organization.${resource.value}.update`));
  const canDelete = computed(() => permissions.value.has(`organization.${resource.value}.delete`));

  const loading = ref(false);
  const saving = ref(false);
  const rows = ref<Row[]>([]);
  const departmentOptions = ref<Department[]>([]);
  const total = ref(0);
  const loadError = ref("");
  const actionError = ref("");
  const page = ref(1);
  const pageSize = ref(10);
  const codeFilter = ref("");
  const nameFilter = ref("");
  const statusFilter = ref<"all" | "0" | "1">("all");
  const editorOpen = ref(false);
  const { restore: restoreEditorFocus } = useDialogReturnFocus(editorOpen);

  const editorMode = ref<"create" | "edit">("create");
  const form = reactive({
    id: "" as string | undefined,
    code: "",
    name: "",
    parentId: "",
    status: 1 as Status,
    description: ""
  });

  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
  const departmentById = computed(
    () => new Map(departmentOptions.value.map((department) => [department.id, department]))
  );

  const selectableParents = computed(() =>
    departmentOptions.value
      .filter(
        (department) =>
          department.id !== form.id &&
          !isDepartmentDescendant(department.id, form.id, departmentById.value)
      )
      .sort((left, right) =>
        departmentPath(left.deptName, left.parentId, left.id).localeCompare(
          departmentPath(right.deptName, right.parentId, right.id),
          "zh-CN"
        )
      )
  );

  function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  function toRow(value: Department | Post): Row {
    return "deptCode" in value
      ? {
          id: value.id,
          code: value.deptCode,
          name: value.deptName,
          parentId: value.parentId,
          status: value.status,
          description: value.description
        }
      : {
          id: value.id,
          code: value.postCode,
          name: value.postName,
          parentId: null,
          status: value.status,
          description: value.description
        };
  }

  function isDepartmentDescendant(
    candidateId: string,
    ancestorId: string | undefined,
    byId: Map<string, Department>
  ): boolean {
    if (!ancestorId) return false;
    let parentId = byId.get(candidateId)?.parentId ?? null;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (parentId === ancestorId) return true;
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return false;
  }

  function departmentPath(name: string, parentId: string | null, currentId?: string): string {
    const path = [name];
    const visited = new Set<string>(currentId ? [currentId] : []);
    let currentParentId = parentId;
    while (currentParentId) {
      if (visited.has(currentParentId)) {
        path.unshift("循环关系");
        break;
      }
      visited.add(currentParentId);
      const parent = departmentById.value.get(currentParentId);
      if (!parent) {
        path.unshift("未知上级部门");
        break;
      }
      path.unshift(parent.deptName);
      currentParentId = parent.parentId;
    }
    return path.join(" / ");
  }

  async function loadRows() {
    if (!canRead.value) {
      rows.value = [];
      total.value = 0;
      return;
    }
    loading.value = true;
    loadError.value = "";
    try {
      const commonFilters = {
        page: page.value,
        pageSize: pageSize.value,
        status: statusFilter.value === "all" ? undefined : (Number(statusFilter.value) as Status)
      };
      const result =
        props.kind === "department"
          ? await getDepartments({
              ...commonFilters,
              deptCode: codeFilter.value,
              deptName: nameFilter.value
            })
          : await getPosts({
              ...commonFilters,
              postCode: codeFilter.value,
              postName: nameFilter.value
            });
      if (props.kind === "department") {
        departmentOptions.value = await listDepartmentOptions();
      }
      rows.value = result.items.map(toRow);
      total.value = result.total;
    } catch (error) {
      rows.value = [];
      total.value = 0;
      loadError.value = errorText(error, `${label.value}列表加载失败`);
    } finally {
      loading.value = false;
    }
  }

  function search() {
    page.value = 1;
    void loadRows();
  }

  function resetForm() {
    Object.assign(form, {
      id: undefined,
      code: "",
      name: "",
      parentId: "",
      status: 1 as Status,
      description: ""
    });
    actionError.value = "";
  }

  function openCreate() {
    editorMode.value = "create";
    resetForm();
    editorOpen.value = true;
  }

  function openEdit(row: Row) {
    editorMode.value = "edit";
    Object.assign(form, {
      id: row.id,
      code: row.code,
      name: row.name,
      parentId: row.parentId ?? "",
      status: row.status,
      description: row.description ?? ""
    });
    actionError.value = "";
    editorOpen.value = true;
  }

  async function save() {
    if (saving.value) return;
    saving.value = true;
    actionError.value = "";
    const common = {
      ...(form.id ? { id: form.id } : {}),
      status: form.status,
      description: form.description.trim() || null
    };
    try {
      if (props.kind === "department") {
        await saveDepartment({
          ...common,
          parentId: form.parentId || null,
          deptCode: form.code,
          deptName: form.name
        });
      } else {
        await savePost({
          ...common,
          postCode: form.code,
          postName: form.name
        });
      }
      editorOpen.value = false;
      await loadRows();
    } catch (error) {
      actionError.value = errorText(error, `${label.value}保存失败`);
    } finally {
      saving.value = false;
    }
  }

  async function toggleStatus(row: Row) {
    actionError.value = "";
    try {
      const common = {
        id: row.id,
        status: row.status === 1 ? 0 : 1,
        description: row.description
      };
      if (props.kind === "department") {
        await saveDepartment({
          ...common,
          parentId: row.parentId,
          deptCode: row.code,
          deptName: row.name
        });
      } else {
        await savePost({ ...common, postCode: row.code, postName: row.name });
      }
      await loadRows();
    } catch (error) {
      actionError.value = errorText(error, `${label.value}状态更新失败`);
    }
  }

  async function remove(row: Row) {
    if (!(await requestConfirmation(`确认删除${label.value}“${row.name}”？`))) return;
    actionError.value = "";
    try {
      if (props.kind === "department") await deleteDepartment(row.id);
      else await deletePost(row.id);
      await loadRows();
    } catch (error) {
      actionError.value = errorText(error, `${label.value}删除失败`);
    }
  }

  function changePage(nextPage: number) {
    page.value = Math.min(Math.max(1, nextPage), pageCount.value);
    void loadRows();
  }

  onMounted(() => void loadRows());
  return {
    permissions,
    resource,
    label,
    codeLabel,
    nameLabel,
    canRead,
    canCreate,
    canUpdate,
    canDelete,
    loading,
    saving,
    rows,
    departmentOptions,
    total,
    loadError,
    actionError,
    page,
    pageSize,
    codeFilter,
    nameFilter,
    statusFilter,
    editorOpen,
    restoreEditorFocus,
    editorMode,
    form,
    pageCount,
    departmentById,
    selectableParents,
    errorText,
    toRow,
    isDepartmentDescendant,
    departmentPath,
    loadRows,
    search,
    resetForm,
    openCreate,
    openEdit,
    save,
    toggleStatus,
    remove,
    changePage
  };
}
