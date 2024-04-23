import { Link } from 'react-router-dom';
import { Grid, Paper, Typography, ThemeProvider } from '@mui/material';
import { styled } from '@mui/system';
import { createTheme } from '@mui/material/styles';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';
import { useEffect } from 'react';

const theme = createTheme();

const CenteredContainer = styled('div')({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
});

const Home = (props: GenericPageProps) => {

  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(navigateToPage(props.title));
  }, [dispatch, props.title]);
  const { pages } = useAppSelector((state) => state.navigation);

  const LogoTile = styled(Paper)(({ theme }) => ({
    width: 160,
    height: 160,
    backgroundColor: theme.palette.grey[100],
    borderRadius: '50%',
    display: 'flex',
    flexDirection: 'column', // Arrange icon and text in a column
    justifyContent: 'center',
    alignItems: 'center',
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
      <CenteredContainer>
        <div>
          <Grid container justifyContent="center" >
            {pages.map((page) => (
              <Grid item xs={12} sm={6} md={4} key={page.name}>
                <Link to={page.path} style={{ padding: '3vh', textDecoration: 'none', alignItems: 'center', display: 'flex', justifyContent: 'center', }}>
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
      </CenteredContainer>
    </ThemeProvider>
  );
};

export default Home;
