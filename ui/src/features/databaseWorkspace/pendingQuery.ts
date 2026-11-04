// One navigation handoff in memory. SQL is never placed in the URL, browser
// history state, localStorage or sessionStorage, and is never auto-executed.
let pending: string | undefined;
export function stageWorkspaceQuery(sql: string) {
  pending = sql.replace(/^Executing \([^)]+\):\s*/i, '').slice(0, 102400);
}
export function consumeWorkspaceQuery() {
  const sql = pending;
  pending = undefined;
  return sql;
}
export function hasWorkspaceQuery() {
  return pending !== undefined;
}
