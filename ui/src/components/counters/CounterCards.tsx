import React from 'react';
import { Paper, Grid, Typography, Box, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

interface CounterCardProps {
  productId: number;
  productTypeId: number | undefined;
  name: string | undefined;
  normalCount: number;
  cocktailCount: number;
  quantity: number;
  price: number | undefined;
  total: number;
  onIncrease: (productId: number, productTypeId: number) => void;
  onDecrease: (productId: number, productTypeId: number) => void;
}

// Example layout
const CounterCard: React.FC<CounterCardProps> = ({
  productId,
  productTypeId,
  name,
  normalCount,
  cocktailCount,
  quantity,
  price,
  total,
  onIncrease,
  onDecrease,
}) => {
    return (
        <Paper elevation={3} sx={{ p: 2, borderRadius: 2 }}>
          {/* Top Section */}
          <Grid container alignItems="center" justifyContent="center" spacing={2}>
            {/* Left: Product Name */}
            <Grid item xs={8} sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                {name}
              </Typography>
            </Grid>
    
            {/* Right: N | C Switch */}
            <Grid item xs={4} sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <Box sx={{ display: 'flex', boxShadow: 1, borderRadius: 1, overflow: 'hidden' }}>
                <Box sx={{ width: 32, height: 32, bgcolor: '#ffd5da', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>N</Typography>
                </Box>
                <Box sx={{ width: 32, height: 32, bgcolor: '#fff', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ fontWeight: 'bold', color: '#007bff' }}>C</Typography>
                </Box>
              </Box>
            </Grid>
          </Grid>
    
          {/* Bottom Section */}
          <Grid container alignItems="center" justifyContent="center" spacing={2} sx={{ mt: 2 }}>
            {/* Left: Counts, Price, Total */}
            <Grid item xs={8} sx={{ textAlign: 'center' }}>
              <Typography variant="body2">Normal: {normalCount} | Cocktail: {cocktailCount}</Typography>
              <Typography variant="body2">Price: {price?.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}</Typography>
              <Typography variant="body2">Total: {total.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}</Typography>
            </Grid>
    
            {/* Right: Quantity and +/- Buttons */}
            <Grid item xs={4} sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                <Typography variant="h5" sx={{ mx: 1, fontWeight: 'bold' }}>{quantity}</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <IconButton size="small" onClick={() => onIncrease(productId, productTypeId || 0)} sx={{ border: '1px solid #ccc' }}>
                    <AddIcon />
                  </IconButton>
                  <IconButton size="small" onClick={() => onDecrease(productId, productTypeId || 0)} sx={{ border: '1px solid #ccc', mt: 0.5 }}>
                    <RemoveIcon />
                  </IconButton>
                </Box>
              </Box>
            </Grid>
          </Grid>
        </Paper>
      );
};

export default CounterCard;
