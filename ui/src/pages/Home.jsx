import React from 'react';
import { Container, Typography, Button } from '@mui/material';
import { makeStyles } from '@mui/styles';

const useStyles = makeStyles((theme) => ({
  container: {
    backgroundColor: '#1a1a1a',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(4),
    color: 'white',
  },
  title: {
    fontSize: '2.5rem',
    marginBottom: theme.spacing(2),
  },
  description: {
    fontSize: '1.2rem',
    marginBottom: theme.spacing(4),
  },
  button: {
    backgroundColor: '#009688',
    color: 'white',
    '&:hover': {
      backgroundColor: '#00796b',
    },
  },
}));

const Home = () => {
  const classes = useStyles();

  return (
    <Container className={classes.container}>
      <Typography className={classes.title} variant="h1">
        Welcome to OmniLodge
      </Typography>
      <Typography className={classes.description} variant="body1">
        Your all-in-one solution for managing guests, bookings, channels, and users.
      </Typography>
      <Button className={classes.button} variant="contained">
        Get Started
      </Button>
    </Container>
  );
};

export default Home;
