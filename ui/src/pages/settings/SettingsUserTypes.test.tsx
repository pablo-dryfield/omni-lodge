import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import SettingsUserTypes from './SettingsUserTypes';
import { useAppSelector } from '../../store/hooks';
jest.mock('../../store/hooks', () => ({ useAppSelector: jest.fn() }));
jest.mock('../../components/access/PageAccessGuard', () => ({ PageAccessGuard: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../../components/userTypes/UserTypeList', () => ({ __esModule: true, default: () => <div>Company role editor</div> }));
jest.mock('../../components/userTypes/FoodTourUserTypesPanel', () => ({ __esModule: true, default: () => <div>Restricted Food Tour role creator</div> }));
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(query => ({
    matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
});

it.each([true, false])('uses the isolated role creator only for product-scoped sessions (%s)', productScoped => {
  (useAppSelector as jest.Mock).mockImplementation(selector => selector({ accessControl: { productTypeIds: productScoped ? [3] : null } }));
  render(<MantineProvider><SettingsUserTypes /></MantineProvider>);
  expect(screen.getByText(productScoped ? 'Restricted Food Tour role creator' : 'Company role editor')).toBeInTheDocument();
  expect(screen.queryByText(productScoped ? 'Company role editor' : 'Restricted Food Tour role creator')).not.toBeInTheDocument();
});
