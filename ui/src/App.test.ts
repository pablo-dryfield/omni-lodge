import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { fetchSession } from './actions/sessionActions';
import { useAppDispatch, useAppSelector } from './store/hooks';
import App from './App';

jest.mock('./actions/sessionActions', () => ({
  fetchSession: jest.fn(() => ({ type: 'session/fetch' })),
}));

jest.mock('./actions/accessControlActions', () => ({
  fetchAccessSnapshot: jest.fn(() => ({ type: 'access/fetch' })),
}));

jest.mock('./store/hooks', () => ({
  useAppDispatch: jest.fn(),
  useAppSelector: jest.fn(),
}));

jest.mock('./utils/getNavbarSettings', () => ({
  getNavbarSettings: jest.fn(() => undefined),
}));

jest.mock('./utils/serverAvailability', () => ({
  SERVER_AVAILABILITY_CANDIDATE_EVENT: 'omni-server-availability-candidate',
  probeServerHealth: jest.fn(async () => ({ available: true })),
}));

jest.mock('./pages/Login', () => {
  const react = require('react');
  return {
    __esModule: true,
    default: () => react.createElement('div', { 'data-testid': 'login-page' }, 'Sign in'),
  };
});

const mockedUseAppDispatch = useAppDispatch as jest.MockedFunction<typeof useAppDispatch>;
const mockedUseAppSelector = useAppSelector as jest.MockedFunction<typeof useAppSelector>;
const mockedFetchSession = fetchSession as unknown as jest.Mock;
const mockDispatch = jest.fn();

describe('App', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockedUseAppDispatch.mockReturnValue(mockDispatch);
    mockedUseAppSelector.mockImplementation((selector) =>
      selector({
        session: {
          authenticated: false,
          checkingSession: false,
        },
        navigation: {
          currentPage: null,
        },
        accessControl: {
          loaded: false,
          loading: false,
          error: null,
        },
      } as never),
    );
    mockedFetchSession.mockReset();
    mockedFetchSession.mockReturnValue({ type: 'session/fetch' });

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows the login page and starts a session check for an unauthenticated user', async () => {
    render(
      React.createElement(
        MantineProvider,
        null,
        React.createElement(App),
      ),
    );

    expect(await screen.findByTestId('login-page')).toHaveTextContent('Sign in');

    await waitFor(() => {
      expect(mockedFetchSession).toHaveBeenCalledTimes(1);
    });
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'session/fetch' });
  });
});
