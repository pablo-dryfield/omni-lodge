import { ChangeEvent, useEffect, useMemo, useState } from "react";

import {

  Alert,

  Badge,

  Box,

  Button,

  Divider,

  Flex,

  Group,

  Loader,

  Paper,

  Select,

  Stack,

  Table,

  Text,

  Title,

} from "@mantine/core";

import { useMediaQuery } from '@mantine/hooks';

import { IconArrowLeft, IconArrowRight, IconCalendar, IconRefresh } from "@tabler/icons-react";

import dayjs, { Dayjs } from "dayjs";

import { useSearchParams } from "react-router-dom";

import { useAppDispatch } from "../store/hooks";

import { navigateToPage } from "../actions/navigationActions";

import { GenericPageProps } from "../types/general/GenericPageProps";

import { PageAccessGuard } from "../components/access/PageAccessGuard";

import { PAGE_SLUGS } from "../constants/pageSlugs";

import { useModuleAccess } from "../hooks/useModuleAccess";

import axiosInstance from "../utils/axiosInstance";

import { UnifiedOrder, OrderExtras } from "../store/bookingPlatformsTypes";



const DATE_FORMAT = "YYYY-MM-DD";

const MANIFEST_MODULE = "booking-manifest";

const toWhatsAppLink = (raw?: string) => {
  if (!raw) return null;

  // Keep digits and '+' only
  let s = raw.trim().replace(/[^\d+]/g, '');

  // Convert '00' prefix to '+'
  if (s.startsWith('00')) s = '+' + s.slice(2);

  // Handle UK numbers that start with 07 -> +44 (drop the 0)
  if (s.startsWith('07')) {
    s = '+44' + s.slice(1);
  } else if (s.startsWith('44')) {
    // If someone typed '44...' without '+'
    s = '+44' + s.slice(2);
  } else if (!s.startsWith('+')) {
    // If no '+' is present at all, add it (user requirement)
    s = '+' + s;
  }

  // wa.me requires digits only (no '+', no symbols)
  const href = `https://wa.me/${s.replace(/^\+/, '')}`;
  return { display: s, href };
};

type ManifestGroup = {
  productId: string;
  productName: string;
  date: string;
  time: string;
  totalPeople: number;
  men: number;
  women: number;
  extras: OrderExtras;
  orders: UnifiedOrder[];
};



type ManifestSummary = {
  totalPeople: number;
  men: number;
  women: number;
  totalOrders: number;
  extras: OrderExtras;
};



type ManifestResponse = {
  date: string;
  manifest: ManifestGroup[];
  orders: UnifiedOrder[];
  summary?: ManifestSummary;
};



type FetchStatus = "idle" | "loading" | "success" | "error";



type SelectOption = {

  value: string;

  label: string;

};



const deriveDate = (value: string | null): Dayjs => {

  if (!value) {

    return dayjs().startOf("day");

  }



  const parsed = dayjs(value);

  return parsed.isValid() ? parsed.startOf("day") : dayjs().startOf("day");

};



const deriveGroupKey = (productId: string | null, time: string | null): string => {

  if (productId && time) {

    return `${productId}|${time}`;

  }

  return "all";

};



const manifestToOptions = (groups: ManifestGroup[]): SelectOption[] => {

  return groups.map((group) => ({

    value: `${group.productId}|${group.time}`,

    label: `${group.productName} @ ${group.time}`,

  }));

};

const formatAddonValue = (value?: number): string => {
  return value && value > 0 ? String(value) : '';
};

