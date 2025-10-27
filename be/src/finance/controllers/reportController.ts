import { Request, Response } from 'express';

export const getFinanceReportsPlaceholder = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    profitAndLoss: {
      status: 'placeholder',
      message: 'Profit & Loss report coming soon',
    },
    cashFlow: {
      status: 'placeholder',
      message: 'Cash Flow report coming soon',
    },
    budgetsVsActual: {
      status: 'placeholder',
      message: 'Budgets vs Actual report coming soon',
    },
  });
};

