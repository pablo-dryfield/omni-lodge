import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import NavBar from './components/main/NavBar'; 
import LeftSidebar from './components/main/LeftSidebar';
import Routes from './components/main/Routes';
import { styled } from '@mui/system';

const AppContainer = styled('div')({
  display: 'grid',
  gridTemplateColumns: 'minmax(auto, max-content) 1fr', // Ensures the sidebar takes up only required space
  gridTemplateRows: 'auto 1fr', // Ensures the navbar takes up only required space
  minHeight: '100vh',
  backgroundColor: '#f2f2f2',
  padding: '0', // Remove padding if it causes overflow
  boxSizing: 'border-box',
  gap: '0', // Set the gap to '0' if you don't want any space between navbar, sidebar, and main content
});


const NavBarStyled = styled('div')({
  gridColumn: '1 / -1', // NavBar spans all columns
  gridRow: '1', // NavBar is in the first row
  // ... other styles
});

const LeftSidebarStyled = styled('div')({
  gridColumn: '1', // Sidebar is in the first column
  gridRow: '2', // Sidebar is in the second row
  // ... other styles
});


const MainContent = styled('div')({
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
  // ... other styles
});

const App = () => {
  return (
    <BrowserRouter>
      <AppContainer>
        <NavBarStyled>
          <NavBar />
        </NavBarStyled>
        <LeftSidebarStyled>
          <LeftSidebar />
        </LeftSidebarStyled>
        <MainContent>
          <Routes />
        </MainContent>
      </AppContainer>
    </BrowserRouter>
  );
};

export default App;
