import { Op, type Transaction, type WhereOptions } from 'sequelize';
import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import Product from '../models/Product.js';
import Counter from '../models/Counter.js';
import NightReport from '../models/NightReport.js';
import Booking from '../models/Booking.js';
import UserTypeProductType from '../models/UserTypeProductType.js';
import HttpError from '../errors/HttpError.js';

export type ProductTypeScope = number[] | null;

export async function getAllowedProductTypeIds(
  req: AuthenticatedRequest,
  transaction?: Transaction,
): Promise<ProductTypeScope> {
  const userTypeId = req.authContext?.userTypeId;
  if (!userTypeId) return null;
  const rows = await UserTypeProductType.findAll({ where: { userTypeId }, attributes: ['productTypeId'], transaction });
  if (rows.length === 0) return null;
  return [...new Set(rows.map((row) => row.productTypeId))];
}

export const scopeProductWhere = (allowed: ProductTypeScope, base: WhereOptions = {}): WhereOptions =>
  allowed === null ? base : { [Op.and]: [base, { productTypeId: { [Op.in]: allowed } }] };

export async function requireProductTypeAccess(req: AuthenticatedRequest, productTypeId: number): Promise<void> {
  const allowed = await getAllowedProductTypeIds(req);
  if (allowed !== null && !allowed.includes(productTypeId)) {
    throw new HttpError(403, 'This product type is outside your assigned product scope');
  }
}

export async function requireProductAccess(req: AuthenticatedRequest, productId: number): Promise<Product> {
  const product = await Product.findByPk(productId);
  if (!product) throw new HttpError(404, 'Product not found');
  await requireProductTypeAccess(req, product.productTypeId);
  return product;
}

const scopeGuardError = (error: unknown, res: Response) => {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Failed to validate product scope';
  res.status(status).json([{ message }]);
};

export async function requireCounterProductScope(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const counterId = Number(req.params.id);
    if (!Number.isInteger(counterId) || counterId <= 0) throw new HttpError(400, 'Invalid counter id');
    const counter = await Counter.findByPk(counterId, { attributes: ['id', 'productId'] });
    if (!counter) throw new HttpError(404, 'Counter not found');
    if (counter.productId != null) await requireProductAccess(req, counter.productId);
    next();
  } catch (error) {
    scopeGuardError(error, res);
  }
}

export async function requireNightReportProductScope(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const reportId = Number(req.params.id ?? req.params.reportId);
    if (!Number.isInteger(reportId) || reportId <= 0) throw new HttpError(400, 'Invalid report id');
    const report = await NightReport.findByPk(reportId, { attributes: ['id', 'counterId'] });
    if (!report) throw new HttpError(404, 'Night report not found');
    const counter = await Counter.findByPk(report.counterId, { attributes: ['id', 'productId'] });
    if (!counter) throw new HttpError(404, 'Counter not found');
    if (counter.productId != null) await requireProductAccess(req, counter.productId);
    next();
  } catch (error) {
    scopeGuardError(error, res);
  }
}

export async function requireBookingProductScope(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const bookingId = Number(req.params.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) throw new HttpError(400, 'Invalid booking id');
    const booking = await Booking.findByPk(bookingId, { attributes: ['id', 'productId'] });
    if (!booking) throw new HttpError(404, 'Booking not found');
    const allowed = await getAllowedProductTypeIds(req);
    if (allowed !== null) {
      if (booking.productId == null) throw new HttpError(403, 'This booking has no product scope assignment');
      await requireProductAccess(req, booking.productId);
    }
    next();
  } catch (error) {
    scopeGuardError(error, res);
  }
}
