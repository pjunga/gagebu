import { collection, doc, getDocsFromServer, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";
import { DEFAULT_WORK_CATEGORY, type WorkCategoryRecord, type WorkItem } from "./domain";
import { defaultWorkCategories, validateCategoryRename } from "./work-categories";

export async function initializeFirebaseWorkCategories(db: Firestore, userId: string) {
  const categories = collection(db, "users", userId, "workCategories");
  // An empty cache is not evidence of a new account. Fail closed when offline.
  const existing = await getDocsFromServer(categories);
  const marker = doc(db, "users", userId, "settings", "workCategories");
  const defaults = defaultWorkCategories();
  await runTransaction(db, async transaction => {
    if ((await transaction.get(marker)).exists()) return;
    const records = await Promise.all(defaults.map(item => transaction.get(doc(categories, item.id))));
    if (existing.empty) {
      defaults.forEach((item, index) => {
        if (!records[index].exists()) transaction.set(doc(categories, item.id), { ...item, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
    }
    transaction.set(marker, { initialized: true });
  });
}

export async function renameFirebaseWorkCategory(db: Firestore, userId: string, id: string, name: string) {
  const categories = collection(db, "users", userId, "workCategories");
  const snapshot = await getDocsFromServer(categories);
  const category = validateCategoryRename(snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as WorkCategoryRecord), id, name);
  const reference = doc(categories, id);
  const tasks = await getDocsFromServer(collection(db, "users", userId, "workItems"));
  const legacy = tasks.docs.filter(item => !item.data().categoryId && (item.data().category ?? DEFAULT_WORK_CATEGORY) === category.name);
  // Bind old records before the single visible rename. A failed chunk changes
  // no displayed names and can be retried; IDs make future renames constant-size.
  for (let offset = 0; offset < legacy.length; offset += 100) {
    await runTransaction(db, async transaction => {
      const currentCategory = await transaction.get(reference);
      if (currentCategory.data()?.name !== category.name) throw new Error("카테고리가 변경되었습니다. 다시 확인해주세요.");
      const currentTasks = await Promise.all(legacy.slice(offset, offset + 100).map(item => transaction.get(item.ref)));
      currentTasks.forEach(item => {
        const task = item.data() as WorkItem | undefined;
        if (task && !task.categoryId && (task.category ?? DEFAULT_WORK_CATEGORY) === category.name) {
          transaction.update(item.ref, { categoryId: id });
        }
      });
    });
  }
  await runTransaction(db, async transaction => {
    const current = await transaction.get(reference);
    if (current.data()?.name !== category.name) throw new Error("카테고리가 변경되었습니다. 다시 확인해주세요.");
    transaction.update(reference, { name: name.trim(), updatedAt: serverTimestamp() });
  });
}
