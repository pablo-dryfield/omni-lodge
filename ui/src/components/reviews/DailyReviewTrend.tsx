import { useEffect, useMemo, useState } from 'react';
import { Paper, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import dayjs from 'dayjs';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import axiosInstance from '../../utils/axiosInstance';

type TrendPoint = Record<string, string | number>;

export type TrendSnapshot = {
  snapshotDate: string;
  platform: string;
  sourceTotalCount: number | null;
  activeCount: number;
};

export default function DailyReviewTrend({ snapshots }: { snapshots?: TrendSnapshot[] }) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const [loadedSnapshots, setLoadedSnapshots] = useState<TrendSnapshot[]>([]);

  useEffect(() => {
    if (snapshots !== undefined) {
      return;
    }
    void axiosInstance.get('/reviews/archive/trends', { params: { days: 90 } }).then((response) => {
      setLoadedSnapshots(response.data.snapshots as TrendSnapshot[]);
    });
  }, [snapshots]);

  const points = useMemo(() => {
    const byDate = new Map<string, TrendPoint>();
    for (const snapshot of snapshots ?? loadedSnapshots) {
      const point = byDate.get(snapshot.snapshotDate) ?? { date: snapshot.snapshotDate };
      point[snapshot.platform] = snapshot.sourceTotalCount ?? snapshot.activeCount;
      byDate.set(snapshot.snapshotDate, point);
    }
    return Array.from(byDate.values());
  }, [loadedSnapshots, snapshots]);

  return (
    <Paper p={{ base: 'md', sm: 'lg' }} withBorder radius="lg" style={{ minWidth: 0 }}>
      <Title order={4} ta="center">
        Daily Review Totals
      </Title>
      {points.length ? (
        <div style={{ width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height={isMobile ? 250 : 280}>
            <LineChart
              data={points}
              margin={
                isMobile
                  ? { top: 8, right: 4, bottom: 12, left: -8 }
                  : { top: 8, right: 16, bottom: 4, left: 0 }
              }
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={(value: string) => dayjs(value).format(isMobile ? 'D MMM' : 'MMM D')}
                minTickGap={isMobile ? 30 : 18}
                tick={{ fontSize: isMobile ? 10 : 12 }}
                tickMargin={8}
                height={isMobile ? 38 : 32}
              />
              <YAxis
                allowDecimals={false}
                width={isMobile ? 38 : 60}
                tick={{ fontSize: isMobile ? 10 : 12 }}
                tickMargin={4}
              />
              <Tooltip
                labelFormatter={(value) => dayjs(String(value)).format('D MMM YYYY')}
                contentStyle={{ fontSize: isMobile ? 11 : 12, maxWidth: isMobile ? 210 : 280 }}
              />
              <Legend
                align="center"
                verticalAlign="bottom"
                iconSize={isMobile ? 10 : 14}
                wrapperStyle={{
                  fontSize: isMobile ? 11 : 12,
                  lineHeight: isMobile ? '18px' : '20px',
                  paddingTop: 8,
                  textAlign: 'center',
                }}
              />
              <Line
                type="monotone"
                dataKey="google"
                stroke="#4285f4"
                connectNulls
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="tripadvisor"
                stroke="#00aa6c"
                connectNulls
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="airbnb"
                stroke="#ff385c"
                connectNulls
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="getyourguide"
                stroke="#ff5533"
                connectNulls
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Text c="dimmed" ta="center" py="xl">
          Sync a platform to create the first daily snapshot.
        </Text>
      )}
    </Paper>
  );
}
