import { BrowserRouter } from 'react-router-dom';
import NavBar from './components/main/NavBar';
//import LeftSidebar from './components/main/LeftSidebar/LeftSidebar';
import Routes from './components/main/Routes';
import Login from './pages/Login';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { useEffect } from 'react';
import { fetchSession } from './actions/sessionActions';
import { Center, Loader } from '@mantine/core';
import { AppContainer } from './styles/main/AppContainer';
import { NavBarStyled } from './styles/main/NavBarStyled';
import { MainContent } from './styles/main/MainContent';

// const LeftSidebarStyled = styled('div')({
//   gridColumn: '1', // Sidebar is in the first column
//   gridRow: '2', // Sidebar is in the second row
//   maxHeight: 'calc(100vh - 7vh)',
// });

const App = () => {
  const { authenticated, checkingSession } = useAppSelector((state) => state.session);
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (!authenticated) {
      dispatch(fetchSession());
    }
  }, [dispatch, authenticated]);

  if (checkingSession) {
    return (
      <Center style={{ height: '100vh' }}>
        <Loader variant="dots" /> 
      </Center>
    ); 
  }

  return (
    <BrowserRouter>
      {authenticated ? (
        <AppContainer>
          <NavBarStyled>
            <NavBar />
          </NavBarStyled>
          {/* <LeftSidebarStyled>
            <LeftSidebar />
          </LeftSidebarStyled> */}
          <MainContent>
            <Routes />
          </MainContent>
        </AppContainer>
      ) : (
        <Login />
      )}
    </BrowserRouter>
  );
};

export default App;
