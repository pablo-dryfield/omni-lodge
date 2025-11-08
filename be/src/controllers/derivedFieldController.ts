import { Request, Response } from "express";
import type { Model, ModelCtor } from "sequelize-typescript";
import DerivedFieldDefinition from "../models/DerivedFieldDefinition.js";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest";
import { ensureReportingAccess } from "../utils/reportingAccess.js";
import { normalizeDerivedFieldExpressionAst } from "../utils/derivedFieldExpression.js";
import sequelize from "../config/database.js";

const coerceKind = (value: unknown): "row" | "aggregate" =>
  value === "aggregate" ? "aggregate" : "row";

const coerceScope = (value: unknown): "workspace" | "template" =>
  value === "template" ? "template" : "workspace";

const trimString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const getModelCtor = (modelId: string): ModelCtor<Model> | null => {
  const candidate = sequelize.models[modelId];
  if (!candidate) {
    return null;
  }
  return candidate as ModelCtor<Model>;
};

const modelHasField = (model: ModelCtor<Model>, fieldId: string): boolean => {
  const attributes = model.getAttributes();
  if (attributes[fieldId]) {
    return true;
  }
  return Object.values(attributes).some((attribute) => attribute.field === fieldId);
};

const collectReferenceIssues = (references: Record<string, string[]>) => {
  const missingModels: string[] = [];
  const missingFields: string[] = [];

  Object.entries(references).forEach(([modelId, fieldIds]) => {
    const trimmedModelId = trimString(modelId);
    if (!trimmedModelId || !Array.isArray(fieldIds) || fieldIds.length === 0) {
      return;
    }
    const model = getModelCtor(trimmedModelId);
    if (!model) {
      missingModels.push(trimmedModelId);
      return;
    }
    fieldIds.forEach((fieldId) => {
      const trimmedField = trimString(fieldId);
      if (!trimmedField) {
        return;
      }
      if (!modelHasField(model, trimmedField)) {
        missingFields.push(`${trimmedModelId}.${trimmedField}`);
      }
    });
  });

  return { missingModels, missingFields };
};

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
        referencedFields:
          field.referencedFields && typeof field.referencedFields === "object"
            ? (field.referencedFields as Record<string, string[]>)
            : {},
        joinDependencies: Array.isArray(field.joinDependencies) ? field.joinDependencies : [],
        modelGraphSignature: field.modelGraphSignature ?? null,
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
    const referencedFields = astResult?.referencedFields ?? {};
    const joinDependencies = astResult?.joinDependencies ?? [];
    const compiledSqlHash = astResult?.compiledSqlHash ?? null;
    const referenceIssues = collectReferenceIssues(referencedFields);
    if (referenceIssues.missingModels.length > 0 || referenceIssues.missingFields.length > 0) {
      res.status(400).json({
        message: "Derived field references unknown models or fields.",
        details: referenceIssues,
      });
      return;
    }
    const modelGraphSignature =
      typeof req.body?.modelGraphSignature === "string" && trimString(req.body.modelGraphSignature).length > 0
        ? trimString(req.body.modelGraphSignature)
        : null;

    const field = await DerivedFieldDefinition.create({
      templateId: typeof templateId === "string" && templateId.trim().length > 0 ? templateId.trim() : null,
      name: name.trim(),
      expression: expression.trim(),
      kind: coerceKind(kind),
      scope: coerceScope(scope),
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      expressionAst: normalizedAst,
      referencedModels,
      referencedFields,
      joinDependencies,
      modelGraphSignature,
      compiledExpressionHash: compiledSqlHash,
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
        referencedFields:
          field.referencedFields && typeof field.referencedFields === "object"
            ? (field.referencedFields as Record<string, string[]>)
            : {},
        joinDependencies: Array.isArray(field.joinDependencies) ? field.joinDependencies : [],
        modelGraphSignature: field.modelGraphSignature ?? null,
        compiledSqlHash: field.compiledExpressionHash ?? null,
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
      field.referencedFields = astResult?.referencedFields ?? {};
      field.joinDependencies = astResult?.joinDependencies ?? [];
      field.compiledExpressionHash = astResult?.compiledSqlHash ?? null;
      const referenceIssues = collectReferenceIssues(field.referencedFields);
      if (referenceIssues.missingModels.length > 0 || referenceIssues.missingFields.length > 0) {
        res.status(400).json({
          message: "Derived field references unknown models or fields.",
          details: referenceIssues,
        });
        return;
      }
    }
    if (req.body?.modelGraphSignature !== undefined) {
      const nextSignature = trimString(req.body.modelGraphSignature);
      field.modelGraphSignature = nextSignature.length > 0 ? nextSignature : null;
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
        referencedFields:
          field.referencedFields && typeof field.referencedFields === "object"
            ? (field.referencedFields as Record<string, string[]>)
            : {},
        joinDependencies: Array.isArray(field.joinDependencies) ? field.joinDependencies : [],
        modelGraphSignature: field.modelGraphSignature ?? null,
        compiledSqlHash: field.compiledExpressionHash ?? null,
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
