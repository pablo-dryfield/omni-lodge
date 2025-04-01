import React, { useState, useEffect } from 'react';
import { Button, Grid, Typography, Paper, Box, IconButton, MenuItem, Select } from '@mui/material';
import RemoveIcon from '@mui/icons-material/Remove';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';
import { DatePicker, DateValidationError, PickerChangeHandlerContext } from '@mui/x-date-pickers';
import dayjs, { Dayjs } from 'dayjs';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchProducts } from '../../actions/productActions';
import { fetchUsers } from '../../actions/userActions';
import { Product } from '../../types/products/Product';
import { User } from '../../types/users/User';
import { Counter } from '../../types/counters/Counter';
import { CounterProduct } from '../../types/counterProducts/CounterProduct';
import { CounterUser } from '../../types/counterUsers/CounterUser';
import { CounterProductModalProps } from '../../types/counterProducts/CounterProductModalProps';
import { fetchCounters, updateCounter } from '../../actions/counterActions';
import { fetchCounterProducts, updateCounterProduct } from '../../actions/counterProductActions';
import { fetchCounterUsers, createBulkCounterUser, deleteCounterUser } from '../../actions/counterUserActions';
import CounterCard from './CounterCards';

const EditionModeContent: React.FC<CounterProductModalProps> = ({ table, row }) => {
    const dispatch = useAppDispatch();
    const { data: dataCounterProducts, loading: loadingCounterProducts, error: errorCounterProducts } = useAppSelector((state) => state.counterProducts)[0];
    const { data: dataCounterUsers, loading: loadingCounterUsers, error: errorCounterUsers } = useAppSelector((state) => state.counterUsers)[0];
    const { data: productData, loading: productLoading, error: productError } = useAppSelector((state) => state.products)[0];
    const { data: userData, loading: userLoading, error: userError } = useAppSelector((state) => state.users)[0];
    const [products, setProducts] = useState<Partial<Product>[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const { loggedUserId } = useAppSelector((state) => state.session);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        dispatch(fetchProducts());
        dispatch(fetchUsers());
    }, [dispatch]);

    useEffect(() => {
        if (productData && productData.length > 0) {
            setProducts(productData[0].data);
        }
    }, [productData]);

    // Extract the counter ID from the row

    const counterId: number | 0 = row.getValue("id");
    const initialCounterDate: string | null = row.getValue("date");

    const [counterDate, setCounterDate] = useState<Dayjs | null>(dayjs(initialCounterDate));

    // Filter the counter products data based on the counterId
    const counterProducts: Partial<CounterProduct>[] = dataCounterProducts[0]?.data.filter(
        (product: Partial<CounterProduct>) => product.counterId === counterId
    );

    const counterUsers: Partial<CounterUser>[] = dataCounterUsers[0]?.data.filter(
        (user: Partial<CounterUser>) => user.counterId === counterId
    );


    const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
    const [initialSelectedUsers, setInitialSelectedUsers] = useState<User[]>([]); // Add this line

    useEffect(() => {
        if (userData && userData.length > 0) {
            const userIDsInCounterUsers: number[] = counterUsers
                .map((user) => user.userId)
                .filter((id) => id !== undefined) as number[];

            const usersInCounterUsers: Partial<User>[] = userData[0]?.data.filter((user) =>
                userIDsInCounterUsers.includes(user.id || 0)
            );

            const initialUsers = usersInCounterUsers
                .filter((user) => user.id !== undefined)
                .map((user) => user as User);

            setSelectedUsers(initialUsers);
            setInitialSelectedUsers([...initialUsers]); // Create a clone of selectedUsers
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userData]);

    const initialQuantities: { [key: number]: number } = counterProducts.reduce((quantitiesObj, counterProduct) => {
        const { productId, quantity } = counterProduct;
        if (productId !== undefined && quantity !== undefined) {
            quantitiesObj[productId] = quantity;
        }
        return quantitiesObj;
    }, {} as { [key: number]: number });

    const [quantities, setQuantities] = useState<{ [key: number]: number }>(initialQuantities);

    const handleCancel = () => {
        table.setEditingRow(null);
        table.setRowSelection({});
    };

    const handleSave = async () => {

        if (saving) return;

        if (!counterDate || !selectedUsers.length || !Object.keys(quantities).length) {
            // Add logic to handle incomplete data
            return;
        }

        setSaving(true);

        try {
            // Step 1: Update Counter
            const total = products.reduce((acc, product) => {
                const id = product.id || 0;
                const quantity = quantities[id] || 0;
                return acc + (product.price || 0) * quantity;
            }, 0);

            const counterData: Partial<Counter> = {
                userId: row.getValue("userId"), // For simplicity, just pick the first user
                date: counterDate.toDate(), // Convert Dayjs to Date
                total: total, // Calculate total
                updatedBy: loggedUserId,
            };

            await dispatch(updateCounter({ counterId: counterId, counterData: counterData }));

            // Step 2: Update Counter Products

            const counterProductData: Partial<CounterProduct>[] = counterProducts.map((counterProduct) => {
                const product: Partial<Product> = productData[0]?.data.filter(
                    (product: Partial<Product>) => product.id || 0 === counterProduct.productId
                )[0];
                return {
                    id: counterProduct.id,
                    counterId: counterId,
                    productId: product.id || 0,
                    quantity: quantities[product.id || 0] || 0,
                    total: (product.price || 0) * (quantities[product.id || 0] || 0),
                    createdBy: loggedUserId,
                }
            });

            await Promise.all(counterProductData.map((data) => {
                const { id, ...rest } = data;
                const partialCounterProduct: Partial<CounterProduct> = rest;
                return dispatch(updateCounterProduct({ counterProductId: data.id || 0, counterProductData: partialCounterProduct }))
            }
            ));

            // Step 3: Update Counter Users

            // Check if the selectedUsers list has been modified
            const usersModified = JSON.stringify(selectedUsers) !== JSON.stringify(initialSelectedUsers);

            // If the selectedUsers list has been modified, perform the necessary actions
            if (usersModified) {

                // Create an array of user IDs from selectedUsers
                const selectedUserIds = selectedUsers.map((user) => user.id);

                // Create an array of user IDs from counterUsers
                const counterUserIds = counterUsers.map((counterUser) => counterUser.userId || 0);

                // Create an array of CounterUser objects to be added

                const counterUserDataToAdd: Partial<CounterUser>[] = selectedUsers.filter(
                    (user) => !counterUserIds.includes(user.id)).map((user) => ({
                        counterId: counterId,
                        userId: user.id || 0,
                        createdBy: loggedUserId,
                    }));

                // Create an array of CounterUser objects to be deleted

                const counterUserDataToDelete = counterUsers.filter(
                    (counterUser) => !selectedUserIds.includes(counterUser.userId || 0))
                    .map((counterUser) => counterUser.id || 0);

                // Dispatch actions for newly added users
                await dispatch(createBulkCounterUser(counterUserDataToAdd));

                // Dispatch actions for deleted users
                counterUserDataToDelete.forEach((user) => dispatch(deleteCounterUser(user)));
            }

            dispatch(fetchCounters());
            dispatch(fetchCounterProducts());
            dispatch(fetchCounterUsers());

            // Handle success
            table.setEditingRow(null);
            table.setRowSelection({});

        } catch (error) {
            // Handle error
        } finally {
            setSaving(false); // Set saving to false after saving is done
        }
    };

    const handleDecrease = (productId: number, productTypeId: number) => {
        setQuantities((prevQuantities) => ({
            ...prevQuantities,
            [productId]: Math.max((prevQuantities[productId] || 0) - (productTypeId === 2 ? -1 : 1), 0),
        }));
    };

    const handleIncrease = (productId: number, productTypeId: number) => {
        setQuantities((prevQuantities) => ({
            ...prevQuantities,
            [productId]: (prevQuantities[productId] || 0) + (productTypeId === 2 ? -1 : 1),
        }));
    };

    const handleReset = () => {
        setQuantities({});
    };

    const handleAddUser = () => {
        if (selectedUserId !== null && userData) {
            const selectedUser: Partial<User> | undefined = userData[0].data.find((user: Partial<User>) => user.id === selectedUserId);
            if (selectedUser) {
                // Check if the user is already selected
                if (!selectedUsers.some((user) => user.id === selectedUser.id)) {
                    setSelectedUsers([...selectedUsers, selectedUser as User]); // Assert selectedUser as User
                }
            }
        }

        // Reset selected user and selected user ID
        setSelectedUserId(null);
    };

    const handleRemoveUser = (userId: number) => {
        setSelectedUsers(selectedUsers.filter((user: Partial<User>) => user.id !== userId));
    };

    if (productLoading || userLoading || loadingCounterProducts || loadingCounterUsers) {
        return <div>Loading...</div>;
    }

    if (productError || userError || errorCounterProducts || errorCounterUsers || !products.length) {
        return <div>Error fetching data...</div>;
    }

    return <>
        <Grid container spacing={2}>
            {counterProducts.map((counterProduct) => {
                const product: Partial<Product> = productData[0]?.data.filter(
                    (product: Partial<Product>) => product.id || 0 === counterProduct.productId
                )[0];
                const id = product.id || 0; // Ensure id is always a number
                const { name, price, productTypeId } = product;
                const quantity = quantities[id] || 0;
                const total = price ? price * quantity : 0;

                return (
                    <Grid item xs={12} sm={6} md={4} key={id}>
                        <CounterCard
                        productId={id}
                        productTypeId={productTypeId}
                        name={name}
                        normalCount={0}
                        cocktailCount={0}
                        quantity={quantities[id] || 0}
                        price={price}
                        total={total}
                        onIncrease={(pid) => handleIncrease(pid, product.productTypeId || 0)}
                        onDecrease={(pid) => handleDecrease(pid, product.productTypeId || 0)}
                        />
                    </Grid>
                );
            })}
        </Grid>
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Total: {products.reduce((acc, product) => {
                const id = product.id || 0; // Ensure id is always a number
                const quantity = quantities[id] || 0;
                const total = product.price ? product.price * quantity : 0;
                return acc + total;
            }, 0)?.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })
            }</Typography>
            <Typography variant="h6">
                Customers: {
                    Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0)
                }
            </Typography>
            <Button onClick={handleReset} variant="outlined" endIcon={<RefreshIcon />}>Reset</Button>
        </Box>
        <Box sx={{ mt: 2 }}>
            <Typography variant="h6">Staff Working:</Typography>
            <Paper sx={{ p: 2 }}>
                {selectedUsers.map((user) => (
                    <Box key={user.id} sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Typography>{user.firstName}</Typography>
                        <IconButton size="small" onClick={() => handleRemoveUser(user.id)}><CloseIcon /></IconButton>
                    </Box>
                ))}
            </Paper>
        </Box>
        <Box sx={{ mt: 2 }}>
            <Select
                value={selectedUserId || ''}
                onChange={(e) => setSelectedUserId(Number(e.target.value))}
                fullWidth
                displayEmpty
            >
                <MenuItem disabled value="">
                    Select Staff
                </MenuItem>
                {userData && userData[0].data.map((user: Partial<User>) => (
                    <MenuItem key={user.id} value={user.id}>{user.firstName}</MenuItem>
                ))}
            </Select>
            <Button variant="outlined" onClick={handleAddUser} sx={{ mt: 2 }}>Add Staff</Button>
        </Box>
        <Box sx={{ mt: 2 }}>
            <DatePicker
                label="Counter Date"
                format="DD/MM/YYYY"
                value={counterDate}
                onChange={(newValue: Dayjs | null, context: PickerChangeHandlerContext<DateValidationError>) => setCounterDate(newValue)}
            />
        </Box>
        <Box sx={{ mt: 2, borderBottom: '1px solid white', pb: 3 }}>
            <Button variant="outlined" onClick={handleCancel} sx={{ mt: 2 }}>Cancel</Button>
            <Button variant="contained" onClick={handleSave} sx={{ mt: 2, ml: 2 }} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </Box>
    </>
}

export default EditionModeContent;