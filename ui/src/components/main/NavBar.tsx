import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { styled } from '@mui/system';
import {
  AppBar,
  Toolbar,
  Typography,
  Menu,
  MenuItem,
  IconButton,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { NavItemProps } from '../../types/general/NavItemProps';
import { useAppSelector } from '../../store/hooks';
import { MenuAnchorState } from '../../types/general/MenuAnchorState';

const SystemName = styled(Typography)({
  textDecoration: 'none',
  color: 'white',
  marginRight: '18px',
});

const NavItem = styled(Link)<NavItemProps>(({ open }) => ({
  minHeight: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textDecoration: 'none',
  color: 'white',
  padding: '0 20px',
  borderRadius: '4px',
  transition: 'background-color 0.3s, color 0.3s',
  backgroundColor: open ? '#222' : 'transparent',
  '&:hover': {
    backgroundColor: '#222',
  },
  '&:active': {
    backgroundColor: 'black',
    color: 'white',
  },
}));

const NavBar = () => {
  const { pages } = useAppSelector((state) => state.navigation);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchorState>(null);
  const openMenu = (event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) => setMenuAnchor(event.currentTarget);
  const closeMenu = () => setMenuAnchor(null);

  const isMenuOpen = Boolean(menuAnchor);

  const [showMobileMenu, setShowMobileMenu] = useState(
    window.innerWidth <= 600
  );

  useEffect(() => {
    const handleResize = () => {
      setShowMobileMenu(window.innerWidth <= 600);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <AppBar position="sticky" sx={{ backgroundColor: '#333', boxShadow: 'none' }}>
      <Toolbar>
      <SystemName>
        <Link to="/" style={{ textDecoration: 'none', color: 'white' }}>
          OmniLodge
        </Link>
      </SystemName>
        {showMobileMenu ? (
          <>
            <NavItem onClick={openMenu} open={isMenuOpen} to={'#'}>
              <IconButton
                size="large"
                aria-controls="menu"
                aria-haspopup="true"
                color="inherit"
              >
                <MenuIcon />
              </IconButton>
              <Typography variant="subtitle2" sx={{ color: 'white' }}>
                Menu
              </Typography>
            </NavItem>
            <Menu
              id="menu"
              anchorEl={menuAnchor}
              keepMounted
              open={Boolean(menuAnchor)}
              onClose={closeMenu}
            >
              {pages.map((page) => (
                <MenuItem
                  key={page.name}
                  component={Link}
                  to={page.path}
                  onClick={closeMenu}
                >
                  {page.name}
                </MenuItem>
              ))}
            </Menu>
          </>
        ) : (
          <>
            {pages.map((page) => (
              <NavItem to={page.path} key={page.name}>
                {page.name}
              </NavItem>
            ))}
          </>
        )}
      </Toolbar>
    </AppBar>
  );
};

export default NavBar;
