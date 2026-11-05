import { scanBookingBarcodeVideo, type BookingScannerControls } from '../../utils/bookingBarcodeCapture';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { CheckCircleOutline, Close, Refresh, WarningAmber } from '@mui/icons-material';
import type { BookingBarcodeReader } from '../../utils/bookingBarcodeProtocol';

export type BookingScanResult = {
  bookingId: string;
  kind: 'found' | 'checked_in' | 'not_found';
};

type Props = {
  onScan: (bookingId: string) => void;
  onClose: () => void;
  result: BookingScanResult | null;
  disabled?: boolean;
};

const cameraErrorMessage = (error: unknown): string => {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera access was blocked. Allow camera access for OmniLodge in your browser settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device. You can enter the booking number in the search bar.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is busy or unavailable. Close any other app using it, then try again.';
  }
  return 'The scanner could not start. Try again, or enter the booking number in the search bar.';
};

/** Inline, continuous scanning. Keep the camera live while staff use the results. */
const BookingBarcodeScanner = ({ onScan, onClose, result, disabled = false }: Props) => {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const lastBarcodeRef = useRef<{ code: string; lastSeenAt: number } | null>(null);

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) setPaused(true);
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, []);

  useEffect(() => {
    if (!videoElement || paused) return;
    let cancelled = false;
    let failed = false;
    let controls: BookingScannerControls | undefined;
    let reader: BookingBarcodeReader | undefined;
    let stream: MediaStream | undefined;
    let endedTrack: MediaStreamTrack | undefined;
    let playTimeout: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(playTimeout);
      controls?.stop();
      reader?.close();
      controls = undefined;
      if (endedTrack) endedTrack.removeEventListener('ended', onCameraEnded);
      stream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === stream) streamRef.current = null;
      if (videoElement.srcObject === stream) videoElement.srcObject = null;
    };
    const onCameraEnded = () => {
      if (cancelled || failed) return;
      failed = true;
      stop();
      setError('The camera disconnected. Reconnect it or try again.');
      setStatus('error');
    };
    const start = async () => {
      setStatus('starting');
      setError(null);
      setHint(null);
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('Camera scanning needs HTTPS or localhost. Open OmniLodge over a secure connection, or use the search bar.');
        setStatus('error');
        return;
      }
      try {
        // Load decoding code only when the user opens the scanner. Frames stay
        // in the browser; no image upload or external camera app is involved.
        const { createBookingBarcodeReader } = await import('../../utils/createBookingBarcodeReader');
        if (cancelled) return;
        reader = createBookingBarcodeReader();
        await reader.ready;
        if (cancelled) { stop(); return; }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stop();
          return;
        }
        streamRef.current = stream;
        endedTrack = stream.getVideoTracks()[0];
        endedTrack?.addEventListener('ended', onCameraEnded);
        // Optional focus controls must not prevent the camera from starting.
        try {
          const capabilities = endedTrack?.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
          if (capabilities?.focusMode?.includes('continuous')) {
            try { await endedTrack?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }); }
            catch { /* Unsupported focus controls must not stop scanning. */ }
          }
        } catch { /* Capability reporting is not supported by every browser. */ }
        if (cancelled) { stop(); return; }
        videoElement.srcObject = stream;
        await Promise.race([
          videoElement.play(),
          new Promise<never>((_, reject) => { playTimeout = setTimeout(() => reject(new Error('Camera playback timed out')), 8000); }),
        ]);
        clearTimeout(playTimeout);
        if (cancelled) { stop(); return; }

        const nextControls = scanBookingBarcodeVideo(videoElement, reader, (result, decodeError, scanControls) => {
          if (cancelled || failed) {
            scanControls.stop();
            return;
          }
          if (result) {
            const code = result.getText().trim();
            const bookingId = Number(code);
            if (!/^\d+$/.test(code) || !Number.isSafeInteger(bookingId) || bookingId <= 0) {
              setHint('Use the booking barcode from the OmniLodge confirmation email.');
              return;
            }
            const normalizedCode = String(bookingId);
            const now = performance.now();
            const previous = lastBarcodeRef.current;
            // A ticket held in view should update search once, not repeatedly
            // overwrite staff input or trigger an alert after they check it in.
            // Re-arm the same ticket after it has left detection for 2 seconds;
            // a different ticket is accepted immediately.
            const repeated = previous?.code === normalizedCode && now - previous.lastSeenAt < 2000;
            if (previous?.code === normalizedCode) previous.lastSeenAt = now;
            if (disabledRef.current || repeated) return;
            lastBarcodeRef.current = { code: normalizedCode, lastSeenAt: now };
            setHint(null);
            onScanRef.current(normalizedCode);
          } else if (decodeError) {
            failed = true;
            scanControls.stop();
            stop();
            setError('The camera preview was interrupted. Try scanning again.');
            setStatus('error');
          }
        });
        controls = nextControls;
        if (cancelled || failed) {
          stop();
          return;
        }
        setStatus('scanning');
      } catch (cause) {
        stop();
        if (!cancelled && !failed) {
          setError(cameraErrorMessage(cause));
          setStatus('error');
        }
      }
    };
    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [videoElement, attempt, paused]);

  const retry = () => {
    setPaused(false);
    setAttempt((value) => value + 1);
  };

  const previewLive = status === 'scanning' && !paused;
  const resultLabel = result
    ? `Last scan: #${result.bookingId}${result.kind === 'checked_in' ? ' already checked in' : result.kind === 'not_found' ? ' not found' : ' selected'}`
    : null;
  const overlayControlSx = {
    color: '#fff', width: 44, height: 44, bgcolor: 'rgba(8,13,22,.8)',
    '&:hover': { bgcolor: 'rgba(8,13,22,.95)' },
    '&.Mui-disabled': { color: '#94a3b8', bgcolor: 'rgba(8,13,22,.8)' },
    '&.Mui-focusVisible': { outline: '2px solid #74c0fc', outlineOffset: 2 },
  };
  return (
    <Box component="section" aria-label="Booking scanner" sx={{
      position: 'relative', height: { xs: 180, sm: 200 },
      bgcolor: '#080d16', color: '#fff', borderRadius: 3, overflow: 'hidden',
    }}>
      <Box component="video" ref={setVideoElement} autoPlay playsInline muted
        aria-label="Live camera preview"
        sx={{ width: '100%', height: '100%', objectFit: 'cover', opacity: previewLive ? 1 : 0 }} />
      <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}>
        <Tooltip title="Close scanner">
          <IconButton aria-label="Close scanner" onClick={onClose} sx={overlayControlSx}><Close /></IconButton>
        </Tooltip>
      </Box>
      {previewLive && (
        <Box aria-hidden="true" sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <Box sx={{ width: 'min(82%, 500px)', height: '40%', minHeight: 60,
            border: '3px solid #74c0fc', borderRadius: 3, boxShadow: '0 0 0 9999px rgba(0,0,0,.4)' }} />
        </Box>
      )}
      {previewLive && (result || hint || disabled) && <Stack direction="row" spacing={1} alignItems="center"
        sx={{ position: 'absolute', bottom: 8, left: 12, right: 12, width: 'fit-content', maxWidth: 'calc(100% - 24px)',
          mx: 'auto', px: 1.5, py: 0.75, borderRadius: 2, bgcolor: 'rgba(8,13,22,.9)', pointerEvents: 'none' }}>
        {result && !disabled && (result.kind === 'found'
          ? <CheckCircleOutline sx={{ color: '#69db7c', fontSize: 20 }} />
          : <WarningAmber sx={{ color: '#ffd43b', fontSize: 20 }} />)}
        <Typography variant="caption" fontWeight={result ? 700 : 400} role="status">
          {disabled ? 'Scanning paused' : resultLabel ?? hint}
        </Typography>
      </Stack>}
      {!previewLive && (
        <Box sx={{ position: 'absolute', inset: 0, overflowY: 'auto', p: 1.5, pt: 7 }}>
          <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ minHeight: '100%', textAlign: 'center' }}>
            {paused ? <>
              <Typography variant="h6">Camera paused</Typography>
              <Button variant="contained" onClick={retry} startIcon={<Refresh />}>Resume camera</Button>
            </> : status === 'starting' ? <>
              <CircularProgress size={24} sx={{ color: '#74c0fc' }} />
              <Typography role="status">Starting camera… Allow access when your browser asks.</Typography>
            </> : <>
              <Alert severity="warning" sx={{ maxWidth: 480, textAlign: 'left' }}>{error}</Alert>
              <Button variant="contained" onClick={retry} startIcon={<Refresh />}>Try again</Button>
            </>}
          </Stack>
        </Box>
      )}
    </Box>
  );
};

export default BookingBarcodeScanner;
