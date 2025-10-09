import { Link } from 'react-router-dom';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import PersonIcon from '@mui/icons-material/Person';
import SettingsIcon from '@mui/icons-material/Settings';
import Grid from '@mui/material/Grid';
import { Paper, Typography, ThemeProvider } from '@mui/material';
import { styled } from '@mui/material/styles';
import { createTheme } from '@mui/material/styles';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';
import { selectAllowedNavigationPages } from '../selectors/accessControlSelectors';
import { useEffect } from 'react';
import { PageAccessGuard } from '../components/access/PageAccessGuard';
import type { NavigationIconKey } from '../types/general/NavigationState';
import { PAGE_SLUGS } from '../constants/pageSlugs';

const PAGE_SLUG = PAGE_SLUGS.dashboard;

const theme = createTheme();

const renderNavigationIcon = (icon: NavigationIconKey) => {
  switch (icon) {
    case 'eventAvailable':
      return <EventAvailableIcon fontSize="large" />;
    case 'assignmentTurnedIn':
      return <AssignmentTurnedInIcon fontSize="large" />;
    case 'person':
      return <PersonIcon fontSize="large" />;
    case 'settings':
      return <SettingsIcon fontSize="large" />;
    default:
      return <PersonIcon fontSize="large" />;
  }
};

const PageWrapper = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'calc(100vh - 120px)',
  padding: theme.spacing(6, 3),
  [theme.breakpoints.down('md')]: {
    padding: theme.spacing(4, 3),
  },
  [theme.breakpoints.down('sm')]: {
    padding: theme.spacing(3, 2),
    minHeight: 'auto',
  },
}));

const TilesContainer = styled('div')({
  width: '100%',
  maxWidth: 1080,
  margin: '0 auto',
});

const TileLink = styled(Link)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'center',
  textDecoration: 'none',
  width: '100%',
  paddingTop: theme.spacing(1),
  paddingBottom: theme.spacing(1),
}));

const LogoTile = styled(Paper)(({ theme }) => ({
  width: 'clamp(140px, 28vw, 200px)',
  height: 'clamp(140px, 28vw, 200px)',
  backgroundColor: theme.palette.grey[100],
  borderRadius: '50%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  gap: theme.spacing(1),
  textAlign: 'center',
  transition: theme.transitions.create(['background-color', 'transform'], {
    duration: theme.transitions.duration.shorter,
  }),
  [theme.breakpoints.down('sm')]: {
    width: 'min(240px, 70vw)',
    height: 'min(240px, 70vw)',
  },
  '&:hover': {
    backgroundColor: theme.palette.grey[200],
    transform: 'translateY(-4px)',
  },
  '&:active': {
    backgroundColor: theme.palette.grey[300],
    transform: 'translateY(-1px)',
  },
}));

const PageName = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.primary,
  textDecoration: 'none',
  marginTop: theme.spacing(1),
}));

const Home = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(navigateToPage(props.title));
  }, [dispatch, props.title]);

  const allowedPages = useAppSelector(selectAllowedNavigationPages);

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <ThemeProvider theme={theme}>
        <PageWrapper>
          <TilesContainer>
            <Grid container spacing={{ xs: 3, sm: 4, md: 5 }} justifyContent="center">
              {allowedPages.length === 0 ? (
                <Grid size={{ xs: 12 }}>
                  <Typography variant="subtitle1" color="textSecondary">
                    You do not have access to any sections yet.
                  </Typography>
                </Grid>
              ) : (
                allowedPages.map((page) => (
                  <Grid key={page.name} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                    <TileLink to={page.path} aria-label={`Go to ${page.name}`}>
                      <LogoTile elevation={3}>
                        {renderNavigationIcon(page.icon)}
                        <PageName variant="subtitle1">{page.name}</PageName>
                      </LogoTile>
                    </TileLink>
                  </Grid>
                ))
              )}
            </Grid>
          </TilesContainer>
        </PageWrapper>
      </ThemeProvider>
    </PageAccessGuard>
  );
};

export default Home;




