import React, { useEffect, useState } from 'react';
import {
    Paper,
    Container,
    Box,
    Table,
    Text,
    Center,
    Loader,
} from '@mantine/core';
import { DatePicker } from '@mui/x-date-pickers';
import { Dayjs } from 'dayjs';
import { Pay } from '../types/pays/Pay';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchPays } from '../actions/payActions';

const Pays: React.FC = () => {
    const dispatch = useAppDispatch();
    const { data, loading, error } = useAppSelector((state) => state.pays)[0];
    const [startDate, setStartDate] = useState<Dayjs | null>(null);
    const [endDate, setEndDate] = useState<Dayjs | null>(null);

    // Fetch payment data whenever dates change
    useEffect(() => {
        if (startDate && endDate) {
            const start = startDate.format('YYYY-MM-DD');
            const end = endDate.format('YYYY-MM-DD');
            dispatch(fetchPays({ startDate: start, endDate: end }));
        }
    }, [startDate, endDate, dispatch]);

    return (
        <Container size={600} my={40}>
            <Paper radius={12} p="xl" withBorder>
                <Box style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
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
                    <Text color="red" style={{ textAlign: 'center', marginTop: '16px' }}>
                        {error}
                    </Text>
                )}

                {!loading && !error && data && data[0].data.length > 0 && (
                    <Center>
                        <Table
                            style={{
                                width: '100%',
                                maxWidth: '600px',
                                margin: '0 auto',
                                borderCollapse: 'collapse',
                            }}
                        >
                            <thead>
                                <tr>
                                    <th style={{ borderBottom: '2px solid #ddd', padding: '8px' }}>Name</th>
                                    <th style={{ borderBottom: '2px solid #ddd', padding: '8px' }}>Total Commission</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data[0].data.map((item: Partial<Pay>, index: number) => (
                                    <tr
                                        key={index}
                                        style={{
                                            backgroundColor: index % 2 === 0 ? '#f9f9f9' : 'white',
                                            transition: 'background-color 0.3s',
                                        }}
                                        onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f1f1f1')}
                                        onMouseOut={(e) => (e.currentTarget.style.backgroundColor = index % 2 === 0 ? '#f9f9f9' : 'white')}
                                    >
                                        <td style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>{item.firstName}</td>
                                        <td style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>
                                            {item.totalCommission?.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2 }) || "0.00 PLN"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    </Center>
                )}

                {!loading && !error && data && data[0].data.length === 0 && (
                    <Text style={{ textAlign: 'center', marginTop: '16px' }}>
                        No data available for the selected dates.
                    </Text>
                )}
            </Paper>
        </Container>
    );
};

export default Pays;
