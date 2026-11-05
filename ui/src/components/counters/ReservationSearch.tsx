import { useRef } from 'react';
import { Button, IconButton, InputAdornment, TextField, Tooltip } from '@mui/material';
import { QrCodeScanner } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onScan: () => void;
  disabled?: boolean;
};

const ReservationSearch = ({ value, onChange, onScan, disabled = false }: Props) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <TextField
      size="small"
      inputRef={inputRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Search booking ID, reference, customer, phone..."
      fullWidth
      disabled={disabled}
      inputProps={{ 'aria-label': 'Search reservations' }}
      InputProps={{
        sx: { pr: 0, overflow: 'hidden' },
        endAdornment: (
          <InputAdornment position="end" sx={{ ml: 0, gap: 0, alignSelf: 'stretch', height: 'auto', maxHeight: 'none' }}>
            <Tooltip title="Scan booking barcode">
              <span>
                <IconButton
                  color="primary"
                  aria-label="Scan booking barcode"
                  disabled={disabled}
                  onClick={onScan}
                  sx={(theme) => ({
                    width: 44,
                    height: 44,
                    borderRadius: 0,
                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.18) },
                  })}
                >
                  <QrCodeScanner />
                </IconButton>
              </span>
            </Tooltip>
            <Button
              type="button"
              variant="contained"
              disableElevation
              size="small"
              disabled={disabled}
              onClick={() => {
                onChange('');
                inputRef.current?.focus();
              }}
              sx={{ minWidth: 76, alignSelf: 'stretch', px: 1.5, borderRadius: 0 }}
            >
              CLEAR
            </Button>
          </InputAdornment>
        ),
      }}
    />
  );
};

export default ReservationSearch;
