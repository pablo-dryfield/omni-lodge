import React, { useState, useEffect } from 'react';
import BookIcon from '@mui/icons-material/Book';
import PeopleIcon from '@mui/icons-material/People';
import TvIcon from '@mui/icons-material/Tv';
import PersonIcon from '@mui/icons-material/Person';
import { Sidebar, Menu, MenuItem } from 'react-pro-sidebar';

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
    <Sidebar collapsed={!isOpen} breakPoint={'sm'}>
      <Menu iconShape="square">
        {pageData.map((page) => (
          <MenuItem key={page.name} icon={<PeopleIcon />}>{page.name}</MenuItem>
        ))}
      </Menu>
    </Sidebar>
  );
};

export default LeftSidebar;