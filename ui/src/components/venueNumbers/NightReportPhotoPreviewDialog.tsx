import { Dialog } from "@mui/material";
import type { NightReportPhotoPreview } from "../../utils/nightReportPhotoUtils";
import NightReportPhotoPreviewPanel from "./NightReportPhotoPreviewPanel";

type Props = {
  preview: NightReportPhotoPreview | null;
  onClose: () => void;
};

const NightReportPhotoPreviewDialog = ({ preview, onClose }: Props) => {
  if (!preview) {
    return null;
  }

  return (
    <Dialog open onClose={onClose} fullScreen PaperProps={{ sx: { bgcolor: "black" } }}>
      <NightReportPhotoPreviewPanel preview={preview} onClose={onClose} showCloseButton />
    </Dialog>
  );
};

export default NightReportPhotoPreviewDialog;
