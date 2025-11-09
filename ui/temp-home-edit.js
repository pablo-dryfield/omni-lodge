const fs = require("fs");
const path = "src/pages/Home.tsx";
const abs = require("path").resolve(process.cwd(), path);
const content = fs.readFileSync(abs, "utf8");
const lines = content.split(/\r?\n/);
const targetPhrase = "Choose between the navigation tiles or a dashboard-focused start page.";
const phraseIndex = lines.findIndex((line) => line.includes(targetPhrase));
if (phraseIndex === -1) {
  throw new Error("Target phrase not found");
}
let startIndex = phraseIndex;
while (startIndex >= 0 && !lines[startIndex].includes("<Stack gap={2}>") ) {
  startIndex--;
}
if (startIndex < 0) {
  throw new Error("Start <Stack> not found");
}
let depth = 0;
let endIndex = startIndex;
for (let i = startIndex; i < lines.length; i++) {
  const line = lines[i];
  const openMatches = line.match(/<Stack/g);
  if (openMatches) {
    depth += openMatches.length;
  }
  const closeMatches = line.match(/<\/Stack>/g);
  if (closeMatches) {
    depth -= closeMatches.length;
    if (depth === 0) {
      endIndex = i;
      break;
    }
  }
}
if (depth !== 0) {
  throw new Error("Failed to find closing </Stack>");
}
const replacement = `            <Stack gap={2}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                alignItems={{ xs: "flex-start", md: "center" }}
                justifyContent="space-between"
                gap={2}
              >
                <Stack gap={0.5}>
                  <Typography variant="h6">Home experience</Typography>
                  <Typography variant="body2" color="textSecondary">
                    Your administrator controls whether Home opens in navigation or dashboards mode.
                  </Typography>
                </Stack>
              </Stack>
              {homePreferenceQuery.isLoading && (
                <Stack direction="row" alignItems="center" gap={1}>
                  <CircularProgress size={18} />
                  <Typography variant="body2" color="textSecondary">
                    Loading your preference...
                  </Typography>
                </Stack>
              )}
              {homePreferenceQuery.error && (
                <Alert severity="error">
                  {getErrorMessage(homePreferenceQuery.error, "Failed to load home preference.")}
                </Alert>
              )}
              {!homePreferenceQuery.isLoading && !homePreferenceQuery.error && (
                <Stack gap={2}>
                  <Typography variant="body2" color="textSecondary">
                    Default experience:{' '}
                    <strong>{effectiveViewMode === "dashboard" ? "Dashboards" : "Navigation"}</strong>
                  </Typography>
                  <Stack direction={{ xs: "column", sm: "row" }} gap={1}>
                    <Button component={RouterLink} to="/settings/home-experience" variant="outlined">
                      Open Home Experience settings
                    </Button>
                    <Button component={RouterLink} to="/reports/dashboards" variant="text">
                      Manage dashboards workspace
                    </Button>
                  </Stack>
                  {canUseDashboards && (
                    <>
                      <Divider />
                      <Stack gap={1}>
                        <Typography variant="subtitle2">Pinned dashboards</Typography>
                        {savedDashboardSummaries.length === 0 ? (
                          <Typography variant="body2" color="textSecondary">
                            No dashboards assigned to this user.
                          </Typography>
                        ) : (
                          <Stack direction="row" flexWrap="wrap" gap={1}>
                            {savedDashboardSummaries.map((dashboard) => (
                              <Chip
                                key={dashboard.id}
                                label={dashboard.name}
                                color={dashboard.id === activeDashboardId ? "primary" : "default"}
                                variant={dashboard.id === activeDashboardId ? "filled" : "outlined"}
                                sx={{ textTransform: "none" }}
                              />
                            ))}
                          </Stack>
                        )}
                      </Stack>
                    </>
                  )}
                </Stack>
              )}
            </Stack>`;
lines.splice(startIndex, endIndex - startIndex + 1, ...replacement.split("\n"));
fs.writeFileSync(abs, lines.join("\n"));
