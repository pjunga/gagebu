import { DEFAULT_WORK_CATEGORY, DESIGN_WORK_CATEGORY_ID, WORK_CATEGORIES, workCategorySeedId, type WorkCategoryRecord, type WorkItem } from "./domain";

export const defaultWorkCategories = (): WorkCategoryRecord[] =>
  WORK_CATEGORIES.map((name, order) => ({ id: workCategorySeedId(order), name, order, source: "manual" }));

export function workCategoryFor(task: Pick<WorkItem, "category" | "categoryId">, categories: WorkCategoryRecord[]) {
  return task.categoryId
    ? categories.find(category => category.id === task.categoryId)
    : categories.find(category => category.name === (task.category ?? DEFAULT_WORK_CATEGORY))
      ?? ((task.category ?? DEFAULT_WORK_CATEGORY) === DEFAULT_WORK_CATEGORY ? categories.find(category => category.id === DESIGN_WORK_CATEGORY_ID) : undefined);
}

export function workCategoryName(task: Pick<WorkItem, "category" | "categoryId">, categories: WorkCategoryRecord[]) {
  return workCategoryFor(task, categories)?.name ?? task.category ?? DEFAULT_WORK_CATEGORY;
}

export function validateCategoryRename(categories: WorkCategoryRecord[], id: string, name: string) {
  const category = categories.find(item => item.id === id);
  if (!category) throw new Error("카테고리가 삭제되었습니다. 목록을 다시 확인해주세요.");
  if (!name.trim() || name.trim().length > 60) throw new Error("카테고리 이름은 1~60자로 입력해주세요.");
  if (categories.some(item => item.id !== id && item.name === name.trim())) throw new Error("같은 이름의 카테고리가 이미 있습니다.");
  return category;
}
