import Page from "../../models/Page.js";
import Module from "../../models/Module.js";
import Action from "../../models/Action.js";
import ModuleAction from "../../models/ModuleAction.js";
import RolePagePermission from "../../models/RolePagePermission.js";
import RoleModulePermission from "../../models/RoleModulePermission.js";
import UserType from "../../models/UserType.js";
import { SYSTEM_ACTIONS } from "../../config/systemManagementConfig.js";

export async function ensureSystemManagementAccess(): Promise<void> {
  const [page] = await Page.findOrCreate({
    where: { slug: "settings-system-management" },
    defaults: {
      name: "System Management",
      description: "SSH, SFTP and server administration",
      sortOrder: 25,
      status: true,
    },
  });
  const [module] = await Module.findOrCreate({
    where: { slug: "system-management" },
    defaults: {
      name: "System Management",
      description: "Global server administration",
      pageId: page.id,
      componentRef: "SystemManagement",
      sortOrder: 1,
      status: true,
    },
  });
  const roles = await UserType.findAll({
    where: { slug: ["admin", "administrator"] },
  });
  for (const role of roles)
    await RolePagePermission.findOrCreate({
      where: { userTypeId: role.id, pageId: page.id },
      defaults: { canView: true, status: true },
    });
  for (const key of SYSTEM_ACTIONS) {
    const [action] = await Action.findOrCreate({
      where: { key },
      defaults: {
        name: key,
        description: `System ${key}`,
        isAssignable: true,
        status: true,
      },
    });
    await ModuleAction.findOrCreate({
      where: { moduleId: module.id, actionId: action.id },
      defaults: { enabled: true },
    });
    for (const role of roles)
      await RoleModulePermission.findOrCreate({
        where: {
          userTypeId: role.id,
          moduleId: module.id,
          actionId: action.id,
        },
        defaults: { allowed: true, status: true },
      });
  }
}
