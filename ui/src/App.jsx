import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import NavBar from './components/main/NavBar'; // Import the NavBar component
import Routes from './components/main/Routes';

const App = () => {
  return (
    <BrowserRouter>
      <NavBar />
      <Routes />
    </BrowserRouter>
  );
};

export default App;
