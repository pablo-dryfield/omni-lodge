import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MeetingPointPhotoEditor from './MeetingPointPhotoEditor';
import { uploadProductImage } from '../../actions/productActions';
import { compressImageFile } from '../../utils/imageCompression';

jest.mock('../../actions/productActions', () => ({ uploadProductImage: jest.fn() }));
jest.mock('../../utils/imageCompression', () => ({ compressImageFile: jest.fn() }));
const onChange = jest.fn(), onUploaded = jest.fn(), onUploadingChange = jest.fn();
const view = (photoUrl = '', productId: number | undefined = 48) => render(<MantineProvider>
  <MeetingPointPhotoEditor productId={productId} value={{ name: 'Market Square', photoUrl }}
    onChange={onChange} onUploaded={onUploaded} onUploadingChange={onUploadingChange} />
</MantineProvider>);
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) });
});
it('uploads a compressed email-compatible photo and tracks it for save/cancel cleanup', async () => {
  const file = new File(['photo'], 'meeting.png', { type: 'image/png' });
  const compressed = new File(['jpeg'], 'meeting.jpg', { type: 'image/jpeg' });
  (compressImageFile as jest.Mock).mockResolvedValue(compressed);
  (uploadProductImage as jest.Mock).mockResolvedValue({ url: 'https://media.test/meeting.jpg' });
  view();
  fireEvent.change(screen.getByLabelText('Meeting point photo file'), { target: { files: [file] } });
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ photoUrl: 'https://media.test/meeting.jpg', photoAlt: 'Market Square' }));
  expect(compressImageFile).toHaveBeenCalledWith(file, expect.objectContaining({ outputMimeType: 'image/jpeg' }));
  expect(uploadProductImage).toHaveBeenCalledWith(48, compressed);
  expect(onUploaded).toHaveBeenCalledWith('https://media.test/meeting.jpg');
  expect(onUploadingChange.mock.calls).toEqual([[true], [false]]);
});
it('keeps the saved photo when a replacement upload fails', async () => {
  (compressImageFile as jest.Mock).mockRejectedValue(new Error('Upload failed'));
  view('https://media.test/original.jpg');
  fireEvent.change(screen.getByLabelText('Meeting point photo file'), { target: { files: [new File(['x'], 'x.png')] } });
  expect(await screen.findByText('Upload failed')).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://media.test/original.jpg');
});
it('clears only the meeting point photo when removed', () => {
  view('https://media.test/original.jpg');
  fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
  expect(onChange).toHaveBeenCalledWith({ photoUrl: '', photoAlt: '' });
});
