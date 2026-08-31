jest.mock('../../models/FinanceCategory.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));

jest.mock('../../models/FinanceVendor.js', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    update: jest.fn(),
    findByPk: jest.fn(),
  },
}));

jest.mock('../../services/auditLogService.js', () => ({
  recordFinanceAuditLog: jest.fn(),
}));

import type { Request, Response } from 'express';
import FinanceCategory from '../../models/FinanceCategory';
import FinanceVendor from '../../models/FinanceVendor';
import { recordFinanceAuditLog } from '../../services/auditLogService';
import { createVendor, updateVendor } from '../vendorController';

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
};

const createdVendor = {
  id: 41,
  name: 'New supplier',
  defaultCategoryId: null,
  toJSON: jest.fn(() => ({
    id: 41,
    name: 'New supplier',
    defaultCategoryId: null,
  })),
};

const createRequest = (body: Record<string, unknown>): Request => ({
  body,
  authContext: { id: 9 },
} as unknown as Request);

const updateRequest = (body: Record<string, unknown>): Request => ({
  body,
  params: { id: '41' },
  authContext: { id: 9 },
} as unknown as Request);

describe('finance vendor default category validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (FinanceVendor.create as jest.Mock).mockResolvedValue(createdVendor);
    (FinanceVendor.update as jest.Mock).mockResolvedValue([1]);
    (FinanceVendor.findByPk as jest.Mock).mockResolvedValue(createdVendor);
    (recordFinanceAuditLog as jest.Mock).mockResolvedValue(undefined);
  });

  it('creates a vendor without a default category and does not query categories', async () => {
    const response = createResponse();

    await createVendor(createRequest({ name: 'New supplier', isActive: true }), response);

    expect(FinanceCategory.findByPk).not.toHaveBeenCalled();
    expect(FinanceVendor.create).toHaveBeenCalledWith({
      name: 'New supplier',
      isActive: true,
    });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it('allows an explicit null default category', async () => {
    const response = createResponse();

    await createVendor(createRequest({
      name: 'New supplier',
      defaultCategoryId: null,
    }), response);

    expect(FinanceCategory.findByPk).not.toHaveBeenCalled();
    expect(FinanceVendor.create).toHaveBeenCalledWith({
      name: 'New supplier',
      defaultCategoryId: null,
    });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it('accepts an existing expense category, including an inactive one', async () => {
    (FinanceCategory.findByPk as jest.Mock).mockResolvedValue({
      id: 7,
      kind: 'expense',
      isActive: false,
    });
    const response = createResponse();

    await createVendor(createRequest({
      name: 'New supplier',
      defaultCategoryId: 7,
    }), response);

    expect(FinanceCategory.findByPk).toHaveBeenCalledWith(7, {
      attributes: ['id', 'kind'],
    });
    expect(FinanceVendor.create).toHaveBeenCalledWith({
      name: 'New supplier',
      defaultCategoryId: 7,
    });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it.each([
    undefined,
    0,
    -3,
    1.5,
    '',
    false,
    {},
  ])('rejects malformed default category value %p', async (defaultCategoryId) => {
    const response = createResponse();

    await createVendor(createRequest({ name: 'New supplier', defaultCategoryId }), response);

    expect(FinanceCategory.findByPk).not.toHaveBeenCalled();
    expect(FinanceVendor.create).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith([{
      message: 'defaultCategoryId must be a positive integer or null.',
    }]);
  });

  it('rejects a default category that does not exist', async () => {
    (FinanceCategory.findByPk as jest.Mock).mockResolvedValue(null);
    const response = createResponse();

    await createVendor(createRequest({
      name: 'New supplier',
      defaultCategoryId: 404,
    }), response);

    expect(FinanceVendor.create).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith([{
      message: 'Default category was not found.',
    }]);
  });

  it('rejects an income category as a vendor default', async () => {
    (FinanceCategory.findByPk as jest.Mock).mockResolvedValue({ id: 8, kind: 'income' });
    const response = createResponse();

    await createVendor(createRequest({
      name: 'New supplier',
      defaultCategoryId: 8,
    }), response);

    expect(FinanceVendor.create).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith([{
      message: 'A vendor default category must be an expense category.',
    }]);
  });

  it('updates unrelated vendor fields without querying the default category', async () => {
    const response = createResponse();

    await updateVendor(updateRequest({ notes: 'Updated terms' }), response);

    expect(FinanceCategory.findByPk).not.toHaveBeenCalled();
    expect(FinanceVendor.update).toHaveBeenCalledWith(
      { notes: 'Updated terms' },
      { where: { id: '41' } },
    );
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('allows an update to clear the default category', async () => {
    const response = createResponse();

    await updateVendor(updateRequest({ defaultCategoryId: null }), response);

    expect(FinanceCategory.findByPk).not.toHaveBeenCalled();
    expect(FinanceVendor.update).toHaveBeenCalledWith(
      { defaultCategoryId: null },
      { where: { id: '41' } },
    );
    expect(recordFinanceAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      changes: { defaultCategoryId: null },
    }));
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('rejects an update that assigns an income category', async () => {
    (FinanceCategory.findByPk as jest.Mock).mockResolvedValue({ id: 8, kind: 'income' });
    const response = createResponse();

    await updateVendor(updateRequest({ defaultCategoryId: 8 }), response);

    expect(FinanceVendor.update).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith([{
      message: 'A vendor default category must be an expense category.',
    }]);
  });
});
