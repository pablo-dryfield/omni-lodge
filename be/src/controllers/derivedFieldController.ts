import { Request, Response } from "express";
import DerivedFieldDefinition from "../models/DerivedFieldDefinition.js";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest";
import { ensureReportingAccess } from "../utils/reportingAccess.js";
import { normalizeDerivedFieldExpressionAst } from "../utils/derivedFieldExpression.js";

const coerceKind = (value: unknown): "row" | "aggregate" =>
  value === "aggregate" ? "aggregate" : "row";

const coerceScope = (value: unknown): "workspace" | "template" =>
  value === "template" ? "template" : "workspace";

export const listDerivedFields = async (req: Request, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req as AuthenticatedRequest);
    const { templateId } = req.query;
    const where: Record<string, unknown> = {};
    if (typeof templateId === "string" && templateId.trim().length > 0) {
      where.templateId = templateId.trim();
    }
    const fields = await DerivedFieldDefinition.findAll({
      where,
      order: [["updatedAt", "DESC"]],
    });
    res.json({
      derivedFields: fields.map((field) => ({
        id: field.id,
        scope: field.scope,
        templateId: field.templateId,
        workspaceId: field.workspaceId,
        name: field.name,
        expression: field.expression,
        kind: field.kind,
        expressionAst: field.expressionAst ?? null,
        referencedModels: Array.isArray(field.referencedModels) ? field.referencedModels : [],
        metadata: field.metadata ?? {},
        createdBy: field.createdBy,
        createdAt: field.createdAt?.toISOString() ?? null,
        updatedAt: field.updatedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error("Failed to list derived fields", error);
    res.status(500).json({ message: "Failed to load derived fields" });
  }
};

export const createDerivedField = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req);
    const { templateId, name, expression, kind, scope, metadata, expressionAst } = req.body ?? {};
    if (!name || typeof name !== "string" || !expression || typeof expression !== "string") {
      res.status(400).json({ message: "Name and expression are required." });
      return;
    }

    const astResult = normalizeDerivedFieldExpressionAst(expressionAst);
    const normalizedAst = astResult?.ast ?? null;
    const referencedModels = astResult?.referencedModels ?? [];

    const field = await DerivedFieldDefinition.create({
      templateId: typeof templateId === "string" && templateId.trim().length > 0 ? templateId.trim() : null,
      name: name.trim(),
      expression: expression.trim(),
      kind: coerceKind(kind),
      scope: coerceScope(scope),
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      expressionAst: normalizedAst,
      referencedModels,
      createdBy: req.authContext?.id ?? null,
    });

    res.status(201).json({
      derivedField: {
        id: field.id,
        scope: field.scope,
        templateId: field.templateId,
        workspaceId: field.workspaceId,
        name: field.name,
        expression: field.expression,
        kind: field.kind,
        expressionAst: field.expressionAst ?? null,
        referencedModels: Array.isArray(field.referencedModels) ? field.referencedModels : [],
        metadata: field.metadata ?? {},
        createdBy: field.createdBy,
        createdAt: field.createdAt?.toISOString() ?? null,
        updatedAt: field.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to create derived field", error);
    res.status(500).json({ message: "Failed to create derived field" });
  }
};

export const updateDerivedField = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req);
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ message: "Derived field id is required." });
      return;
    }

    const field = await DerivedFieldDefinition.findByPk(id);
    if (!field) {
      res.status(404).json({ message: "Derived field not found." });
      return;
    }

    const { name, expression, kind, metadata, expressionAst } = req.body ?? {};
    if (typeof name === "string" && name.trim().length > 0) {
      field.name = name.trim();
    }
    if (typeof expression === "string" && expression.trim().length > 0) {
      field.expression = expression.trim();
    }
    if (kind !== undefined) {
      field.kind = coerceKind(kind);
    }
    if (metadata && typeof metadata === "object") {
      field.metadata = metadata;
    }
    if (expressionAst !== undefined) {
      const astResult = normalizeDerivedFieldExpressionAst(expressionAst);
      field.expressionAst = astResult?.ast ?? null;
      field.referencedModels = astResult?.referencedModels ?? [];
    }

    await field.save();

    res.json({
      derivedField: {
        id: field.id,
        scope: field.scope,
        templateId: field.templateId,
        workspaceId: field.workspaceId,
        name: field.name,
        expression: field.expression,
        kind: field.kind,
        expressionAst: field.expressionAst ?? null,
        referencedModels: Array.isArray(field.referencedModels) ? field.referencedModels : [],
        metadata: field.metadata ?? {},
        createdBy: field.createdBy,
        createdAt: field.createdAt?.toISOString() ?? null,
        updatedAt: field.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to update derived field", error);
    res.status(500).json({ message: "Failed to update derived field" });
  }
};

export const deleteDerivedField = async (req: Request, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req as AuthenticatedRequest);
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ message: "Derived field id is required." });
      return;
    }

    const field = await DerivedFieldDefinition.findByPk(id);
    if (!field) {
      res.status(404).json({ message: "Derived field not found." });
      return;
    }

    await field.destroy();
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete derived field", error);
    res.status(500).json({ message: "Failed to delete derived field" });
  }
};
