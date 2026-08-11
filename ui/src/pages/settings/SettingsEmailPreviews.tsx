import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Code,
  Grid,
  Group,
  Loader,
  NavLink,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconMail, IconRefresh, IconSearch } from "@tabler/icons-react";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import axiosInstance from "../../utils/axiosInstance";

type EmailPreview = {
  id: string;
  name: string;
  description: string;
  category: string;
  audience: string;
  source: "system" | "stored";
  isActive: boolean;
  subject: string;
  htmlBody: string | null;
  textBody: string;
  error: string | null;
};

type EmailPreviewGalleryResponse = {
  generatedAt: string;
  mocked: boolean;
  count: number;
  previews: EmailPreview[];
};

const extractErrorMessage = (error: unknown): string => {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof responseMessage === "string" && responseMessage.trim()) return responseMessage;
  return error instanceof Error ? error.message : "Failed to load email previews.";
};

const SettingsEmailPreviews = () => {
  const [previews, setPreviews] = useState<EmailPreview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [contentMode, setContentMode] = useState("html");
  const [viewport, setViewport] = useState("desktop");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axiosInstance.get<EmailPreviewGalleryResponse>("/bookings/emails/template-gallery", {
        withCredentials: true,
      });
      const nextPreviews = Array.isArray(response.data.previews) ? response.data.previews : [];
      setPreviews(nextPreviews);
      setSelectedId((current) =>
        current && nextPreviews.some((preview) => preview.id === current)
          ? current
          : nextPreviews[0]?.id ?? null,
      );
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(
    () => Array.from(new Set(previews.map((preview) => preview.category))).sort((a, b) => a.localeCompare(b)),
    [previews],
  );
  const filteredPreviews = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return previews.filter((preview) => {
      if (category !== "all" && preview.category !== category) return false;
      if (!normalizedQuery) return true;
      return [preview.name, preview.description, preview.subject, preview.category, preview.audience]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [category, previews, query]);
  const selected = previews.find((preview) => preview.id === selectedId) ?? null;

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.settingsControlPanel}>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="xs">
              <IconMail size={24} />
              <Title order={3}>Email preview library</Title>
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              Review the actual production email layouts using safe mocked booking information.
            </Text>
          </div>
          <Button leftSection={<IconRefresh size={16} />} variant="light" onClick={() => void load()} loading={loading}>
            Refresh previews
          </Button>
        </Group>

        <Alert color="blue" title="Preview only">
          These previews use Alex Morgan and mock booking references. Opening or refreshing this page never sends an email.
        </Alert>

        {error ? (
          <Alert color="red" title="Could not load email previews">
            <Stack gap="sm">
              <Text size="sm">{error}</Text>
              <Button size="xs" variant="light" color="red" onClick={() => void load()}>
                Try again
              </Button>
            </Stack>
          </Alert>
        ) : null}

        {loading && previews.length === 0 ? (
          <Center mih={320}>
            <Loader variant="dots" />
          </Center>
        ) : (
          <Grid gutter="lg" align="stretch">
            <Grid.Col span={{ base: 12, md: 4, lg: 3 }}>
              <Paper withBorder radius="lg" p="md" h="100%">
                <Stack gap="sm">
                  <TextInput
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="Search emails"
                    leftSection={<IconSearch size={16} />}
                  />
                  <Select
                    value={category}
                    onChange={(value) => setCategory(value ?? "all")}
                    data={[
                      { value: "all", label: `All formats (${previews.length})` },
                      ...categories.map((value) => ({
                        value,
                        label: `${value} (${previews.filter((preview) => preview.category === value).length})`,
                      })),
                    ]}
                  />
                  <Text size="xs" c="dimmed">
                    {filteredPreviews.length} {filteredPreviews.length === 1 ? "format" : "formats"}
                  </Text>
                  <ScrollArea h={620} offsetScrollbars type="auto">
                    <Stack gap={4} pr="xs">
                      {filteredPreviews.map((preview) => (
                        <NavLink
                          key={preview.id}
                          active={selectedId === preview.id}
                          label={preview.name}
                          description={`${preview.audience} · ${preview.category}`}
                          onClick={() => setSelectedId(preview.id)}
                          rightSection={!preview.isActive ? <Badge color="gray" size="xs">Inactive</Badge> : null}
                          styles={{ label: { whiteSpace: "normal" }, description: { whiteSpace: "normal" } }}
                        />
                      ))}
                      {filteredPreviews.length === 0 ? (
                        <Text size="sm" c="dimmed" ta="center" py="xl">
                          No email formats match this filter.
                        </Text>
                      ) : null}
                    </Stack>
                  </ScrollArea>
                </Stack>
              </Paper>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 8, lg: 9 }}>
              <Paper withBorder radius="lg" p={{ base: "sm", sm: "lg" }} h="100%">
                {selected ? (
                  <Stack gap="md">
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Title order={4}>{selected.name}</Title>
                        <Text size="sm" c="dimmed" mt={3}>{selected.description}</Text>
                      </div>
                      <Group gap="xs">
                        <Badge variant="light">{selected.audience}</Badge>
                        <Badge color={selected.source === "system" ? "violet" : "teal"} variant="light">
                          {selected.source === "system" ? "Built-in" : "Saved template"}
                        </Badge>
                        <Badge color={selected.isActive ? "green" : "gray"} variant="light">
                          {selected.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </Group>
                    </Group>

                    <Paper withBorder radius="md" p="sm" bg="gray.0">
                      <Text size="xs" fw={700} c="dimmed" tt="uppercase">Subject</Text>
                      <Text fw={600}>{selected.subject || "(No subject)"}</Text>
                    </Paper>

                    {selected.error ? (
                      <Alert color="red" title="This template could not be rendered">
                        {selected.error}
                      </Alert>
                    ) : (
                      <>
                        <Group justify="space-between">
                          <SegmentedControl
                            value={contentMode}
                            onChange={setContentMode}
                            data={[
                              { value: "html", label: "Email design" },
                              { value: "text", label: "Plain text" },
                            ]}
                          />
                          {contentMode === "html" ? (
                            <SegmentedControl
                              value={viewport}
                              onChange={setViewport}
                              data={[
                                { value: "desktop", label: "Desktop" },
                                { value: "mobile", label: "Mobile" },
                              ]}
                            />
                          ) : null}
                        </Group>

                        {contentMode === "html" ? (
                          selected.htmlBody ? (
                            <Box bg="gray.1" p={{ base: 4, sm: "md" }} style={{ overflowX: "auto", borderRadius: 12 }}>
                              <Box
                                w={viewport === "mobile" ? 390 : "100%"}
                                maw="100%"
                                mx="auto"
                                bg="white"
                                style={{ borderRadius: 8, overflow: "hidden", boxShadow: "0 6px 24px rgba(0,0,0,.08)" }}
                              >
                                <iframe
                                  title={`${selected.name} preview`}
                                  srcDoc={selected.htmlBody}
                                  sandbox=""
                                  referrerPolicy="no-referrer"
                                  style={{ width: "100%", height: 760, border: 0, display: "block", background: "white" }}
                                />
                              </Box>
                            </Box>
                          ) : (
                            <Alert color="gray" title="Plain-text template">
                              This saved template has no HTML design. Select Plain text to review its content.
                            </Alert>
                          )
                        ) : (
                          <Code block style={{ minHeight: 420, maxHeight: 760, overflow: "auto", whiteSpace: "pre-wrap" }}>
                            {selected.textBody || "(No plain-text body)"}
                          </Code>
                        )}
                      </>
                    )}
                  </Stack>
                ) : (
                  <Center mih={420}>
                    <Text c="dimmed">Select an email format to preview it.</Text>
                  </Center>
                )}
              </Paper>
            </Grid.Col>
          </Grid>
        )}
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsEmailPreviews;