const BookingsManifestPage = ({ title }: GenericPageProps) => {

  const dispatch = useAppDispatch();

  const [searchParams, setSearchParams] = useSearchParams();

  const modulePermissions = useModuleAccess(MANIFEST_MODULE);

  const isMobile = useMediaQuery("(max-width: 900px)");

  const dateParam = searchParams.get("date");

  const productIdParam = searchParams.get("productId");

  const timeParam = searchParams.get("time");



  const effectiveDate = useMemo(() => deriveDate(dateParam), [dateParam]);

  const effectiveGroupKey = useMemo(() => deriveGroupKey(productIdParam, timeParam), [productIdParam, timeParam]);



  const [selectedDate, setSelectedDate] = useState<Dayjs>(effectiveDate);

  const [selectedGroupKey, setSelectedGroupKey] = useState<string>(effectiveGroupKey);

  const [manifest, setManifest] = useState<ManifestGroup[]>([]);

  const [summary, setSummary] = useState<ManifestSummary>({ totalPeople: 0, men: 0, women: 0, totalOrders: 0, extras: { tshirts: 0, cocktails: 0, photos: 0 } });

  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [reloadToken, setReloadToken] = useState(0);



  useEffect(() => {

    if (!selectedDate.isSame(effectiveDate, "day")) {

      setSelectedDate(effectiveDate);

    }

  }, [effectiveDate, selectedDate]);



  useEffect(() => {

    if (selectedGroupKey !== effectiveGroupKey) {

      setSelectedGroupKey(effectiveGroupKey);

    }

  }, [effectiveGroupKey, selectedGroupKey]);



  useEffect(() => {

    dispatch(navigateToPage(title));

  }, [dispatch, title]);



  const updateSearchParamDate = (next: Dayjs) => {

    const formatted = next.format(DATE_FORMAT);

    if (formatted === dateParam) {

      return;

    }

    const params = new URLSearchParams(searchParams);

    params.set("date", formatted);

    setSearchParams(params);

  };



  const updateSearchParamGroup = (groupKey: string, groupLabel?: string) => {

    const params = new URLSearchParams(searchParams);

    if (groupKey === "all") {

      params.delete("productId");

      params.delete("time");

      params.delete("productName");

    } else {

      const [productId, time] = groupKey.split("|");

      params.set("productId", productId);

      params.set("time", time);

      if (groupLabel) {

        params.set("productName", groupLabel);

      }

    }

    setSearchParams(params);

  };



  useEffect(() => {

    if (!modulePermissions.ready || !modulePermissions.canView) {

      return;

    }



    const controller = new AbortController();



    const fetchManifest = async () => {

      setFetchStatus("loading");

      setErrorMessage(null);



      try {

        const response = await axiosInstance.get<ManifestResponse>("/ecwid/manifest", {

          params: {

            date: selectedDate.format(DATE_FORMAT),

            productId: productIdParam ?? undefined,

            time: timeParam ?? undefined,

          },

          signal: controller.signal,

          withCredentials: true,

        });



        const payload = response.data;

        const groups = Array.isArray(payload?.manifest) ? payload.manifest : [];

        setManifest(groups);

        setSummary(
          payload?.summary ?? {
            totalPeople: groups.reduce((acc, group) => acc + group.totalPeople, 0),
            men: groups.reduce((acc, group) => acc + group.men, 0),
            women: groups.reduce((acc, group) => acc + group.women, 0),
            totalOrders: groups.reduce((acc, group) => acc + group.orders.length, 0),
            extras: groups.reduce(
              (acc, group) => ({
                tshirts: acc.tshirts + (group.extras?.tshirts ?? 0),
                cocktails: acc.cocktails + (group.extras?.cocktails ?? 0),
                photos: acc.photos + (group.extras?.photos ?? 0),
              }),
              { tshirts: 0, cocktails: 0, photos: 0 },
            ),
          },
        );

        setFetchStatus("success");

      } catch (error) {

        if (controller.signal.aborted) {

          return;

        }

        setFetchStatus("error");

        setErrorMessage(error instanceof Error ? error.message : "Failed to load manifest data.");

      }

    };



    fetchManifest();



    return () => {

      controller.abort();

    };

  }, [modulePermissions.ready, modulePermissions.canView, selectedDate, productIdParam, timeParam, reloadToken]);



  const groupOptions = useMemo(() => {

    const options = manifestToOptions(manifest);

    if (options.length === 0) {

      return [{ value: "all", label: "All events" }];

    }

    return [{ value: "all", label: "All events" }, ...options];

  }, [manifest]);



  const activeGroups = useMemo(() => {

    if (selectedGroupKey === "all") {

      return manifest;

    }



    return manifest.filter((group) => `${group.productId}|${group.time}` === selectedGroupKey);

  }, [manifest, selectedGroupKey]);



  const handleShiftDate = (delta: number) => {

    const next = selectedDate.add(delta, "day");

    setSelectedDate(next);

    updateSearchParamDate(next);

  };



  const handleGoToToday = () => {

    const today = dayjs().startOf("day");

    setSelectedDate(today);

    updateSearchParamDate(today);

  };



  const handleDateInputChange = (event: ChangeEvent<HTMLInputElement>) => {

    const value = event.currentTarget.value;

    if (!value) {

      return;

    }

    const parsed = dayjs(value);

    if (parsed.isValid()) {

      const normalized = parsed.startOf("day");

      setSelectedDate(normalized);

      updateSearchParamDate(normalized);

    }

  };



  const handleGroupChange = (value: string | null) => {

    const nextValue = value ?? "all";

    setSelectedGroupKey(nextValue);

    const label = groupOptions.find((option) => option.value === nextValue)?.label;

    updateSearchParamGroup(nextValue, label);

  };



  const handleReload = () => setReloadToken((token) => token + 1);



  const isLoading = fetchStatus === "loading" && manifest.length === 0;



  return (

    <PageAccessGuard pageSlug={PAGE_SLUGS.bookingsManifest}>

      <Stack gap="lg">

        <Title order={2}>{title}</Title>



        {!modulePermissions.ready || modulePermissions.loading ? (

          <Box style={{ minHeight: 240 }}>

            <Loader variant="dots" />

          </Box>

        ) : !modulePermissions.canView ? (

          <Alert color="yellow" title="No access">

            You do not have permission to view manifest information.

          </Alert>

        ) : (

          <Stack gap="md">

            <Flex justify="space-between" align="center" wrap="wrap" gap="sm">

              <Group gap="sm" wrap="wrap">

                <Button size="sm" variant="light" leftSection={<IconCalendar size={16} />} onClick={handleGoToToday}>

                  Today

                </Button>

                <Button size="sm" variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => handleShiftDate(-1)}>

                  Prev day

                </Button>

                <Button size="sm" variant="subtle" rightSection={<IconArrowRight size={16} />} onClick={() => handleShiftDate(1)}>

                  Next day

                </Button>

                <input

                  type="date"

                  value={selectedDate.format(DATE_FORMAT)}

                  onChange={handleDateInputChange}

                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ced4da" }}

                />

              </Group>



              <Group gap="xs" wrap="wrap" align="center">

                <Select

                  data={groupOptions}

                  value={selectedGroupKey}

                  onChange={handleGroupChange}

                  size="sm"

                  allowDeselect={false}

                  style={{ minWidth: 220 }}

                  label="Event"

                />

                <Button

                  variant="subtle"

                  size="sm"

                  onClick={handleReload}

                  leftSection={<IconRefresh size={16} />}

                  loading={fetchStatus === "loading"}

                >

                  Refresh

                </Button>

              </Group>

            </Flex>



            <Group gap="md" wrap="wrap">

              <Badge size="lg" color="blue" variant="light">

                {selectedDate.format("dddd, MMM D")}

              </Badge>

              <Badge size="lg" color="green" variant="light">

                {`Total: ${summary.totalPeople} people`}

              </Badge>

              <Badge size="lg" color="teal" variant="light">

                {`Men: ${summary.men}`}

              </Badge>

              <Badge size="lg" color="pink" variant="light">

                {`Women: ${summary.women}`}

              </Badge>

              {summary.extras.tshirts > 0 && (
                <Badge size="lg" color="blue" variant="light">

                  {`T-Shirts: ${summary.extras.tshirts}`}

                </Badge>
              )}

              {summary.extras.cocktails > 0 && (
                <Badge size="lg" color="violet" variant="light">

                  {`Cocktails: ${summary.extras.cocktails}`}

                </Badge>
              )}

              {summary.extras.photos > 0 && (
                <Badge size="lg" color="grape" variant="light">

                  {`Photos: ${summary.extras.photos}`}

                </Badge>
              )}

              <Badge size="lg" color="gray" variant="light">

                {`Bookings: ${summary.totalOrders}`}

              </Badge>

            </Group>



            {errorMessage && (

              <Alert color="red" title="Failed to load manifest">

                {errorMessage}

              </Alert>

            )}



            {isLoading ? (

              <Box style={{ minHeight: 320 }}>

                <Loader variant="bars" />

              </Box>

            ) : activeGroups.length === 0 ? (

              <Alert color="blue" title="No data">

                No bookings found for the selected date.

              </Alert>

            ) : (

              <Stack gap="lg">
                {activeGroups.map((group) => {
                  const readableDate = dayjs(group.date).format("dddd, MMM D");
                  const bookingsLabel = `${group.orders.length} booking${group.orders.length === 1 ? "" : "s"}`;

                  if (isMobile) {
                    return (
                      <Paper
                        key={`${group.productId}-${group.date}-${group.time}`}
                        withBorder
                        radius="lg"
                        shadow="sm"
                        p="md"
                      >
                        <Stack gap="sm">
                          <Stack gap={4}>
                            <Text fw={700} size="lg">
                              {group.productName}
                            </Text>
                            <Group gap="xs" align="center">
                              <Badge color="orange" variant="filled" radius="sm">
                                {group.time}
                              </Badge>
                              <Text size="sm" c="dimmed">
                                {readableDate}
                              </Text>
                            </Group>
                          </Stack>
                          <Group gap="xs" wrap="wrap">
                            <Badge color="green" variant="light">
                              {`${group.totalPeople} people`}
                            </Badge>
                            <Badge color="teal" variant="light">
                              {`Men: ${group.men}`}
                            </Badge>
                            <Badge color="pink" variant="light">
                              {`Women: ${group.women}`}
                            </Badge>
                            {group.extras.tshirts > 0 && (
                              <Badge color="blue" variant="light">
                                {`T-Shirts: ${group.extras.tshirts}`}
                              </Badge>
                            )}
                            {group.extras.cocktails > 0 && (
                              <Badge color="violet" variant="light">
                                {`Cocktails: ${group.extras.cocktails}`}
                              </Badge>
                            )}
                            {group.extras.photos > 0 && (
                              <Badge color="grape" variant="light">
                                {`Photos: ${group.extras.photos}`}
                              </Badge>
                            )}
                            <Badge color="gray" variant="light">
                              {bookingsLabel}
                            </Badge>
                          </Group>
                          <Divider />
                          <Stack gap="sm">
                            {group.orders.map((order) => (
                              <Paper
                                key={order.id}
                                withBorder
                                radius="md"
                                shadow="xs"
                                p="sm"
                                style={{ background: "#f8fafc" }}
                              >
                                <Stack gap={8}>
                                  <Group justify="space-between" align="flex-start">
                                    <Stack gap={2}>
                                      <Text fw={600}>{order.customerName || "Unnamed guest"}</Text>
                                      <Text size="xs" c="dimmed">
                                        {order.id}
                                      </Text>
                                    </Stack>
                                    <Badge color="orange" variant="light">
                                      {`${order.quantity} people`}
                                    </Badge>
                                  </Group>
                                  <Group gap="xs" wrap="wrap">
                                    <Badge color="teal" variant="light">
                                      {`Men: ${order.menCount}`}
                                    </Badge>
                                    <Badge color="pink" variant="light">
                                      {`Women: ${order.womenCount}`}
                                    </Badge>
                                    {order.extras && (order.extras.tshirts ?? 0) > 0 ? (
                                      <Badge color="blue" variant="light">
                                        {`T-Shirts: ${order.extras.tshirts}`}
                                      </Badge>
                                    ) : null}
                                    {order.extras && (order.extras.cocktails ?? 0) > 0 ? (
                                      <Badge color="violet" variant="light">
                                        {`Cocktails: ${order.extras.cocktails}`}
                                      </Badge>
                                    ) : null}
                                    {order.extras && (order.extras.photos ?? 0) > 0 ? (
                                      <Badge color="grape" variant="light">
                                        {`Photos: ${order.extras.photos}`}
                                      </Badge>
                                    ) : null}
                                  </Group>
                                  <Stack gap={4}>
                                    <Text size="sm" c="dimmed">
                                      Pickup time: {order.timeslot}
                                    </Text>
                                    {(() => {
                                      const link = toWhatsAppLink(order.customerPhone);
                                      return (
                                        <Text size="sm" c="dimmed">
                                          Phone:{' '}
                                          {link ? (
                                            <Text
                                              component="a"
                                              href={link.href}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              fw={600}
                                              c="blue"
                                              style={{ textDecoration: 'none' }}
                                              title="Open in WhatsApp"
                                            >
                                              {link.display}
                                            </Text>
                                          ) : (
                                            order.customerPhone || "Not provided"
                                          )}
                                        </Text>
                                      );
                                    })()}
                                  </Stack>
                                </Stack>
                              </Paper>
                            ))}
                          </Stack>
                        </Stack>
                      </Paper>
                    );
                  }
                  return (
                    <Box
                      key={`${group.productId}-${group.date}-${group.time}`}
                      style={{
                        background: "#fff",
                        borderRadius: 10,
                        boxShadow: "0 18px 36px rgba(15, 23, 42, 0.08)",
                        border: "1px solid #e2e8f0",
                        padding: 24,
                      }}
                    >
                      <Flex justify="space-between" align="center" wrap="wrap" gap="sm">
                        <Stack gap={4}>
                          <Text fw={700} size="lg">
                            {group.productName}
                          </Text>
                          <Group gap="xs" align="center">
                            <Badge color="orange" variant="filled" radius="sm">
                              {group.time}
                            </Badge>
                            <Text size="sm" c="dimmed">
                              {readableDate}
                            </Text>
                          </Group>
                        </Stack>
                        <Group gap="xs" wrap="wrap">
                          <Badge color="green" variant="light">
                            {`${group.totalPeople} people`}
                          </Badge>
                          <Badge color="teal" variant="light">
                            {`Men: ${group.men}`}
                          </Badge>
                          <Badge color="pink" variant="light">
                            {`Women: ${group.women}`}
                          </Badge>
                          {group.extras.tshirts > 0 && (
                            <Badge color="blue" variant="light">
                              {`T-Shirts: ${group.extras.tshirts}`}
                            </Badge>
                          )}
                          {group.extras.cocktails > 0 && (
                            <Badge color="violet" variant="light">
                              {`Cocktails: ${group.extras.cocktails}`}
                            </Badge>
                          )}
                          {group.extras.photos > 0 && (
                            <Badge color="grape" variant="light">
                              {`Photos: ${group.extras.photos}`}
                            </Badge>
                          )}
                          <Badge color="gray" variant="light">
                            {bookingsLabel}
                          </Badge>
                        </Group>
                      </Flex>

                      <Table striped highlightOnHover withColumnBorders mt="md" horizontalSpacing="md" verticalSpacing="sm">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>ID</Table.Th>
                            <Table.Th>Contact</Table.Th>
                            <Table.Th>Phone</Table.Th>
                            <Table.Th align="right">People</Table.Th>
                            <Table.Th align="right">Men</Table.Th>
                            <Table.Th align="right">Women</Table.Th>
                            <Table.Th align="right">T-Shirts</Table.Th>
                            <Table.Th align="right">Cocktails</Table.Th>
                            <Table.Th align="right">Photos</Table.Th>
                            <Table.Th>Pickup time</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          <Table.Tr style={{ background: "#fff7e6" }}>
                            <Table.Td fw={600} c="#475569">Summary</Table.Td>
                            <Table.Td fw={600}>{bookingsLabel}</Table.Td>
                            <Table.Td />
                            <Table.Td align="right" fw={600}>
                              {group.totalPeople}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {group.men}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {group.women}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {formatAddonValue(group.extras.tshirts)}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {formatAddonValue(group.extras.cocktails)}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {formatAddonValue(group.extras.photos)}
                            </Table.Td>
                            <Table.Td fw={600}>{group.time}</Table.Td>
                          </Table.Tr>
                          {group.orders.map((order) => (
                            <Table.Tr key={order.id}>
                              <Table.Td>{order.id}</Table.Td>
                              <Table.Td>{order.customerName || "-"}</Table.Td>
                              <Table.Td>
                                {(() => {
                                  const link = toWhatsAppLink(order.customerPhone);
                                  return link ? (
                                    <a
                                      href={link.href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ fontWeight: 600, textDecoration: 'none', color: 'var(--mantine-color-blue-7)' }}
                                      title="Open in WhatsApp"
                                    >
                                      {link.display}
                                    </a>
                                  ) : (order.customerPhone || "-");
                                })()}
                              </Table.Td>
                              <Table.Td align="right">{order.quantity}</Table.Td>
                              <Table.Td align="right">{order.menCount}</Table.Td>
                              <Table.Td align="right">{order.womenCount}</Table.Td>
                              <Table.Td align="right">{formatAddonValue(order.extras?.tshirts)}</Table.Td>
                              <Table.Td align="right">{formatAddonValue(order.extras?.cocktails)}</Table.Td>
                              <Table.Td align="right">{formatAddonValue(order.extras?.photos)}</Table.Td>
                              <Table.Td>{order.timeslot}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Box>
                  );
                })}

              </Stack>

            )}

          </Stack>

        )}

      </Stack>

    </PageAccessGuard>

  );

};



export default BookingsManifestPage;
















