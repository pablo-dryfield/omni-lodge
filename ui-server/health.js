const publicArtifactStatus = (artifactValidation) => Object.freeze({
  status: artifactValidation.status,
  validatedAt: artifactValidation.validatedAt,
  mainAsset: artifactValidation.mainAsset,
  assetCount: artifactValidation.assetCount,
  hashedAssetCount: artifactValidation.hashedAssetCount,
  pwaManifestCount: artifactValidation.pwaManifestCount,
});

export const createUiServerHealthHandler = ({
  release,
  artifactValidation,
  startedAt = new Date(),
  uptime = () => process.uptime(),
}) => {
  const responseBody = Object.freeze({
    status: 'ok',
    service: 'ui-server',
    release,
    startedAt: startedAt instanceof Date ? startedAt.toISOString() : String(startedAt),
    artifactValidation: publicArtifactStatus(artifactValidation),
  });

  return (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ...responseBody,
      uptimeSeconds: Math.max(0, Math.floor(uptime())),
    });
  };
};
