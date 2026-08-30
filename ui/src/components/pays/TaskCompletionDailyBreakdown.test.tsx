import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import TaskCompletionDailyBreakdown from './TaskCompletionDailyBreakdown';

describe('TaskCompletionDailyBreakdown', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
    Object.defineProperty(global, 'ResizeObserver', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
      })),
    });
  });

  it('expands the daily Assistant Manager Salary deduction calculation', () => {
    render(
      <MantineProvider>
        <TaskCompletionDailyBreakdown
          rows={[{
            date: '2026-08-24',
            baseAmount: 100,
            completedPercent: 70,
            missingPercent: 30,
            deductionAmount: 30,
            payableAmount: 70,
          }]}
          formatAmount={(amount) => `${amount.toFixed(2)} PLN`}
        />
      </MantineProvider>,
    );

    const toggle = screen.getByRole('button', { name: 'Show daily task calculation' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Daily task calculation (1 day) \u00b7 -30.00 PLN')).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Mon, Aug 24, 2026')).toBeInTheDocument();
    expect(screen.getByText('100.00 PLN')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('-30.00 PLN')).toBeInTheDocument();
    expect(screen.getByText('70.00 PLN')).toBeInTheDocument();
  });

  it('distinguishes duplicate-date allocations from unique salary days', () => {
    render(
      <MantineProvider>
        <TaskCompletionDailyBreakdown
          rows={[
            {
              date: '2026-08-08',
              baseAmount: 50,
              completedPercent: 100,
              missingPercent: 0,
              deductionAmount: 0,
              payableAmount: 50,
            },
            {
              date: '2026-08-08',
              baseAmount: 50,
              completedPercent: 100,
              missingPercent: 0,
              deductionAmount: 0,
              payableAmount: 50,
            },
          ]}
          formatAmount={(amount) => `${amount.toFixed(2)} PLN`}
        />
      </MantineProvider>,
    );

    expect(
      screen.getByText('Daily task calculation (1 day · 2 allocations) · No deduction'),
    ).toBeInTheDocument();
  });

  it('explains that a no-task day keeps full pay without a deduction', () => {
    render(
      <MantineProvider>
        <TaskCompletionDailyBreakdown
          rows={[{
            date: '2026-08-25',
            baseAmount: 100,
            totalTasks: 0,
            completedTasks: 0,
            waivedTasks: 0,
            incompleteTasks: 0,
            completedPercent: 100,
            missingPercent: 0,
            deductionAmount: 0,
            payableAmount: 100,
          }]}
          formatAmount={(amount) => `${amount.toFixed(2)} PLN`}
        />
      </MantineProvider>,
    );

    expect(screen.getByText('Daily task calculation (1 day) \u00b7 No deduction')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show daily task calculation' }));
    expect(screen.getByText('No tasks assigned \u2014 no deduction')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('identifies the original task-plan owner when the salary recipient took over the shift', () => {
    render(
      <MantineProvider>
        <TaskCompletionDailyBreakdown
          rows={[{
            date: '2026-08-08',
            baseAmount: 100,
            taskOwnerUserId: 188,
            taskOwnerName: 'Natalie Looper',
            attributionMethod: 'shift_instance',
            shiftInstanceIds: [2376],
            totalTasks: 11,
            completedTasks: 11,
            waivedTasks: 0,
            incompleteTasks: 0,
            completedPercent: 100,
            missingPercent: 0,
            deductionAmount: 0,
            payableAmount: 100,
          }]}
          salaryRecipientUserId={1}
          formatAmount={(amount) => `${amount.toFixed(2)} PLN`}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show daily task calculation' }));

    expect(screen.getByText('Task plan: Natalie Looper · shift takeover')).toBeInTheDocument();
    expect(screen.getByText('11 completed / 11 total')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows the shift taker their allocated half and the full-day context', () => {
    render(
      <MantineProvider>
        <TaskCompletionDailyBreakdown
          rows={[{
            date: '2026-08-08',
            baseAmount: 41.67,
            taskOwnerUserId: 188,
            taskOwnerName: 'Natalie Looper',
            attributionMethod: 'shift_instance',
            completedPercent: 100,
            missingPercent: 0,
            deductionAmount: 0,
            payableAmount: 41.67,
            takeoverAllocationRole: 'shift_taker',
            takeoverSplit: {
              shiftTakerUserId: 1,
              shiftTakerName: 'Pablo Camacho',
              taskOwnerUserId: 188,
              taskOwnerName: 'Natalie Looper',
              shiftTakerPercent: 50,
              taskOwnerPercent: 50,
              fullDayBaseAmount: 83.33,
              fullDayPayableAmount: 83.33,
              shiftTakerBaseAmount: 41.67,
              shiftTakerPayableAmount: 41.67,
              taskOwnerBaseAmount: 41.66,
              taskOwnerPayableAmount: 41.66,
            },
          }]}
          salaryRecipientUserId={1}
          formatAmount={(amount) => `${amount.toFixed(2)} PLN`}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show daily task calculation' }));

    expect(screen.getByText('50% shift-takeover share · shared with Natalie Looper')).toBeInTheDocument();
    expect(screen.getByText('Tasks: Natalie Looper')).toBeInTheDocument();
    expect(screen.getByText('Full day: 83.33 PLN base · 83.33 PLN payable after tasks')).toBeInTheDocument();
    expect(screen.getAllByText('41.67 PLN')).toHaveLength(2);
    expect(screen.queryByText(/Task plan:/i)).not.toBeInTheDocument();
  });

  it('shows the task owner their allocated half and the shift taker counterpart', () => {
    render(
      <MantineProvider>
        <TaskCompletionDailyBreakdown
          rows={[{
            date: '2026-08-08',
            baseAmount: 41.66,
            taskOwnerUserId: 188,
            taskOwnerName: 'Natalie Looper',
            attributionMethod: 'shift_instance',
            completedPercent: 100,
            missingPercent: 0,
            deductionAmount: 0,
            payableAmount: 41.66,
            takeoverAllocationRole: 'task_owner',
            takeoverSplit: {
              shiftTakerUserId: 1,
              shiftTakerName: 'Pablo Camacho',
              taskOwnerUserId: 188,
              taskOwnerName: 'Natalie Looper',
              shiftTakerPercent: 50,
              taskOwnerPercent: 50,
              fullDayBaseAmount: 83.33,
              fullDayPayableAmount: 83.33,
              shiftTakerBaseAmount: 41.67,
              shiftTakerPayableAmount: 41.67,
              taskOwnerBaseAmount: 41.66,
              taskOwnerPayableAmount: 41.66,
            },
          }]}
          salaryRecipientUserId={188}
          formatAmount={(amount) => `${amount.toFixed(2)} PLN`}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show daily task calculation' }));

    expect(screen.getByText('50% task-plan share · shared with Pablo Camacho')).toBeInTheDocument();
    expect(screen.getByText('Tasks: Natalie Looper')).toBeInTheDocument();
    expect(screen.getByText('Full day: 83.33 PLN base · 83.33 PLN payable after tasks')).toBeInTheDocument();
    expect(screen.getAllByText('41.66 PLN')).toHaveLength(2);
  });

  it('shows the task-adjusted full-day and allocated deduction for partial completion', () => {
    render(
      <MantineProvider>
        <TaskCompletionDailyBreakdown
          rows={[{
            date: '2026-08-08',
            baseAmount: 41.67,
            taskOwnerUserId: 188,
            taskOwnerName: 'Natalie Looper',
            attributionMethod: 'shift_instance',
            totalTasks: 5,
            completedTasks: 4,
            waivedTasks: 0,
            incompleteTasks: 1,
            completedPercent: 80,
            missingPercent: 20,
            deductionAmount: 8.34,
            payableAmount: 33.33,
            takeoverAllocationRole: 'shift_taker',
            takeoverSplit: {
              shiftTakerUserId: 1,
              shiftTakerName: 'Pablo Camacho',
              taskOwnerUserId: 188,
              taskOwnerName: 'Natalie Looper',
              shiftTakerPercent: 50,
              taskOwnerPercent: 50,
              fullDayBaseAmount: 83.33,
              fullDayPayableAmount: 66.66,
              shiftTakerBaseAmount: 41.67,
              shiftTakerPayableAmount: 33.33,
              taskOwnerBaseAmount: 41.66,
              taskOwnerPayableAmount: 33.33,
            },
          }]}
          salaryRecipientUserId={1}
          formatAmount={(amount) => `${amount.toFixed(2)} PLN`}
        />
      </MantineProvider>,
    );

    expect(screen.getByText('Daily task calculation (1 day) · -8.34 PLN')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show daily task calculation' }));

    expect(screen.getByText('Tasks: Natalie Looper')).toBeInTheDocument();
    expect(screen.getByText('Full day: 83.33 PLN base · 66.66 PLN payable after tasks')).toBeInTheDocument();
    expect(screen.getByText('4 completed / 5 total')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText('-8.34 PLN')).toBeInTheDocument();
    expect(screen.getByText('33.33 PLN')).toBeInTheDocument();
  });

  it('does not add a takeover label when the salary recipient owns the task plan', () => {
    render(
      <MantineProvider>
        <TaskCompletionDailyBreakdown
          rows={[{
            date: '2026-08-09',
            baseAmount: 100,
            taskOwnerUserId: 188,
            taskOwnerName: 'Natalie Looper',
            attributionMethod: 'shift_instance',
            completedPercent: 100,
            missingPercent: 0,
            deductionAmount: 0,
            payableAmount: 100,
          }]}
          salaryRecipientUserId={188}
          formatAmount={(amount) => `${amount.toFixed(2)} PLN`}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show daily task calculation' }));

    expect(screen.queryByText(/Task plan:/i)).not.toBeInTheDocument();
  });

  it('shows a backend attribution warning without inferring an owner', () => {
    render(
      <MantineProvider>
        <TaskCompletionDailyBreakdown
          rows={[{
            date: '2026-08-10',
            baseAmount: 100,
            attributionMethod: 'ambiguous',
            attributionWarning: 'Task-plan attribution needs manager review.',
            completedPercent: 100,
            missingPercent: 0,
            deductionAmount: 0,
            payableAmount: 100,
          }]}
          salaryRecipientUserId={1}
          formatAmount={(amount) => `${amount.toFixed(2)} PLN`}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show daily task calculation' }));

    expect(screen.getByText('Task-plan attribution needs manager review.')).toBeInTheDocument();
    expect(screen.getByText('Automatic task attribution skipped \u2014 no deduction')).toBeInTheDocument();
    expect(screen.queryByText(/Task plan:/i)).not.toBeInTheDocument();
  });

  it('renders nothing when the backend breakdown is absent', () => {
    render(
      <MantineProvider>
        <TaskCompletionDailyBreakdown rows={undefined} formatAmount={(amount) => String(amount)} />
      </MantineProvider>,
    );

    expect(screen.queryByRole('button', { name: /daily task calculation/i })).not.toBeInTheDocument();
  });
});
