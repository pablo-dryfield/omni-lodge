import { useMemo, useState } from "react";
import { Alert, Anchor, Badge, Button, Card, Code, Group, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconBrandGoogle, IconCheck, IconRefresh, IconX } from "@tabler/icons-react";
import { useSearchParams } from "react-router-dom";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import {
  useGoogleApiAccess,
  useGoogleOAuthScopeCatalog,
  useStartGoogleOAuthAuthorization,
  type GoogleCredentialKey,
} from "../../api/googleApi";

const PAGE_SLUG = PAGE_SLUGS.settingsGoogleApi;

const CREDENTIAL_LABELS: Record<GoogleCredentialKey, string> = {
  GOOGLE_CLIENT_ID: "Client ID",
  GOOGLE_CLIENT_SECRET: "Client secret",
  GOOGLE_REFRESH_TOKEN: "Refresh token",
};

const SCOPE_LABELS: Record<string, { label: string; description: string }> = {
  "https://mail.google.com/": {
    label: "Gmail mailbox",
    description: "Full Gmail mailbox access.",
  },
  "https://www.googleapis.com/auth/gmail.send": {
    label: "Gmail send",
    description: "Send email through Gmail.",
  },
  "https://www.googleapis.com/auth/drive": {
    label: "Google Drive",
    description: "Full Google Drive file access.",
  },
  "https://www.googleapis.com/auth/business.manage": {
    label: "Business Profile",
    description: "Manage Google Business Profile data.",
  },
  "https://www.googleapis.com/auth/adwords": {
    label: "Google Ads",
    description: "Access Google Ads API data.",
  },
  "https://www.googleapis.com/auth/analytics.readonly": {
    label: "Google Analytics",
    description: "Read Google Analytics data.",
  },
};

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const data = (error as { response?: { data?: unknown } }).response?.data;
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      if (first && typeof first === "object" && typeof (first as { message?: unknown }).message === "string") {
        return (first as { message: string }).message;
      }
    }
    if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
      return (data as { message: string }).message;
    }
    if (typeof data === "string") {
      return data;
    }
  }
  return error instanceof Error ? error.message : "Failed to load Google API access.";
};

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return "Unknown";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }
  return parsed.toLocaleString();
};

