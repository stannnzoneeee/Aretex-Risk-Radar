"use client";

import React, { useMemo, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ChartOptions,
  ChartData,
  TooltipItem,
  ScriptableContext // Import ScriptableContext for gradient
} from 'chart.js';
// Import datalabels plugin IF you need its types, but we won't register it here again
// import ChartDataLabels from 'chartjs-plugin-datalabels';

// Register Chart.js core components (datalabels is registered globally if installed)
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// Define data point structures (remain the same)
interface ReportDataPointDaily {
  date: string;
  count: number;
}
interface ReportDataPointWeekly {
  week: string;
  count: number;
}
interface ReportDataPointMonthly {
  month: string;
  count: number;
}
interface ReportDataPointYearly {
  year: number;
  count: number;
}

type ReportDataPoint =
  | ReportDataPointDaily
  | ReportDataPointWeekly
  | ReportDataPointMonthly
  | ReportDataPointYearly;
type TrendType = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface LineChartReportsProps {
  data: ReportDataPoint[];
  isLoading: boolean;
  error: string | null;
  dataType: TrendType;
  timePeriodDays?: number;
}

// --- Helper Functions for Label Formatting (remain the same) ---
const generateDateRange = (days: number): string[] => {
  const dates: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }
  return dates.reverse();
};

const formatDisplayDateDaily = (dateStr: string): string => {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (e) {
    console.error("Error formatting daily date:", dateStr, e);
    return dateStr;
  }
};

const formatDisplayDateMonthly = (monthStr: string): string => {
  try {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  } catch (e) {
    console.error("Error formatting monthly date:", monthStr, e);
    return monthStr;
  }
};

const formatDisplayDateWeekly = (weekStr: string): string => {
  try {
    const [yearStr, weekStrNum] = weekStr.split('-');
    const year = parseInt(yearStr);
    const week = parseInt(weekStrNum);

    if (isNaN(year) || isNaN(week)) throw new Error("Invalid year or week number");

    const jan4 = new Date(year, 0, 4);
    const jan4DayOfWeek = jan4.getDay() || 7;
    const mondayOfWeek1 = new Date(year, 0, 4 - (jan4DayOfWeek - 1));
    const weekStartDate = new Date(mondayOfWeek1);
    weekStartDate.setDate(mondayOfWeek1.getDate() + (week - 1) * 7);

    const monthName = weekStartDate.toLocaleDateString(undefined, { month: 'short' });
    const firstDayOfMonth = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), 1);
    const weekOfMonth = Math.ceil((weekStartDate.getDate() + firstDayOfMonth.getDay()) / 7);

    return `${monthName} Wk ${weekOfMonth}, ${year}`;
  } catch (e) {
    console.error("Error formatting weekly date:", weekStr, e);
    return weekStr;
  }
};
// --- End Helper Functions ---

