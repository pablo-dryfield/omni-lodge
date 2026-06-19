import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { Box, Button, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { Close, Download, ZoomIn, ZoomOut } from "@mui/icons-material";
import type { NightReportPhotoPreview } from "../../utils/nightReportPhotoUtils";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

const clampZoom = (value: number): number => Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);

type Props = {
  preview: NightReportPhotoPreview | null;
  onClose?: () => void;
  showCloseButton?: boolean;
  showDownloadButton?: boolean;
  showFileInfo?: boolean;
  compactHeader?: boolean;
  className?: string;
  bodyMinHeight?: number | string;
};

const NightReportPhotoPreviewPanel = ({
  preview,
  onClose,
  showCloseButton = false,
  showDownloadButton = true,
  showFileInfo = true,
  compactHeader = false,
  className,
  bodyMinHeight = 480,
}: Props) => {
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
  const isPdfPreview = (preview?.mimeType ?? "").toLowerCase().includes("pdf");
  const isImagePreview = !isPdfPreview;
  const showHeaderRow = showFileInfo || (showCloseButton && Boolean(onClose));

  const handleZoomIn = useCallback(() => {
    setPhotoZoom((prev) => clampZoom(prev + 0.1));
  }, []);

  const handleZoomOut = useCallback(() => {
    setPhotoZoom((prev) => clampZoom(prev - 0.1));
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
    <Box
      className={className}
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "black",
        color: "common.white",
      }}
    >
      {showHeaderRow ? (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={2}
          sx={{ px: { xs: 2, md: 4 }, py: compactHeader ? 1.25 : 2 }}
        >
          {showFileInfo ? (
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
          ) : (
            <Box />
          )}
          {showCloseButton && onClose ? (
            <IconButton
              onClick={onClose}
              aria-label="Close file preview"
              sx={{
                color: "common.white",
                bgcolor: "rgba(255,255,255,0.1)",
                "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
              }}
            >
              <Close />
            </IconButton>
          ) : (
            <Box />
          )}
        </Stack>
      ) : null}
      <Box
        sx={{
          flex: 1,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "auto",
          px: { xs: 2, md: 6 },
          pb: showDownloadButton && preview.downloadHref ? 10 : 0,
        }}
        onWheel={isImagePreview ? handlePhotoWheelZoom : undefined}
      >
        {isPdfPreview ? (
          <Box
            sx={{
              width: "100%",
              height: "100%",
              minHeight: bodyMinHeight,
              bgcolor: "common.white",
              borderRadius: 1,
              overflow: "hidden",
            }}
          >
            <Box
              component="iframe"
              src={preview.src}
              title={preview.name}
              sx={{
                width: "100%",
                height: "100%",
                border: 0,
              }}
            />
          </Box>
        ) : (
          <Box
            sx={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              minHeight: bodyMinHeight,
            }}
          >
            <Box
              component="img"
              src={preview.src}
              alt={preview.name}
              sx={{
                position: "absolute",
                top: "50%",
                left: "50%",
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                transform: `translate(-50%, -50%) scale(${photoZoom})`,
                transformOrigin: "center",
                transition: "transform 120ms ease",
                userSelect: "none",
              }}
            />
          </Box>
        )}
        {isImagePreview ? (
          <Box
            sx={{
              position: "absolute",
              left: "50%",
              bottom: 24,
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1.5,
              py: 1,
              borderRadius: 999,
              bgcolor: "rgba(0,0,0,0.38)",
              backdropFilter: "blur(6px)",
            }}
          >
            <Tooltip title="Zoom out">
              <span>
                <IconButton
                  onClick={handleZoomOut}
                  aria-label="Zoom out"
                  disabled={zoomOutDisabled}
                  sx={{
                    color: "common.white",
                    bgcolor: "rgba(255,255,255,0.06)",
                    "&:hover": { bgcolor: "rgba(255,255,255,0.14)" },
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
                    bgcolor: "rgba(255,255,255,0.06)",
                    "&:hover": { bgcolor: "rgba(255,255,255,0.14)" },
                  }}
                >
                  <ZoomIn />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        ) : null}
      </Box>
      {showDownloadButton && preview.downloadHref ? (
        <Box sx={{ px: { xs: 2, md: 4 }, pb: { xs: 3, md: 4 } }}>
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
        </Box>
      ) : null}
    </Box>
  );
};

export default NightReportPhotoPreviewPanel;
