import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import NavBar from './components/NavBar'; // Import the NavBar component
import Routes from './components/Routes';

const App = () => {
  return (
    <BrowserRouter>
      <NavBar />
      <Routes />
    </BrowserRouter>
  );
};

export default App;
