import { sharedPool } from "./db.js";

export async function fetchAllRows(ids) {
  const rows = [];
  for (const id of ids) {
    rows.push(await sharedPool.query(id));
  }
  return rows;
}
