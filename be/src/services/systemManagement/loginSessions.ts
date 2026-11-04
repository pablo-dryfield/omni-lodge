import crypto from "node:crypto";
import { QueryTypes } from "sequelize";

export async function createLoginSession(actorId: number): Promise<string> {
  const {default:sequelize}=await import("../../config/database.js");
  const id = crypto.randomUUID();
  await sequelize.query(
    "INSERT INTO auth_sessions(id,actor_id,expires_at,password_fingerprint) SELECT $1,id,now()+interval '7 days',md5(password) FROM users WHERE id=$2",
    { bind: [id, actorId] },
  );
  return id;
}
export async function validLoginSession(
  id: unknown,
  actorId: number,
): Promise<boolean> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return false;
  const {default:sequelize}=await import("../../config/database.js");
  const rows = await sequelize.query<{ valid: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.actor_id WHERE s.id=$1 AND s.actor_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.password_fingerprint IS NOT DISTINCT FROM md5(u.password)) AS valid",
    { bind: [id, actorId], type: QueryTypes.SELECT },
  );
  return rows[0]?.valid === true;
}
export async function revokeLoginSession(id: unknown): Promise<void> {
  if (typeof id === "string" && /^[0-9a-f-]{36}$/.test(id))
    {const {default:sequelize}=await import("../../config/database.js");await sequelize.query(
      "UPDATE auth_sessions SET revoked_at=now() WHERE id=$1",
      { bind: [id] },
    );}
}
