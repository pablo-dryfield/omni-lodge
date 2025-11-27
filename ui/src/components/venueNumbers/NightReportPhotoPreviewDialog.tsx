import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  Box,
  Button,
  Dialog,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { Close, Download, ZoomIn, ZoomOut } from "@mui/icons-material";
import type { NightReportPhotoPreview } from "../../utils/nightReportPhotoUtils";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

const clampZoom = (value: number) => Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);

type Props = {
  preview: NightReportPhotoPreview | null;
  onClose: () => void;
};

const NightReportPhotoPreviewDialog = ({ preview, onClose }: Props) => {
  const [photoZoom, setPhotoZoom] = useState(1);

  useEffect(() => {
    if (preview) {
      setPhotoZoom(1);
    }
  }, [preview]);

  const capturedAtLabel = useMemo(() => {
    if (!preview?.capturedAt) {
      return null;
    }
    return dayjs(preview.capturedAt).format("MMM D, YYYY h:mm A");
  }, [preview?.capturedAt]);

  const zoomInDisabled = photoZoom >= MAX_ZOOM - 0.001;
  const zoomOutDisabled = photoZoom <= MIN_ZOOM + 0.001;

  const handleZoomIn = useCallback(() => {
    setPhotoZoom((prev) => clampZoom(prev + 0.1));
  }, []);

  const handleZoomOut = useCallback(() => {
    setPhotoZoom((prev) => clampZoom(prev - 0.1));
  }, []);

  const handleZoomReset = useCallback(() => {
    setPhotoZoom(1);
  }, []);

  const handlePhotoWheelZoom = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    setPhotoZoom((prev) => clampZoom(prev + delta));
  }, []);

  if (!preview) {
    return null;
  }

  return (
    <Dialog open onClose={onClose} fullScreen PaperProps={{ sx: { bgcolor: "black" } }}>
      <Box
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          bgcolor: "black",
          color: "common.white",
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={2}
          sx={{ px: { xs: 2, md: 4 }, py: 2 }}
        >
          <Box>
            <Typography variant="subtitle1" fontWeight={600} noWrap>
              {preview.name}
            </Typography>
            {capturedAtLabel && (
              <Typography variant="body2" color="grey.400">
                {capturedAtLabel}
              </Typography>
            )}
          </Box>
          <IconButton
            onClick={onClose}
            aria-label="Close photo preview"
            sx={{
              color: "common.white",
              bgcolor: "rgba(255,255,255,0.1)",
              "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
            }}
          >
            <Close />
          </IconButton>
        </Stack>
        <Box
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "auto",
            px: { xs: 2, md: 6 },
            pb: 6,
          }}
          onWheel={handlePhotoWheelZoom}
        >
          <Box
            component="img"
            src={preview.src}
            alt={preview.name}
            sx={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              transform: `scale(${photoZoom})`,
              transformOrigin: "center",
              transition: "transform 120ms ease",
              userSelect: "none",
            }}
          />
        </Box>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: { xs: 2, md: 4 }, pb: { xs: 3, md: 4 } }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <Tooltip title="Zoom out">
              <span>
                <IconButton
                  onClick={handleZoomOut}
                  aria-label="Zoom out"
                  disabled={zoomOutDisabled}
                  sx={{
                    color: "common.white",
                    bgcolor: "rgba(255,255,255,0.1)",
                    "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
                  }}
                >
                  <ZoomOut />
                </IconButton>
              </span>
            </Tooltip>
            <Typography variant="body2" fontWeight={600}>
              {Math.round(photoZoom * 100)}%
            </Typography>
            <Tooltip title="Zoom in">
              <span>
                <IconButton
                  onClick={handleZoomIn}
                  aria-label="Zoom in"
                  disabled={zoomInDisabled}
                  sx={{
                    color: "common.white",
                    bgcolor: "rgba(255,255,255,0.1)",
                    "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
                  }}
                >
                  <ZoomIn />
                </IconButton>
              </span>
            </Tooltip>
            <Button variant="text" color="inherit" onClick={handleZoomReset}>
              Reset
            </Button>
          </Stack>
          {preview.downloadHref && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<Download />}
              component="a"
              href={preview.downloadHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              Download
            </Button>
          )}
        </Stack>
      </Box>
    </Dialog>
  );
};

export default NightReportPhotoPreviewDialog;
