import React from 'react';
import { Link } from 'react-router-dom';
import { Grid, Paper, Typography, ThemeProvider } from '@mui/material';
import styled from 'styled-components';
import BookIcon from '@mui/icons-material/Book';
import PeopleIcon from '@mui/icons-material/People';
import TvIcon from '@mui/icons-material/Tv';
import PersonIcon from '@mui/icons-material/Person';
import { createTheme } from '@mui/material/styles';

const theme = createTheme(); // Create a theme instance

const LogoTile = styled(Paper)`
  width: 120px;
  height: 120px;
  background-color: ${({ tiletheme }) => tiletheme.palette.grey[100]}; // Use a different prop name
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: ${({ tiletheme }) => tiletheme.spacing(2)}px;
`;

const Home = () => {
  const pageData = [
    { name: 'Bookings', path: '/bookings', icon: <BookIcon fontSize="large" /> },
    { name: 'Guests', path: '/guests', icon: <PeopleIcon fontSize="large" /> },
    { name: 'Channels', path: '/channels', icon: <TvIcon fontSize="large" /> },
    { name: 'Users', path: '/users', icon: <PersonIcon fontSize="large" /> },
    // Add more entries for other pages
  ];

  return (
    <ThemeProvider theme={theme}>
      <div>
        <Typography variant="h4" align="center" gutterBottom>
          Welcome to OmniLodge
        </Typography>
        <Grid container spacing={2} justifyContent="center">
          {pageData.map((page) => (
            <Link to={page.path} key={page.name}>
              <Grid item xs={12} sm={6} md={4}>
                <LogoTile elevation={3} tiletheme={theme}>
                  {page.icon}
                </LogoTile>
                <Typography variant="subtitle1" align="center">
                  {page.name}
                </Typography>
              </Grid>
            </Link>
          ))}
        </Grid>
      </div>
    </ThemeProvider>
  );
};

export default Home;
