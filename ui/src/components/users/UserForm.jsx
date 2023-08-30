import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { createUser, updateUser } from '../../actions/userActions'; // Import the necessary actions

const UserForm = () => {
  const dispatch = useDispatch();
  const { users } = useSelector((state) => state.users); // Access users state from Redux store

  const [formData, setFormData] = useState({
    id: '',
    username: '',
    email: '',
    password: '',
    createdAt: '',
    updatedAt: '',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prevData) => ({ ...prevData, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Check if the user already exists (for editing)
    const existingUser = users.find(
      (user) => user.email === formData.email && user.id !== formData.id
    );

    if (existingUser) {
      // Handle updating the existing user
      dispatch(updateUser(formData.id, formData));
    } else {
      // Handle adding a new user
      dispatch(createUser(formData));
    }

    // Reset form data
    setFormData({
      id: '',
      username: '',
      email: '',
      password: '',
      createdAt: '',
      updatedAt: '',
    });
  };

  return (
    <div>
      <h2>Add/Edit User</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Username:</label>
          <input
            type="text"
            name="username"
            value={formData.username}
            onChange={handleChange}
          />
        </div>
        <div>
          <label>Email:</label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
          />
        </div>
        <div>
          <label>Password:</label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
          />
        </div>
        <button type="submit">Save User</button>
      </form>
    </div>
  );
};

export default UserForm;
