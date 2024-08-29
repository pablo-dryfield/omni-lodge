import { styled } from '@mui/system';

export const AppContainer = styled('div')(({ theme }) => ({
    display: 'grid',
    gridTemplateColumns: 'minmax(auto, max-content) 1fr', // Ensures the sidebar takes up only required space
    gridTemplateRows: 'auto 1fr', // Ensures the navbar takes up only required space
    minHeight: '100vh',
    backgroundColor: '#f2f2f2',
    padding: '0', // Remove padding if it causes overflow
    boxSizing: 'border-box',
    gap: '0', // Set the gap to '0' if you don't want any space between navbar, sidebar, and main content
}));
