import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import axiosInstance from '../../utils/axiosInstance';
import ReviewArchivePanel from './ReviewArchivePanel';

jest.mock('../../utils/axiosInstance', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));

const get = axiosInstance.get as jest.Mock;
const post = axiosInstance.post as jest.Mock;
let totalCount: number;
let nextOffset: (offset: number) => number;

beforeEach(() => {
  jest.resetAllMocks();
  totalCount = 304;
  nextOffset = (offset) => offset + 1;
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation((query) => ({
    matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
  Object.defineProperty(global, 'ResizeObserver', { writable: true, value: jest.fn().mockImplementation(() => ({
    observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn(),
  })) });
  let runId = 0;
  post.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/start') ? { run: { id: ++runId } } : {} }));
  get.mockImplementation((url: string, options?: { params?: { offset?: number } }) => {
    if (url === '/reviews/tripadvisorReviews') {
      const offset = options?.params?.offset ?? 0;
      return Promise.resolve({ data: [{ data: [{ reviewId: String(offset + 1) }], columns: [{
        totalCount, hasMore: offset + 1 < totalCount, nextOffset: nextOffset(offset),
      }] }] });
    }
    return Promise.resolve({ data: { reviews: [], users: [], pagination: { total: 0, totalPages: 1 } } });
  });
});

const startFullSync = async (beforeFullSync?: () => void) => {
  render(<MantineProvider><ReviewArchivePanel platform="tripadvisor" canManage /></MantineProvider>);
  await waitFor(() => expect(post).toHaveBeenCalledWith('/reviews/archive/sync/fast/1/complete', expect.any(Object)));
  const button = screen.getByRole('button', { name: 'Full sync' });
  await waitFor(() => expect(button).toBeEnabled());
  beforeFullSync?.();
  fireEvent.click(button);
};

test('the browser full sync follows more than 250 TripAdvisor pages before completing', async () => {
  await startFullSync();
  await waitFor(() => expect(post).toHaveBeenCalledWith('/reviews/archive/sync/2/complete', { sourceTotalCount: 304, averageRating: undefined }));
  const pages = post.mock.calls.filter(([url]) => url === '/reviews/archive/sync/2/page');
  expect(pages).toHaveLength(304);
  expect(pages[0][1].reviews[0].reviewId).toBe('1');
  expect(pages[303][1].reviews[0].reviewId).toBe('304');
});

test('the browser refuses to complete a full sync if offsets stop advancing', async () => {
  await startFullSync(() => { nextOffset = (offset) => offset; });
  expect(await screen.findByText(/Reviews pagination did not advance/)).toBeInTheDocument();
  expect(post.mock.calls.some(([url]) => url === '/reviews/archive/sync/2/complete')).toBe(false);
  expect(post).toHaveBeenCalledWith('/reviews/archive/sync/2/fail');
});

test('the browser reports a page-cap failure instead of completing a partial full sync', async () => {
  totalCount = 1001;
  await startFullSync();
  expect(await screen.findByText(/Full sync reached its page limit/)).toBeInTheDocument();
  expect(post.mock.calls.filter(([url]) => url === '/reviews/archive/sync/2/page')).toHaveLength(1000);
  expect(post.mock.calls.some(([url]) => url === '/reviews/archive/sync/2/complete')).toBe(false);
});
