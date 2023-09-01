import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { styled } from '@mui/system';
import { List, ListItem, ListItemIcon, ListItemText } from '@mui/material';
import BookIcon from '@mui/icons-material/Book';
import PeopleIcon from '@mui/icons-material/People';
import TvIcon from '@mui/icons-material/Tv';
import PersonIcon from '@mui/icons-material/Person';

const SidebarContainer = styled('div')(({ isOpen }) => ({
  backgroundColor: '#9cb6ae',
  width: isOpen ? '240px' : '60px',
  height: '88.8vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  padding: isOpen ? '20px' : '10px',
  transition: 'width 0.3s, padding 0.3s', // Add transitions
}));

const pageData = [
  { name: 'Bookings', path: '/bookings', icon: <BookIcon /> },
  { name: 'Guests', path: '/guests', icon: <PeopleIcon /> },
  { name: 'Channels', path: '/channels', icon: <TvIcon /> },
  { name: 'Users', path: '/users', icon: <PersonIcon /> },
  // Add more entries for other pages
];

const LeftSidebar = () => {
  const [isOpen, setIsOpen] = useState(window.innerWidth > 600);

  useEffect(() => {
    const handleResize = () => {
      setIsOpen(window.innerWidth > 600);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <SidebarContainer isOpen={isOpen}>
      <List>
        {pageData.map((page) => (
          <ListItem
            key={page.name}
            button
            component={Link}
            to={page.path}
            sx={{ flexDirection: isOpen ? 'row' : 'row-reverse' }} // Reverse the direction of flex items when collapsed
          >
            <ListItemIcon>{page.icon}</ListItemIcon>
            {isOpen && <ListItemText primary={page.name} />}
          </ListItem>
        ))}
      </List>
    </SidebarContainer>
  );
};

export default LeftSidebar;