const SettingsGoogleApi = () => {
  const [searchParams] = useSearchParams();
  const accessQuery = useGoogleApiAccess();
  const scopeCatalogQuery = useGoogleOAuthScopeCatalog();
  const startOAuthAuthorization = useStartGoogleOAuthAuthorization();
  const access = accessQuery.data ?? null;
  const catalog = scopeCatalogQuery.data ?? null;
  const [scopeSearch, setScopeSearch] = useState("");
  const [selectedApi, setSelectedApi] = useState<string | null>(null);
  const [selectedAdditionalScopes, setSelectedAdditionalScopes] = useState<string[]>([]);
  const [authorizationError, setAuthorizationError] = useState<string | null>(null);
  const currentScopeSet = useMemo(() => new Set(access?.scopes ?? []), [access?.scopes]);
  const selectedAdditionalScopeSet = useMemo(() => new Set(selectedAdditionalScopes), [selectedAdditionalScopes]);
  const scopeMetaByScope = useMemo(() => {
    const map = new Map<string, { api: string; description: string }>();
    (catalog?.scopes ?? []).forEach((entry) => {
      if (!map.has(entry.scope)) {
        map.set(entry.scope, { api: entry.api, description: entry.description });
      }
    });
    return map;
  }, [catalog?.scopes]);
  const apiOptions = useMemo(() => {
    const apis = new Set((catalog?.scopes ?? []).map((scope) => scope.api).filter(Boolean));
    return Array.from(apis)
      .sort((left, right) => left.localeCompare(right))
      .map((api) => ({ value: api, label: api }));
  }, [catalog?.scopes]);
  const filteredCatalogScopes = useMemo(() => {
    const term = scopeSearch.trim().toLowerCase();
    return (catalog?.scopes ?? []).filter((entry) => {
      if (selectedApi && entry.api !== selectedApi) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        entry.api.toLowerCase().includes(term) ||
        entry.scope.toLowerCase().includes(term) ||
        entry.description.toLowerCase().includes(term)
      );
    });
  }, [catalog?.scopes, scopeSearch, selectedApi]);

  const handleRefresh = () => {
    accessQuery.refetch();
    scopeCatalogQuery.refetch();
  };

  const addScope = (scope: string) => {
    if (currentScopeSet.has(scope)) {
      return;
    }
    setSelectedAdditionalScopes((current) => (current.includes(scope) ? current : [...current, scope].sort()));
  };

  const removeScope = (scope: string) => {
    setSelectedAdditionalScopes((current) => current.filter((entry) => entry !== scope));
  };

  const handleAuthorizeScopes = async () => {
    setAuthorizationError(null);
    const scopes = Array.from(new Set([...(access?.scopes ?? []), ...selectedAdditionalScopes])).sort();
    if (scopes.length === 0 || selectedAdditionalScopes.length === 0) {
      setAuthorizationError("Select at least one new scope to authorize.");
      return;
    }

    try {
      const returnUrl = `${window.location.origin}${window.location.pathname}`;
      const result = await startOAuthAuthorization.mutateAsync({ scopes, returnUrl });
      window.location.href = result.authorizationUrl;
    } catch (error) {
      setAuthorizationError(extractErrorMessage(error));
    }
  };

  const oauthStatus = searchParams.get("googleOAuth");

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Stack gap={6}>
            <Group gap="xs">
              <IconBrandGoogle size={24} />
              <Title order={3}>Google API</Title>
            </Group>
            <Text size="sm" c="dimmed">
              Current OAuth access granted to the configured Google refresh token.
            </Text>
          </Stack>
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            onClick={handleRefresh}
            loading={accessQuery.isFetching || scopeCatalogQuery.isFetching}
          >
            Refresh
          </Button>
        </Group>

        {accessQuery.isError ? (
          <Alert color="red" icon={<IconAlertCircle size={16} />} title="Unable to inspect Google access">
            {extractErrorMessage(accessQuery.error)}
          </Alert>
        ) : null}

        {scopeCatalogQuery.isError ? (
          <Alert color="red" icon={<IconAlertCircle size={16} />} title="Unable to load Google scope catalog">
            {extractErrorMessage(scopeCatalogQuery.error)}
          </Alert>
        ) : null}

        {access && access.missingKeys.length > 0 ? (
          <Alert color="yellow" icon={<IconAlertCircle size={16} />} title="Google OAuth credentials incomplete">
            Missing {access.missingKeys.map((key) => CREDENTIAL_LABELS[key]).join(", ")}.
          </Alert>
        ) : null}

        {oauthStatus === "success" ? (
          <Alert color="green" icon={<IconCheck size={16} />} title="Google OAuth complete">
            Refresh token updated. Google granted {searchParams.get("scopeCount") ?? "the selected"} scope
            {searchParams.get("scopeCount") === "1" ? "" : "s"}.
            {searchParams.get("missingScopeCount") && searchParams.get("missingScopeCount") !== "0"
              ? ` ${searchParams.get("missingScopeCount")} requested scope(s) were not returned exactly by Google.`
              : ""}
          </Alert>
        ) : null}

        {authorizationError ? (
          <Alert color="red" icon={<IconAlertCircle size={16} />} title="Unable to start Google authorization">
            {authorizationError}
          </Alert>
        ) : null}

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Stack gap={4}>
                <Text fw={600}>OAuth credentials</Text>
                <Text size="sm" c="dimmed">
                  Secret values stay on the backend.
                </Text>
              </Stack>
              {access ? (
                <Badge color={access.missingKeys.length === 0 ? "green" : "red"} variant="light">
                  {access.missingKeys.length === 0 ? "Configured" : "Incomplete"}
                </Badge>
              ) : null}
            </Group>
            <Group gap="sm" wrap="wrap">
              {(Object.keys(CREDENTIAL_LABELS) as GoogleCredentialKey[]).map((key) => {
                const configured = access?.configured[key];
                return (
                  <Badge
                    key={key}
                    color={configured == null ? "gray" : configured ? "green" : "red"}
                    variant="light"
                    leftSection={
                      configured == null ? undefined : configured ? <IconCheck size={12} /> : <IconX size={12} />
                    }
                  >
                    {CREDENTIAL_LABELS[key]}
                  </Badge>
                );
              })}
            </Group>
          </Stack>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Stack gap={4}>
                <Text fw={600}>Added scopes</Text>
                <Text size="sm" c="dimmed">
                  Select scopes from the catalog, then authorize them through Google.
                </Text>
              </Stack>
              <Badge variant="light">{selectedAdditionalScopes.length} added</Badge>
            </Group>

            {selectedAdditionalScopes.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <Table withTableBorder withColumnBorders striped style={{ minWidth: 820 }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>API</Table.Th>
                      <Table.Th>Scope</Table.Th>
                      <Table.Th>Action</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {selectedAdditionalScopes.map((scope) => {
                      const meta = scopeMetaByScope.get(scope);
                      return (
                        <Table.Tr key={scope}>
                          <Table.Td>
                            <Stack gap={2}>
                              <Text fw={600} size="sm">
                                {meta?.api ?? "Unknown API"}
                              </Text>
                              {meta?.description ? (
                                <Text size="xs" c="dimmed">
                                  {meta.description}
                                </Text>
                              ) : null}
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Code>{scope}</Code>
                          </Table.Td>
                          <Table.Td>
                            <Button size="xs" variant="subtle" color="red" onClick={() => removeScope(scope)}>
                              Remove
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </div>
            ) : (
              <Text size="sm" c="dimmed">
                No new scopes selected.
              </Text>
            )}

            <Group justify="flex-end">
              <Button
                leftSection={<IconBrandGoogle size={16} />}
                onClick={handleAuthorizeScopes}
                loading={startOAuthAuthorization.isPending}
                disabled={selectedAdditionalScopes.length === 0}
              >
                Save and authorize selected scopes
              </Button>
            </Group>
          </Stack>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Stack gap={4}>
                <Text fw={600}>Current scopes</Text>
                <Text size="sm" c="dimmed">
                  Returned by Google tokeninfo for a fresh access token from the configured refresh token.
                </Text>
              </Stack>
              <Badge variant="light">{access?.scopes.length ?? 0} scopes</Badge>
            </Group>

            {accessQuery.isLoading ? (
              <Text size="sm" c="dimmed">
                Loading Google API access...
              </Text>
            ) : access && access.scopes.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 820 }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Service</Table.Th>
                      <Table.Th>Scope</Table.Th>
                      <Table.Th>Description</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {access.scopes.map((scope) => {
                      const meta = SCOPE_LABELS[scope] ?? {
                        label: "Unmapped scope",
                        description: "Google returned this scope, but OmniLodge does not have a label for it yet.",
                      };
                      return (
                        <Table.Tr key={scope}>
                          <Table.Td>
                            <Text fw={600} size="sm">
                              {meta.label}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Code>{scope}</Code>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{meta.description}</Text>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </div>
            ) : (
              <Text size="sm" c="dimmed">
                No scopes were returned.
              </Text>
            )}

            {access ? (
              <Group gap="xs" wrap="wrap">
                <Badge variant="outline">Refreshed {formatDateTime(access.refreshedAt)}</Badge>
                <Badge variant="outline">Expires {formatDateTime(access.expiresAt)}</Badge>
                {access.audience ? <Badge variant="outline">Audience {access.audience}</Badge> : null}
              </Group>
            ) : null}
          </Stack>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Stack gap={4}>
                <Text fw={600}>Available Google scopes</Text>
                <Text size="sm" c="dimmed">
                  Full catalog from Google's OAuth 2.0 scopes documentation.
                </Text>
              </Stack>
              <Badge variant="light">{catalog?.scopes.length ?? 0} total</Badge>
            </Group>

            {catalog ? (
              <Text size="xs" c="dimmed">
                Source:{" "}
                <Anchor href={catalog.sourceUrl} target="_blank" rel="noreferrer">
                  Google OAuth 2.0 Scopes for Google APIs
                </Anchor>{" "}
                · Fetched {formatDateTime(catalog.fetchedAt)}
              </Text>
            ) : null}

            <Group align="flex-end" wrap="wrap">
              <TextInput
                label="Search scopes"
                placeholder="Search API, scope URL, or description"
                value={scopeSearch}
                onChange={(event) => setScopeSearch(event.currentTarget.value)}
                style={{ flex: "1 1 320px" }}
              />
              <Select
                label="API"
                placeholder="All APIs"
                data={apiOptions}
                value={selectedApi}
                onChange={setSelectedApi}
                searchable
                clearable
                nothingFoundMessage="No APIs found"
                style={{ flex: "1 1 280px" }}
              />
            </Group>

            {scopeCatalogQuery.isLoading ? (
              <Text size="sm" c="dimmed">
                Loading Google's scope catalog...
              </Text>
            ) : filteredCatalogScopes.length > 0 ? (
              <Stack gap="xs">
                <Text size="sm" c="dimmed">
                  Showing {filteredCatalogScopes.length} scope{filteredCatalogScopes.length === 1 ? "" : "s"}.
                </Text>
                <div style={{ overflowX: "auto" }}>
                  <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 1000 }}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>API</Table.Th>
                        <Table.Th>Scope</Table.Th>
                        <Table.Th>Description</Table.Th>
                        <Table.Th>Status</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {filteredCatalogScopes.map((entry) => {
                        const isGranted = currentScopeSet.has(entry.scope);
                        const isSelected = selectedAdditionalScopeSet.has(entry.scope);
                        return (
                          <Table.Tr key={`${entry.api}-${entry.version ?? ""}-${entry.scope}`}>
                            <Table.Td>
                              <Stack gap={2}>
                                {entry.documentationUrl ? (
                                  <Anchor href={entry.documentationUrl} target="_blank" rel="noreferrer" size="sm" fw={600}>
                                    {entry.api}
                                  </Anchor>
                                ) : (
                                  <Text fw={600} size="sm">
                                    {entry.api}
                                  </Text>
                                )}
                                {entry.version ? (
                                  <Text size="xs" c="dimmed">
                                    {entry.version}
                                  </Text>
                                ) : null}
                              </Stack>
                            </Table.Td>
                            <Table.Td>
                              <Code>{entry.scope}</Code>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm">{entry.description}</Text>
                            </Table.Td>
                            <Table.Td>
                              {isGranted ? (
                                <Badge color="green" variant="light" leftSection={<IconCheck size={12} />}>
                                  Granted
                                </Badge>
                              ) : isSelected ? (
                                <Button size="xs" variant="light" color="red" onClick={() => removeScope(entry.scope)}>
                                  Remove
                                </Button>
                              ) : (
                                <Button size="xs" variant="light" onClick={() => addScope(entry.scope)}>
                                  Add
                                </Button>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </div>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                No scopes match your filters.
              </Text>
            )}
          </Stack>
        </Card>
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsGoogleApi;
