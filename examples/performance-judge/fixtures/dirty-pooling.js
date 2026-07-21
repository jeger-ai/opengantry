import { DbClient } from "./db.js";

export async function fetchAllRows(ids) {
  const rows = [];
  for (const id of ids) {
    const client = new DbClient();
    rows.push(await client.query(id));
  }
  return rows;
}
