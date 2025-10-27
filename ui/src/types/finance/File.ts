export interface FinanceFile {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  driveFileId: string;
  driveWebViewLink: string;
  sha256: string;
  uploadedBy: number;
  uploadedAt: string;
}