const LineChartReports: React.FC<LineChartReportsProps> = ({
  data,
  isLoading,
  error,
  dataType,
  timePeriodDays = 7,
}) => {
  // Dynamic import for zoom plugin (remains the same)
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const zoomPlugin = (await import('chartjs-plugin-zoom')).default;
        // Check if zoom plugin is already registered before registering
        if (isMounted && !ChartJS.registry.plugins.get(zoomPlugin.id)) {
          ChartJS.register(zoomPlugin);
        }
      } catch (e) {
        console.error("Failed to load or register chartjs-plugin-zoom:", e);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  // Prepare data for Chart.js based on dataType
  const chartData = useMemo((): ChartData<'line'> => {
    let labels: string[] = [];
    let reportCounts: number[] = [];

    // Type guard functions (remain the same)
    const isDaily = (item: ReportDataPoint): item is ReportDataPointDaily =>
      dataType === 'daily' && typeof (item as any)?.date === 'string';
    const isWeekly = (item: ReportDataPoint): item is ReportDataPointWeekly =>
      dataType === 'weekly' && typeof (item as any)?.week === 'string';
    const isMonthly = (item: ReportDataPoint): item is ReportDataPointMonthly =>
      dataType === 'monthly' && typeof (item as any)?.month === 'string';
    const isYearly = (item: ReportDataPoint): item is ReportDataPointYearly =>
      dataType === 'yearly' && typeof (item as any)?.year === 'number';

    // Filter and Sort data (remains the same)
    const filteredAndSortedData = (data || [])
      .filter((item): item is ReportDataPoint => {
        switch (dataType) {
          case 'daily': return isDaily(item);
          case 'weekly': return isWeekly(item);
          case 'monthly': return isMonthly(item);
          case 'yearly': return isYearly(item);
          default: return false;
        }
      })
      .sort((a, b) => {
        if (isYearly(a) && isYearly(b)) return a.year - b.year;
        if (isMonthly(a) && isMonthly(b)) return a.month.localeCompare(b.month);
        if (isWeekly(a) && isWeekly(b)) return a.week.localeCompare(b.week);
        if (isDaily(a) && isDaily(b)) return a.date.localeCompare(b.date);
        return 0;
      });

    // Populate labels and reportCounts (remains the same)
    if (dataType === 'daily') {
      const dateRange = generateDateRange(timePeriodDays);
      const dailyData = filteredAndSortedData as ReportDataPointDaily[];
      const dataMap = new Map(dailyData.map((item) => [item.date, item.count]));
      labels = dateRange.map(formatDisplayDateDaily);
      reportCounts = dateRange.map((dateStr) => dataMap.get(dateStr) || 0);
    } else if (dataType === 'weekly') {
      const weeklyData = filteredAndSortedData as ReportDataPointWeekly[];
      labels = weeklyData.map((item) => formatDisplayDateWeekly(item.week));
      reportCounts = weeklyData.map((item) => item.count);
    } else if (dataType === 'monthly') {
      const monthlyData = filteredAndSortedData as ReportDataPointMonthly[];
      labels = monthlyData.map((item) => formatDisplayDateMonthly(item.month));
      reportCounts = monthlyData.map((item) => item.count);
    } else if (dataType === 'yearly') {
      const yearlyData = filteredAndSortedData as ReportDataPointYearly[];
      labels = yearlyData.map((item) => item.year.toString());
      reportCounts = yearlyData.map((item) => item.count);
    }

    // --- Dataset Configuration (Points remain for hover interaction) ---
    return {
      labels: labels,
      datasets: [
        {
          label: 'Reports Created',
          data: reportCounts,
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: (context: ScriptableContext<'line'>) => {
            const ctx = context.chart.ctx;
            const gradient = ctx.createLinearGradient(0, context.chart.chartArea?.top ?? 0, 0, context.chart.chartArea?.bottom ?? 500);
            gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
            gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
            return gradient;
          },
          tension: 0.4,
          fill: true,
          pointBackgroundColor: 'rgb(59, 130, 246)',
          pointBorderColor: '#fff',
          pointBorderWidth: 1.5,
          // Keep points for hover, but make them invisible by default
          pointRadius: 0, // Make points invisible
          pointHoverRadius: 5, // Make points visible on hover for tooltip
          pointHoverBackgroundColor: 'rgb(37, 99, 235)',
          pointHoverBorderColor: '#fff',
        },
      ],
    };
  }, [data, dataType, timePeriodDays]);

  // Configure Chart.js options
  const chartOptions = useMemo((): ChartOptions<'line'> => {
    // Dynamic Y-axis max calculation (remains the same)
    const maxCount = chartData.datasets[0]?.data
      ? Math.max(0, ...(chartData.datasets[0].data as number[]))
      : 0;
    const yAxisMax = Math.max(5, Math.ceil(maxCount * 1.1));

    // Max ticks calculation (remains the same)
    let suggestedMaxTicks = 10;
    if (dataType === 'daily' && timePeriodDays) suggestedMaxTicks = Math.min(timePeriodDays, 7);
    else if (dataType === 'weekly' || dataType === 'monthly') suggestedMaxTicks = 12;
    else if (dataType === 'yearly') suggestedMaxTicks = 10;

    // --- Updated Options ---
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        // --- ADD THIS SECTION TO DISABLE DATALABELS ---
        datalabels: {
          display: false, // Explicitly disable datalabels for this chart
        },
        // --- END ADDED SECTION ---

        legend: {
          position: 'top' as const,
          align: 'center',
          labels: {
            font: { size: 12 },
            color: '#4b5563',
            boxWidth: 12,
            padding: 15,
            // Keep point style in legend as hover still uses points
            usePointStyle: true,
            pointStyle: 'circle',
          },
        },
        tooltip: {
          enabled: true,
          mode: 'index', // Important for tooltip to appear without visible points
          intersect: false, // Tooltip appears when hovering near the line index
          backgroundColor: 'rgba(17, 24, 39, 0.85)',
          titleColor: '#f9fafb',
          bodyColor: '#f9fafb',
          titleFont: { size: 13, weight: 'bold' },
          bodyFont: { size: 12 },
          padding: 10,
          cornerRadius: 6,
          displayColors: false,
          callbacks: {
            title: function(tooltipItems: TooltipItem<'line'>[]) {
                let prefix = '';
                if (dataType === 'daily') prefix = 'Date: ';
                else if (dataType === 'weekly') prefix = 'Week: ';
                else if (dataType === 'monthly') prefix = 'Month: ';
                else if (dataType === 'yearly') prefix = 'Year: ';
                return prefix + (tooltipItems[0]?.label || '');
            },
            label: function(context: TooltipItem<'line'>) {
                return `Reports: ${context.formattedValue || '0'}`;
            },
          }
        },
        title: { display: false },
        zoom: {
          pan: { enabled: true, mode: 'x', threshold: 5 },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 11 },
            color: '#6b7280',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: suggestedMaxTicks,
            padding: 10,
          },
          type: 'category',
        },
        y: {
          beginAtZero: true,
          border: {
            display: false,
          },
          grid: {
            color: '#e5e7eb',
          },
          ticks: {
            font: { size: 11 },
            color: '#6b7280',
            stepSize: Math.max(1, Math.ceil(yAxisMax / 6)),
            precision: 0,
            padding: 10,
          },
          max: yAxisMax,
        },
      },
      interaction: {
        mode: 'index', // Keep index mode for tooltip interaction
        intersect: false,
      },
      animation: {
          duration: 500,
          easing: 'easeOutQuad'
      }
    };
    // --- End Updated Options ---
  }, [dataType, chartData.datasets, timePeriodDays]);

  // Zoom/Pan instructions logic (remains the same)
  const ZOOM_PAN_THRESHOLD = 15;
  const showZoomPanInstructions = useMemo(() => {
      return chartData.labels ? chartData.labels.length > ZOOM_PAN_THRESHOLD : false;
  }, [chartData.labels]);

  // JSX structure (remains the same)
  return (
    <div className="relative h-full flex flex-col">
      {/* Loading State Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10 min-h-[200px]">
          <div className="text-center text-gray-500 dark:text-gray-400">
            <svg className="animate-spin h-6 w-6 text-gray-400 dark:text-gray-500 mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Loading chart data...
          </div>
        </div>
      )}
      {/* Error State Overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-50/90 dark:bg-red-900/50 z-10 p-4 min-h-[200px]">
          <p className="text-red-600 dark:text-red-300 text-sm text-center">
            Error loading chart data: {error}
          </p>
        </div>
      )}
      {/* Empty State Overlay */}
      {!isLoading && !error && (!data || data.length === 0 || (chartData.labels?.length ?? 0) === 0) && (
        <div className="absolute inset-0 flex items-center justify-center min-h-[200px]">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            No report data available for this period.
          </p>
        </div>
      )}

      {/* Chart Container */}
      <div className="relative flex-grow min-h-0">
        {!isLoading && !error && data && data.length > 0 && (chartData.labels?.length ?? 0) > 0 && (
          <Line options={chartOptions} data={chartData} />
        )}
      </div>

      {/* Zoom/Pan Instructions */}
      {showZoomPanInstructions && !isLoading && !error && data && data.length > 0 && (chartData.labels?.length ?? 0) > 0 && (
          <div className="text-center text-xs text-gray-500 dark:text-gray-400 pt-2 flex-shrink-0">
              Use mouse wheel/pinch to zoom. Drag chart to pan.
          </div>
      )}
    </div>
  );
};

export default LineChartReports;
