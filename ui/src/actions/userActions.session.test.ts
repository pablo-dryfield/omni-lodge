import { configureStore } from '@reduxjs/toolkit';
import axiosInstance from '../utils/axiosInstance';
import { loginUser, logoutUser } from './userActions';

jest.mock('../utils/axiosInstance', () => ({ __esModule: true, default: { post: jest.fn() } }));
beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); });
afterEach(() => localStorage.clear());

it('clears an old bearer token after login so subsequent requests use the new session cookie', async () => {
  const store = configureStore({ reducer: (state = {}) => state });
  localStorage.setItem('authToken', 'expired-local-token');
  localStorage.setItem('counter-draft', 'preserve');
  (axiosInstance.post as jest.Mock).mockResolvedValue({ data: [{ message: 'Logged in successfully', userId: 1 }] });
  await store.dispatch(loginUser({ email: 'test@example.test', password: 'test-only' })).unwrap();
  expect(localStorage.getItem('authToken')).toBeNull();
  expect(localStorage.getItem('counter-draft')).toBe('preserve');
});

it('clears a bearer token on successful logout without changing a failed login session', async () => {
  const store = configureStore({ reducer: (state = {}) => state });
  localStorage.setItem('authToken', 'existing-local-token');
  (axiosInstance.post as jest.Mock).mockRejectedValueOnce(new Error('Password is incorrect'));
  await store.dispatch(loginUser({ email: 'test@example.test' }));
  expect(localStorage.getItem('authToken')).toBe('existing-local-token');
  (axiosInstance.post as jest.Mock).mockResolvedValue({ data: [{ message: 'Logged out' }] });
  await store.dispatch(logoutUser()).unwrap();
  expect(localStorage.getItem('authToken')).toBeNull();
});
