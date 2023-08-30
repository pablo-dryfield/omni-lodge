import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchUsers, deleteUser } from '../../actions/userActions'; // Import the necessary actions

const UserList = () => {
  const dispatch = useDispatch();
  const { users, loading, error } = useSelector((state) => state.users); // Access users state from Redux store

  useEffect(() => {
    // Fetch users when the component mounts
    dispatch(fetchUsers());
  }, [dispatch]);

  const handleDelete = (userId) => {
    // Handle user deletion
    if (window.confirm('Are you sure you want to delete this user?')) {
      dispatch(deleteUser(userId));
    }
  };

  return (
    <div>
      <h2>User List</h2>
      {loading ? (
        <p>Loading...</p>
      ) : error ? (
        <p>Error retriving data: <i>{error}</i></p>
        ) : (
        <ul>
          {users ? (
          <p>No users found.</p>
          ) : users.map((user) => (
            <li key={user.id}>
              <span>{user.username}</span>
              <span>{user.email}</span>
              <button onClick={() => handleDelete(user.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default UserList;
