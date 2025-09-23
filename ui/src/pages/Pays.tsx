import React, { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Paper,
  Container,
  Box,
  Table,
  Text,
  Center,
  Loader,
  Button,
} from '@mantine/core';
import { DatePicker } from '@mui/x-date-pickers';
import { Dayjs } from 'dayjs';
import { type Pay, type PayBreakdown } from '../types/pays/Pay';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchPays } from '../actions/payActions';

const formatCurrency = (value: number | undefined): string =>
  (value ?? 0).toLocaleString('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    minimumFractionDigits: 2,
  });

const Pays: React.FC = () => {
  const dispatch = useAppDispatch();
  const payState = useAppSelector((state) => state.pays)[0];
  const { data: responseData, loading, error } = payState;

  const [startDate, setStartDate] = useState<Dayjs | null>(null);
  const [endDate, setEndDate] = useState<Dayjs | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const summaries: Pay[] = useMemo(() => responseData?.[0]?.data ?? [], [responseData]);

  useEffect(() => {
    if (startDate && endDate) {
      const start = startDate.format('YYYY-MM-DD');
      const end = endDate.format('YYYY-MM-DD');
      void dispatch(fetchPays({ startDate: start, endDate: end }));
    }
  }, [startDate, endDate, dispatch]);

  const toggleRow = (index: number) => {
    setExpandedRow((prev) => (prev === index ? null : index));
  };

  return (
    <Container size={600} my={40}>
      <Paper radius={12} p="xl" withBorder>
        <Box style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <DatePicker
            label="Start Date"
            format="YYYY-MM-DD"
            value={startDate}
            onChange={(newValue: Dayjs | null) => setStartDate(newValue)}
          />
          <DatePicker
            label="End Date"
            format="YYYY-MM-DD"
            value={endDate}
            onChange={(newValue: Dayjs | null) => setEndDate(newValue)}
          />
        </Box>

        {loading && (
          <Center>
            <Loader size="lg" />
          </Center>
        )}

        {error && (
          <Text c="red" style={{ textAlign: 'center', marginTop: 16 }}>
            {error}
          </Text>
        )}

        {!loading && !error && summaries.length > 0 && (
          <Center>
            <Table
              style={{
                width: '100%',
                maxWidth: 600,
                margin: '0 auto',
                borderCollapse: 'collapse',
              }}
            >
              <thead>
                <tr>
                  <th style={{ borderBottom: '2px solid #ddd', padding: 8 }}>Name</th>
                  <th style={{ borderBottom: '2px solid #ddd', padding: 8 }}>Total Commission</th>
                  <th style={{ borderBottom: '2px solid #ddd', padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((item, index) => (
                  <Fragment key={`${item.firstName}-${index}`}>
                    <tr
                      style={{
                        backgroundColor: index % 2 === 0 ? '#f9f9f9' : 'white',
                        transition: 'background-color 0.3s',
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.backgroundColor = '#f1f1f1';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.backgroundColor = index % 2 === 0 ? '#f9f9f9' : 'white';
                      }}
                    >
                      <td style={{ borderBottom: '1px solid #ddd', padding: 8 }}>{item.firstName}</td>
                      <td style={{ borderBottom: '1px solid #ddd', padding: 8 }}>{formatCurrency(item.totalCommission)}</td>
                      <td style={{ borderBottom: '1px solid #ddd', padding: 8, textAlign: 'right' }}>
                        {item.breakdown.length > 0 && (
                          <Button variant="subtle" size="xs" onClick={() => toggleRow(index)}>
                            {expandedRow === index ? 'Hide breakdown' : 'Show breakdown'}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {expandedRow === index && item.breakdown.length > 0 && (
                      <tr>
                        <td colSpan={3} style={{ backgroundColor: '#fafafa', padding: '12px 8px' }}>
                          <Table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'left' }}>Date</th>
                                <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Customers</th>
                                <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Guides</th>
                                <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Commission</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.breakdown.map((entry: PayBreakdown) => (
                                <tr key={`${entry.date}-${entry.guidesCount}`}>
                                  <td style={{ borderBottom: '1px solid #eee', padding: 6 }}>{entry.date}</td>
                                  <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>{entry.customers}</td>
                                  <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>{entry.guidesCount}</td>
                                  <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>{formatCurrency(entry.commission)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          </Center>
        )}

        {!loading && !error && summaries.length === 0 && (
          <Text style={{ textAlign: 'center', marginTop: 16 }}>
            No data available for the selected dates.
          </Text>
        )}
      </Paper>
    </Container>
  );
};

export default Pays;
