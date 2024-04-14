import React, { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchProducts } from '../../actions/productActions';
import { fetchUsers } from '../../actions/userActions';
import { Product } from '../../types/products/Product';
import { User } from '../../types/users/User';
import { Button, Grid, Typography, Paper, Box, IconButton, MenuItem, Select } from '@mui/material';
import RemoveIcon from '@mui/icons-material/Remove';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';
import { DatePicker, DateValidationError, PickerChangeHandlerContext } from '@mui/x-date-pickers';
import { Dayjs } from 'dayjs';

const ProductCounterModal: React.FC = () => {
  const dispatch = useAppDispatch();
  const { data: productData, loading: productLoading, error: productError } = useAppSelector((state) => state.products)[0];
  const { data: userData, loading: userLoading, error: userError } = useAppSelector((state) => state.users)[0];
  const [quantities, setQuantities] = useState<{ [key: number]: number }>({});
  const [products, setProducts] = useState<Partial<Product>[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [counterDate, setCounterDate] = useState<Dayjs | null>(null);

  useEffect(() => {
    dispatch(fetchProducts());
    dispatch(fetchUsers());
  }, [dispatch]);

  useEffect(() => {
    if (productData && productData.length > 0) {
      setProducts(productData[0].data);
    }
  }, [productData]);

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
  };

  const handleRemoveUser = (userId: number) => {
    setSelectedUsers(selectedUsers.filter((user: Partial<User>) => user.id !== userId));
  };

  if (productLoading || userLoading) {
    return <div>Loading...</div>;
  }

  if (productError || userError || !products.length) {
    return <div>Error fetching data...</div>;
  }

  return (
    <>
      <Grid container spacing={2}>
        {products.map((product) => {
          const id = product.id || 0; // Ensure id is always a number
          const { name, price, productTypeId } = product;
          const quantity = quantities[id] || 0;
          const total = price ? price * quantity : 0;

          return (
            <Grid item xs={12} key={id}>
              <Paper elevation={1} sx={{ p: 2 }}>
                <Typography variant="h6">{name}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Typography>Quantity:</Typography>
                  <IconButton size="small" onClick={() => handleDecrease(id, productTypeId || 0)}><RemoveIcon /></IconButton>
                  <Typography>{quantity}</Typography>
                  <IconButton size="small" onClick={() => handleIncrease(id, productTypeId || 0)}><AddIcon /></IconButton>
                </Box>
                <Typography>Price: {price?.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}</Typography>
                <Typography>Total: {total?.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}</Typography>
              </Paper>
            </Grid>
          );
        })}
      </Grid>
      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Total: {
          products.reduce((acc, product) => {
            const id = product.id || 0; // Ensure id is always a number
            const quantity = quantities[id] || 0;
            const total = product.price ? product.price * quantity : 0;
            return acc + total;
          }, 0)?.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })
        }</Typography>
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
      >
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
    </>
  );
};

export default ProductCounterModal;
