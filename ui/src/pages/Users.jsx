import React from 'react';
import UsersList from '../components/users/UsersList';
import UserForm from '../components/users/UserForm';

const Users = () => {
  return (
    <div>
      <h1>Users</h1>
      <UsersList />
      <UserForm />
    </div>
  );
};

export default Users;
