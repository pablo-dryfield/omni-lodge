import { Request, Response } from 'express';
import { Op, fn, col } from 'sequelize';
import Counter from '../models/Counter.js';
import CounterProduct from '../models/CounterProduct.js';
import CounterUser from '../models/CounterUser.js';
import { Sequelize } from 'sequelize-typescript';
import User from '../models/User.js';
import dayjs from 'dayjs';

export const getCommissionByDateRange = async (req: Request, res: Response): Promise<void> => {
    try {
        const { startDate, endDate } = req.query;

        // Validate start and end date
        if (!startDate || !endDate) {
            res.status(400).json([{ message: 'Start date and end date are required' }]);
            return;
        }

        // Convert startDate to the beginning of the day and endDate to the end of the day
        const start = dayjs(startDate as string).startOf('day').toDate();
        const end = dayjs(endDate as string).endOf('day').toDate();

        // Find total quantity sold within the date range
        const commissionReport = await Counter.findAll({
            attributes: [
                'id',
                'date',
                [Sequelize.fn('SUM', Sequelize.col('products.quantity')), 'totalQuantity'],
            ],
            include: [
                {
                    model: CounterProduct,
                    as: 'products',
                    attributes: [],
                },
            ],
            where: {
                date: {
                    [Op.between]: [start, end],
                },
            },
            group: ['Counters.id'], // Corrected alias here
        });

        if (!commissionReport || commissionReport.length === 0 || !commissionReport[0].dataValues.totalQuantity) {
            res.status(404).json([{ message: 'No data found for the specified date range' }]);
            return;
        }

        // Find total number of staff members who worked within the date range
        const totalStaffCount = await CounterUser.findAll({
            attributes: [
                'userId',
            ],
            include: [
                {
                    model: Counter, // Include the Counter model here
                    as: 'counter', // Use the alias defined in your association
                    attributes: ['date'], // Include the 'date' attribute from the Counter model
                },
                {
                    model: User,
                    as: 'counterUser', // Use the correct alias for the User model associated with Counter
                    attributes: ['firstName'],
                },
            ],
            where: {
                '$counter.date$': {
                    [Op.between]: [start, end],
                },
            }
        });

        if (totalStaffCount.length === 0) {
            res.status(404).json([{ message: 'No staff members found for the specified date range' }]);
            return;
        }

        // Calculate commission per user per day
        const commissionDataByUser: { [key: string]: { firstName: string; totalCommission: number; totalBookings: number } } = {};

        // Initialize commission data for each user
        totalStaffCount.forEach((staff) => {
            const userId = staff.dataValues.userId;
            const firstName = staff.dataValues.counterUser.dataValues.firstName;
            commissionDataByUser[userId] = { firstName, totalCommission: 0, totalBookings: 0 };
        });

        // Calculate commission per day and distribute it among staff members
        commissionReport.forEach((report) => {
            const totalQuantity = report.dataValues.totalQuantity;
            const date = report.dataValues.date.toISOString().split('T')[0];

            // Filter staff members who worked on the current day
            const staffForDay = totalStaffCount.filter((staff) => staff.dataValues.counter.date.toISOString().split('T')[0] === date);

            // Calculate commission per booking for this day
            const commissionPerBooking = totalQuantity * 6 / staffForDay.length;

            // Update commission and bookings for each staff member
            staffForDay.forEach((staff) => {
                const userId = staff.dataValues.userId;
                const commission = commissionDataByUser[userId];
                commission.totalCommission += commissionPerBooking;
                commission.totalBookings++;
            });
        });

        // Send the response
        const commissionData = Object.values(commissionDataByUser).map(({ firstName, totalCommission }) => ({ firstName, totalCommission }));
        res.status(200).json([{ data: commissionData, columns: [] }]);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json([{ message: 'Internal server error' }]);
    }
};
