import React from 'react';
import { Link } from 'react-router-dom';
import { Grid, Paper, Typography, ThemeProvider } from '@mui/material';
import { styled } from '@mui/system';
import BookIcon from '@mui/icons-material/Book';
import PeopleIcon from '@mui/icons-material/People';
import TvIcon from '@mui/icons-material/Tv';
import PersonIcon from '@mui/icons-material/Person';
import { createTheme } from '@mui/material/styles';

const theme = createTheme();

const Home = () => {
  const pageData = [
    { name: 'Bookings', path: '/bookings', icon: <BookIcon fontSize="large" /> },
    { name: 'Guests', path: '/guests', icon: <PeopleIcon fontSize="large" /> },
    { name: 'Channels', path: '/channels', icon: <TvIcon fontSize="large" /> },
    { name: 'Users', path: '/users', icon: <PersonIcon fontSize="large" /> },
    // Add more entries for other pages
  ];

  const LogoTile = styled(Paper)(({ theme }) => ({
    width: 160,
    height: 160,
    backgroundColor: theme.palette.grey[100],
    borderRadius: '50%',
    display: 'flex',
    flexDirection: 'column', // Arrange icon and text in a column
    justifyContent: 'center',
    alignItems: 'center',
    margin: '0 auto', // Center the items
    marginBottom: theme.spacing(2), // Add spacing between items
    marginTop: theme.spacing(2), // Add spacing between items
    transition: 'background-color 0.3s', // Add transition
    '&:hover': {
      backgroundColor: theme.palette.grey[300], // Darker background on hover
    },
    '&:active': {
      backgroundColor: theme.palette.grey[500], // Even darker background on click
    },
  }));

  const PageName = styled(Typography)({
    color: 'black',
    textDecoration: 'none',
    textAlign: 'center',
    marginTop: theme.spacing(1), // Add spacing between icon and text
  });

  return (
    <ThemeProvider theme={theme}>
      <div>
        <Grid container spacing={2} justifyContent="center" sx={{ maxWidth: 1100, margin: '0 auto' }}>
          {pageData.map((page) => (
            <Grid item xs={12} sm={6} md={4} key={page.name}>
              <Link to={page.path} style={{ textDecoration: 'none' }}>
                <LogoTile elevation={3}>
                  {page.icon}
                  <PageName variant="subtitle1">
                    {page.name}
                  </PageName>
                </LogoTile>
              </Link>
            </Grid>
          ))}
        </Grid>
      </div>
    </ThemeProvider>
  );
};

export default Home;
