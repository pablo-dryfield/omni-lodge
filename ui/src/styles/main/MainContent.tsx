import { styled } from '@mui/system';

export const MainContent = styled('div')(({ theme }) => ({
    gridColumn: '2', // MainContent is in the second column
    gridRow: '2', // MainContent is in the second row
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    margin: '40px',
    padding: '20px', // If you want padding inside the main content
    backgroundColor: 'white',
    borderRadius: '20px',
    boxShadow: '0px 8px 16px rgba(0, 0, 0, 0.2)',
    overflow: 'auto',
    [theme.breakpoints.down('sm')]: {
        boxShadow: 'none', // Remove box shadow on small screens (phones)
        margin: '0px', // Adjust margin for smaller screens
        marginTop: '10px',
        padding: '0px', // Adjust padding for smaller screens
        borderRadius: '0px'
    },
}));