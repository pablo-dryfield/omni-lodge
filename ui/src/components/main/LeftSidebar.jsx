import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { styled } from '@mui/system';
import { List, ListItem, ListItemIcon, ListItemText } from '@mui/material';
import BookIcon from '@mui/icons-material/Book';
import PeopleIcon from '@mui/icons-material/People';
import TvIcon from '@mui/icons-material/Tv';
import PersonIcon from '@mui/icons-material/Person';
import { useDispatch } from 'react-redux';
import {
  showGuests,
  showBookings,
} from '../../actions/leftSidebarActions'; // Import the actions

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
  // Use Redux to access the left sidebar state
  const dispatch = useDispatch();
  
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
            onClick={() => {
              // Dispatch the appropriate action based on the selected page
              if (page.name === 'Guests') {
                dispatch(showGuests());
              } else if (page.name === 'Bookings') {
                dispatch(showBookings());
              } 
              // Add more conditions for other pages as needed

              // You can also add a condition to close the sidebar if it's open
              if (!isOpen) {
                setIsOpen(true);
              }
            }}
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
