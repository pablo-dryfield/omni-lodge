import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import NavBar from './components/main/NavBar'; 
import LeftSidebar from './components/main/LeftSidebar';
import Routes from './components/main/Routes';
import { styled } from '@mui/system';

const AppContainer = styled('div')({
  display: 'flex',
  position: 'relative', // Add this to control positioning
  backgroundColor: '#f2f2f2', // Gray background color for the margin area
});

const MainContent = styled('div')({
  display: 'flex',
  flexDirection: 'column', // Stack content vertically
  flexGrow: 1,
  justifyContent: 'center',
  alignItems: 'stretch',
  backgroundColor: 'white', // White background color
  borderRadius: '20px', // Rounded corners
  boxShadow: '0px 8px 16px rgba(0, 0, 0, 0.2)', // Increased shadow intensity
  margin: '40px', // Add margin to create space around the main content
});

const App = () => {
  return (
    <BrowserRouter>
      <NavBar />
      <AppContainer>
        <LeftSidebar />
        <MainContent>
          <Routes />
        </MainContent>
      </AppContainer>
    </BrowserRouter>
  );
};

export default App;
