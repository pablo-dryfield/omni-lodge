import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ProfitLossPoint = {
  label: string;
  income: number;
  expense: number;
  net: number;
};

type CashFlowPoint = {
  label: string;
  inflow: number;
  outflow: number;
};

type BudgetRow = {
  categoryName: string;
  budget: number;
  actual: number;
};

type FinanceReportsChartProps =
  | {
      variant: "profitLoss";
      data: ProfitLossPoint[];
      formatCurrency: (value: number) => string;
    }
  | {
      variant: "cashFlow";
      data: CashFlowPoint[];
      formatCurrency: (value: number) => string;
    }
  | {
      variant: "budgetVsActual";
      data: BudgetRow[];
      formatCurrency: (value: number) => string;
    };

const FinanceReportsChart = (props: FinanceReportsChartProps) => {
  if (props.variant === "profitLoss") {
    return (
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={props.data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip
            formatter={(value: number) => props.formatCurrency(value)}
            labelFormatter={(label) => label}
          />
          <Legend />
          <Bar dataKey="income" name="Income" fill="#2f9e44" />
          <Bar dataKey="expense" name="Expenses" fill="#f03e3e" />
          <Line
            type="monotone"
            dataKey="net"
            name="Net"
            stroke="#1c7ed6"
            strokeWidth={2}
            dot={false}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (props.variant === "cashFlow") {
    return (
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={props.data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip
            formatter={(value: number) => props.formatCurrency(value)}
            labelFormatter={(label) => label}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="inflow"
            name="Inflow"
            stroke="#2f9e44"
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="outflow"
            name="Outflow"
            stroke="#f03e3e"
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={props.data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="categoryName" />
        <YAxis />
        <Tooltip formatter={(value: number) => props.formatCurrency(value)} />
        <Legend />
        <Bar dataKey="budget" name="Budget" fill="#1c7ed6" />
        <Bar dataKey="actual" name="Actual" fill="#f59f00" />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default FinanceReportsChart;
