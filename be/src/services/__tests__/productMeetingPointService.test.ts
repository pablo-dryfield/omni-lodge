import { meetingPointTemplateContext, validateMeetingPointPhoto } from '../productMeetingPointService';

it('exposes the product meeting point as nested and flat template fields', () => {
  const point = { name: 'Market Square', photoUrl: 'https://media.example.com/meeting.jpg', photoAlt: 'The guide beside the statue' };
  expect(meetingPointTemplateContext(point)).toEqual({ meetingPoint: point,
    meetingPointPhotoUrl: point.photoUrl, meetingPointPhotoAlt: point.photoAlt });
});
it('supports products without a photo and removes unsafe persisted photo URLs', () => {
  expect(meetingPointTemplateContext()).toMatchObject({ meetingPointPhotoUrl: '' });
  expect(meetingPointTemplateContext({ photoUrl: 'javascript:alert(1)' })).toMatchObject({ meetingPointPhotoUrl: '' });
});
it.each(['javascript:alert(1)', 'data:image/png;base64,xxx', '/private/local.png', 'https://user:password@example.com/a.jpg'])(
  'rejects unsafe photo URL %s', photoUrl => expect(() => validateMeetingPointPhoto({ photoUrl })).toThrow(),
);
it('allows removing a photo and saving a public URL', () => {
  expect(() => validateMeetingPointPhoto({ photoUrl: '' })).not.toThrow();
  expect(() => validateMeetingPointPhoto({ photoUrl: 'https://media.example.com/a.jpg' })).not.toThrow();
});
