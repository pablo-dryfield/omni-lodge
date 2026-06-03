import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

type ChartType = "line" | "area" | "bar" | "stackedArea" | "stackedBar" | "scatter" | "pie";

type ChartRow = {
  dimension: string;
  primary: number;
  secondary?: number;
};

type ReportsVisualChartProps = {
  chartComparisonAlias?: string | null;
  chartData: ChartRow[];
  chartType: ChartType;
  comparisonDisplayLabel?: string | null;
  dimensionLabel: string;
  metricDisplayLabel: string;
  pieColors: string[];
  tooltipFormatter: (value: number, name: string, entry: unknown) => [string, string];
};

const ReportsVisualChart = ({
  chartComparisonAlias,
  chartData,
  chartType,
  comparisonDisplayLabel,
  dimensionLabel,
  metricDisplayLabel,
  pieColors,
  tooltipFormatter,
}: ReportsVisualChartProps) => {
  const isPieVisualization = chartType === "pie";
  const isStackedVisualization = chartType === "stackedArea" || chartType === "stackedBar";

  const renderPrimarySeries = () => {
    switch (chartType) {
      case "area":
      case "stackedArea":
        return (
          <Area
            type="monotone"
            dataKey="primary"
            stroke="#1c7ed6"
            fill="#a5d8ff"
            name={metricDisplayLabel}
            yAxisId="left"
            stackId={chartType === "stackedArea" ? "stack" : undefined}
          />
        );
      case "bar":
      case "stackedBar":
        return (
          <Bar
            dataKey="primary"
            fill="#228be6"
            barSize={26}
            name={metricDisplayLabel}
            yAxisId="left"
            stackId={chartType === "stackedBar" ? "stack" : undefined}
          />
        );
      case "scatter":
        return (
          <Scatter
            dataKey="primary"
            fill="#1c7ed6"
            name={metricDisplayLabel}
            yAxisId="left"
            line
          />
        );
      case "line":
      default:
        return (
          <Line
            type="monotone"
            dataKey="primary"
            stroke="#1c7ed6"
            strokeWidth={2}
            dot={false}
            name={metricDisplayLabel}
            yAxisId="left"
          />
        );
    }
  };

  const renderComparisonSeries = () => {
    if (!chartComparisonAlias || isPieVisualization) {
      return null;
    }
    const comparisonYAxisId = isStackedVisualization ? "left" : "right";
    const name = comparisonDisplayLabel ?? "Comparison";
    switch (chartType) {
      case "area":
      case "stackedArea":
        return (
          <Area
            type="monotone"
            dataKey="secondary"
            stroke="#2b8a3e"
            fill="#d3f9d8"
            name={name}
            yAxisId={comparisonYAxisId}
            stackId={chartType === "stackedArea" ? "stack" : undefined}
          />
        );
      case "bar":
      case "stackedBar":
        return (
          <Bar
            dataKey="secondary"
            fill="#82c91e"
            barSize={26}
            name={name}
            yAxisId={comparisonYAxisId}
            stackId={chartType === "stackedBar" ? "stack" : undefined}
          />
        );
      case "scatter":
        return (
          <Scatter
            dataKey="secondary"
            fill="#2b8a3e"
            name={name}
            yAxisId={comparisonYAxisId}
          />
        );
      case "line":
      default:
        return (
          <Line
            type="monotone"
            dataKey="secondary"
            stroke="#2b8a3e"
            strokeWidth={2}
            dot={false}
            name={name}
            yAxisId={comparisonYAxisId}
          />
        );
    }
  };

  return (
    <ResponsiveContainer width="100%" height={240}>
      {isPieVisualization ? (
        <PieChart>
          <RechartsTooltip
            formatter={tooltipFormatter}
            labelFormatter={(label) => `${dimensionLabel}: ${label}`}
          />
          <Legend />
          <Pie
            data={chartData}
            dataKey="primary"
            nameKey="dimension"
            innerRadius={48}
            outerRadius={90}
            paddingAngle={2}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`pie-${entry.dimension}-${index}`}
                fill={pieColors[index % pieColors.length]}
              />
            ))}
          </Pie>
        </PieChart>
      ) : (
        <ComposedChart data={chartData}>
          <CartesianGrid stroke="#f1f3f5" strokeDasharray="4 4" />
          <XAxis dataKey="dimension" tick={{ fontSize: 12 }} />
          <YAxis yAxisId="left" tick={{ fontSize: 12 }} stroke="#1c7ed6" />
          {chartComparisonAlias && !isStackedVisualization && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 12 }}
              stroke="#2b8a3e"
            />
          )}
          <RechartsTooltip
            formatter={tooltipFormatter}
            labelFormatter={(label) => `${dimensionLabel}: ${label}`}
          />
          <Legend />
          {renderPrimarySeries()}
          {renderComparisonSeries()}
        </ComposedChart>
      )}
    </ResponsiveContainer>
  );
};

export default ReportsVisualChart;
