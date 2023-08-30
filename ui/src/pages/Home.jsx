import React from 'react';
import styled from 'styled-components';
import { Paper, Typography } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';

// Define a light theme
const theme = createTheme({
  palette: {
    primary: {
      main: '#3f90f0', // Blue color
    },
    secondary: {
      main: '#32c787', // Green color
    },
    background: {
      default: '#ffffff', // White background color
    },
  },
});

// Styled components
const Container = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
`;

const StyledPaper = styled(Paper)`
  padding: 20px;
`;

const Title = styled(Typography)`
  margin-bottom: 20px;
`;

const Home = () => {
  return (
    <ThemeProvider theme={theme}>
      <Container>
        <StyledPaper elevation={3}>
          <Title variant="h4">Welcome to OmniLodge</Title>
          <Typography>
            Your dynamic and cool home page content goes here!
          </Typography>
        </StyledPaper>
      </Container>
    </ThemeProvider>
  );
};

export default Home;
