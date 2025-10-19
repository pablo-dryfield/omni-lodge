import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { ArrowBack, Add, Delete, Edit, Notes, Send, UploadFile } from "@mui/icons-material";
import dayjs from "dayjs";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";

import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  fetchNightReports,
  fetchNightReportById,
  submitNightReport,
  updateNightReport,
  uploadNightReportPhoto,
  deleteNightReportPhoto,
} from "../../actions/nightReportActions";
import { fetchCounters } from "../../actions/counterActions";
import { fetchUsers } from "../../actions/userActions";
import { fetchVenues } from "../../actions/venueActions";

import type { NightReport, NightReportSummary, NightReportVenueInput } from "../../types/nightReports/NightReport";
import type { Counter } from "../../types/counters/Counter";
import type { User } from "../../types/users/User";
import type { Venue } from "../../types/venues/Venue";

type EditableVenue = {
  id?: number;
  venueName: string;
  totalPeople: string;
  normalCount: string;
  cocktailsCount: string;
  brunchCount: string;
};

type EditableReport = {
  activityDate: string;
  leaderId: number | null;
  notes: string;
  counterId: number | null;
  venues: EditableVenue[];
};

const OPEN_BAR_INDEX = 0;
const DATE_FORMAT = "YYYY-MM-DD";

const createEmptyVenue = (): EditableVenue => ({
  id: undefined,
  venueName: "",
  totalPeople: "",
  normalCount: "",
  cocktailsCount: "",
  brunchCount: "",
});

const toEditableReport = (report: NightReport | null): EditableReport => {
  if (!report) {
    return {
      activityDate: dayjs().format(DATE_FORMAT),
      leaderId: null,
      notes: "",
      counterId: null,
      venues: [createEmptyVenue()],
    };
  }

  const sorted = (report.venues ?? [])
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((venue, index) => ({
      id: venue.id,
      venueName: venue.venueName ?? "",
      totalPeople: venue.totalPeople != null ? String(venue.totalPeople) : "",
      normalCount: index === OPEN_BAR_INDEX && venue.normalCount != null ? String(venue.normalCount) : "",
      cocktailsCount: index === OPEN_BAR_INDEX && venue.cocktailsCount != null ? String(venue.cocktailsCount) : "",
      brunchCount: index === OPEN_BAR_INDEX && venue.brunchCount != null ? String(venue.brunchCount) : "",
    }));

  return {
    activityDate: report.activityDate ?? dayjs().format(DATE_FORMAT),
    leaderId: report.leader?.id ?? null,
    notes: report.notes ?? "",
    counterId: report.counter?.id ?? null,
    venues: sorted.length > 0 ? sorted : [createEmptyVenue()],
  };
};

const normalizeNumber = (value: string, fallback: number | null = null): number | null => {
  if (!value && value !== "0") {
    return fallback;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

const buildVenuePayload = (report: EditableReport): NightReportVenueInput[] =>
  report.venues.map((venue, index) => {
    const payload: NightReportVenueInput = {
      orderIndex: index + 1,
      venueName: venue.venueName.trim(),
      isOpenBar: index === OPEN_BAR_INDEX,
      totalPeople: 0,
    };
    if (index === OPEN_BAR_INDEX) {
      const normalValue = normalizeNumber(venue.normalCount, 0) ?? 0;
      const cocktailsValue = normalizeNumber(venue.cocktailsCount, 0) ?? 0;
      const brunchValue = normalizeNumber(venue.brunchCount, 0) ?? 0;
      payload.normalCount = normalValue;
      payload.cocktailsCount = cocktailsValue;
      payload.brunchCount = brunchValue;
      payload.totalPeople = normalValue + cocktailsValue + brunchValue;
    } else {
      payload.totalPeople = normalizeNumber(venue.totalPeople, 0) ?? 0;
    }
    return payload;
  });

const formatUserFullName = (user: Partial<User> | undefined): string => {
  if (!user) {
    return "";
  }
  const first = user.firstName ?? "";
  const last = user.lastName ?? "";
  const fallback = user.username ?? "";
  return `${first} ${last}`.trim() || fallback;
};

const getManagerLabel = (counter: Counter | undefined): string => {
  if (!counter?.manager) {
    return "";
  }
  return formatUserFullName(counter.manager as Partial<User>);
};

const VenueNumbersList = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const nightReportListState = useAppSelector((state) => state.nightReports.list[0]);
  const nightReportDetail = useAppSelector((state) => state.nightReports.detail);
  const nightReportUi = useAppSelector((state) => state.nightReports.ui);
  const countersState = useAppSelector((state) => state.counters[0]);
  const usersState = useAppSelector((state) => state.users[0]);
  const venuesState = useAppSelector((state) => state.venues[0]);

  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [formState, setFormState] = useState<EditableReport>(() => toEditableReport(null));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<boolean>(true);
  const [pendingChanges, setPendingChanges] = useState<boolean>(false);
  const [notesExpanded, setNotesExpanded] = useState<boolean>(false);

  const venuesOptions = useMemo(() => {
    const venues = (venuesState.data[0]?.data as Venue[] | undefined) ?? [];
    return venues
      .filter((venue) => venue.isActive !== false)
      .sort((a, b) => {
        const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
      })
      .map((venue) => venue.name);
  }, [venuesState.data]);

  const counters = useMemo(() => (countersState.data[0]?.data as Counter[] | undefined) ?? [], [countersState.data]);
  const users = useMemo(() => (usersState.data[0]?.data as User[] | undefined) ?? [], [usersState.data]);
  const selectedLeader = useMemo(
    () => users.find((user) => user.id === formState.leaderId) ?? null,
    [users, formState.leaderId],
  );
  const reports = useMemo(
    () => (nightReportListState.data[0]?.data as NightReportSummary[] | undefined) ?? [],
    [nightReportListState.data],
  );

  useEffect(() => {
    dispatch(fetchNightReports());
    dispatch(fetchCounters());
    dispatch(fetchUsers());
    dispatch(fetchVenues());
  }, [dispatch]);

  useEffect(() => {
    if (!reports.length) {
      return;
    }
    if (selectedReportId === null || !reports.some((report) => report.id === selectedReportId)) {
      setSelectedReportId(reports[0].id);
    }
  }, [reports, selectedReportId]);

  useEffect(() => {
    if (selectedReportId != null) {
      dispatch(fetchNightReportById(selectedReportId));
    }
  }, [dispatch, selectedReportId]);

  useEffect(() => {
    const next = toEditableReport(nightReportDetail.data);
    setFormState(next);
    setEditMode((nightReportDetail.data?.status ?? "draft") !== "submitted");
    setPendingChanges(false);
    setValidationError(null);
    setNotesExpanded(Boolean(next.notes));
  }, [nightReportDetail.data]);

  useEffect(() => {
    if (venuesOptions.length === 0) {
      return;
    }
    setFormState((prev) => {
      if (prev.venues.length === 0) {
        return prev;
      }
      const first = prev.venues[OPEN_BAR_INDEX];
      if (!first || first.venueName) {
        return prev;
      }
      const updated = [...prev.venues];
      updated[OPEN_BAR_INDEX] = { ...first, venueName: venuesOptions[0] };
      return { ...prev, venues: updated };
    });
  }, [venuesOptions]);

  const handleReportSelect = useCallback(
    (report: NightReportSummary) => {
      if (pendingChanges && selectedReportId && report.id !== selectedReportId) {
        setValidationError("Submit or discard your edits before switching reports.");
        return;
      }
      setValidationError(null);
      setSelectedReportId(report.id);
    },
    [pendingChanges, selectedReportId],
  );

  const handleEnableEdit = () => {
    setEditMode(true);
    setPendingChanges(false);
    setValidationError(null);
  };

  const validateForm = (report: EditableReport): string | null => {
    if (!report.counterId) {
      return "This report is missing its counter link.";
    }
    if (!report.leaderId) {
      return "Assign a leader.";
    }
    if (!report.activityDate) {
      return "Date is missing.";
    }
    if (report.venues.length === 0) {
      return "Add at least one venue.";
    }
    const venueSet = new Set(venuesOptions.map((name) => name.toLowerCase()));
    for (const [index, venue] of report.venues.entries()) {
      const trimmed = venue.venueName.trim();
      if (!trimmed) {
        return "Select a venue from the list.";
      }
      if (!venueSet.has(trimmed.toLowerCase())) {
        return `"${venue.venueName}" is not part of the venues directory.`;
      }
      if (index === OPEN_BAR_INDEX) {
        const normal = normalizeNumber(venue.normalCount);
        const cocktails = normalizeNumber(venue.cocktailsCount);
        const brunch = normalizeNumber(venue.brunchCount);
        if (normal == null || cocktails == null || brunch == null) {
          return "Provide Normal, Cocktails, and Brunch counts for the open-bar venue.";
        }
      } else {
        const total = normalizeNumber(venue.totalPeople);
        if (total == null) {
          return `Provide total people for ${venue.venueName || `venue ${index + 1}`}.`;
        }
      }
    }
    return null;
  };

  const handleVenueChange = (index: number, field: keyof EditableVenue, value: string) => {
    setValidationError(null);
    setPendingChanges(true);
    setFormState((prev) => {
      const nextVenues = prev.venues.map((venue, idx) =>
        idx === index
          ? {
              ...venue,
              [field]: value,
            }
          : venue,
      );
      if (index === OPEN_BAR_INDEX) {
        const openBar = nextVenues[OPEN_BAR_INDEX];
        const normalValue = normalizeNumber(openBar.normalCount, 0) ?? 0;
        const cocktailsValue = normalizeNumber(openBar.cocktailsCount, 0) ?? 0;
        const brunchValue = normalizeNumber(openBar.brunchCount, 0) ?? 0;
        nextVenues[OPEN_BAR_INDEX] = {
          ...openBar,
          totalPeople: String(normalValue + cocktailsValue + brunchValue),
        };
      }
      return {
        ...prev,
        venues: nextVenues,
      };
    });
  };

  const handleAddVenue = () => {
    setValidationError(null);
    setPendingChanges(true);
    setFormState((prev) => {
      const used = new Set(prev.venues.map((venue) => venue.venueName.trim().toLowerCase()).filter(Boolean));
      const available = venuesOptions.find((name) => !used.has(name.toLowerCase())) ?? "";
      return {
        ...prev,
        venues: [...prev.venues, { ...createEmptyVenue(), venueName: available }],
      };
    });
  };

  const handleRemoveVenue = (index: number) => {
    if (index === OPEN_BAR_INDEX) {
      return;
    }
    setValidationError(null);
    setPendingChanges(true);
    setFormState((prev) => ({
      ...prev,
      venues: prev.venues.filter((_, idx) => idx !== index),
    }));
  };

  const handleLeaderChange = (_: unknown, value: Partial<User> | null) => {
    setValidationError(null);
    setPendingChanges(true);
    setFormState((prev) => ({
      ...prev,
      leaderId: value?.id ?? null,
    }));
  };

  const handleNotesChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValidationError(null);
    setPendingChanges(true);
    setFormState((prev) => ({
      ...prev,
      notes: event.target.value,
    }));
  };

  const handleSubmit = async () => {
    if (!selectedReportId) {
      setValidationError("Select a report to submit.");
      return;
    }
    const error = validateForm(formState);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    const payload = {
      activityDate: formState.activityDate,
      leaderId: formState.leaderId ?? undefined,
      notes: formState.notes || undefined,
      venues: buildVenuePayload(formState),
    };

    await dispatch(updateNightReport({ reportId: selectedReportId, payload })).unwrap();
    await dispatch(submitNightReport(selectedReportId)).unwrap();
    await dispatch(fetchNightReports());
    setEditMode(false);
    setPendingChanges(false);
  };

  const reportsLoading = nightReportListState.loading;
  const detailLoading = nightReportDetail.loading;
  const submitting = nightReportUi.submitting;
  const currentStatus = nightReportDetail.data?.status ?? "draft";
  const readOnly = !editMode;
  const currentCounter = counters.find((counter) => counter.id === formState.counterId);

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Button variant="text" startIcon={<ArrowBack />} onClick={() => navigate(-1)}>
            Back
          </Button>
          <Box flexGrow={1} />
          {currentStatus === "submitted" && !editMode && (
            <Button variant="contained" startIcon={<Edit />} onClick={handleEnableEdit}>
              Edit Report
            </Button>
          )}
        </Stack>

        {validationError && (
          <Alert severity="warning" onClose={() => setValidationError(null)}>
            {validationError}
          </Alert>
        )}

        <Stack direction={isMobile ? "column" : "row"} spacing={2} alignItems="stretch">
          <Card sx={{ flex: isMobile ? "unset" : "0 0 320px" }}>
            <CardContent sx={{ p: 0 }}>
              {reportsLoading ? (
                <Stack alignItems="center" py={3}>
                  <CircularProgress size={32} />
                </Stack>
              ) : reports.length === 0 ? (
                <Box px={2} py={3}>
                  <Typography variant="body2" color="text.secondary">
                    No night reports found. Create counters first to generate reports.
                  </Typography>
                </Box>
              ) : (
                <List disablePadding>
                  {reports.map((report) => (
                    <ListItem key={report.id} disablePadding>
                      <ListItemButton
                        onClick={() => handleReportSelect(report)}
                        selected={selectedReportId === report.id}
                        disabled={pendingChanges && selectedReportId !== report.id}
                      >
                        <ListItemText
                          primary={
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography fontWeight={600}>
                                {dayjs(report.activityDate).format("MMM D, YYYY")}
                              </Typography>
                              <Chip
                                size="small"
                                label={report.status === "submitted" ? "Submitted" : "Draft"}
                                color={report.status === "submitted" ? "success" : "default"}
                              />
                            </Stack>
                          }
                          secondary={
                            <Stack spacing={0.5}>
                              <Typography variant="body2" color="text.secondary">
                                Leader: {report.leaderName || "—"}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                Venues: {report.venuesCount} {"\u2022"} People: {report.totalPeople}
                              </Typography>
                            </Stack>
                          }
                          primaryTypographyProps={{ component: "div" }}
                          secondaryTypographyProps={{ component: "div" }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>

          <Card sx={{ flex: 1, minHeight: 420 }}>
            <CardContent>
              {detailLoading ? (
                <Stack alignItems="center" justifyContent="center" minHeight={220}>
                  <CircularProgress size={36} />
                </Stack>
              ) : (
                <Stack spacing={3}>
                  {currentStatus === "submitted" && !editMode && (
                    <Alert severity="info">Submitted · This report is locked. Click Edit to make changes.</Alert>
                  )}
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Date:{" "}
                      <Typography component="span" variant="body1" fontWeight={600}>
                        {formState.activityDate
                          ? dayjs(formState.activityDate).format("MMM D, YYYY")
                          : "—"}
                      </Typography>
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Manager:{" "}
                      <Typography component="span" variant="body1" fontWeight={600}>
                        {getManagerLabel(currentCounter)}
                      </Typography>
                    </Typography>
                  </Box>

                  <Grid container spacing={2}>
                    <Grid size={12}>
                      <Autocomplete
                        options={users}
                        value={selectedLeader}
                        onChange={handleLeaderChange}
                        getOptionLabel={(option) => formatUserFullName(option)}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        renderOption={(props, option) => {
                          const { style, ...rest } = props;
                          return (
                            <li
                              {...rest}
                              style={{ ...style, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.3 }}
                              title={formatUserFullName(option)}
                            >
                              {formatUserFullName(option)}
                            </li>
                          );
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Leader"
                            required
                            fullWidth
                            sx={{
                              "& .MuiInputBase-root": {
                                alignItems: "flex-start",
                              },
                              "& .MuiInputBase-input": {
                                whiteSpace: "normal",
                                overflow: "visible",
                                textOverflow: "unset",
                                lineHeight: 1.4,
                              },
                            }}
                          />
                        )}
                        disabled={readOnly}
                        fullWidth
                        componentsProps={{
                          popper: {
                            style: { width: "auto" },
                          },
                          paper: {
                            sx: {
                              width: "fit-content",
                              minWidth: "auto",
                              maxWidth: "min(440px, calc(100vw - 48px))",
                            },
                          },
                        }}
                        ListboxProps={{ style: { paddingRight: 8 } }}
                        sx={{
                          "& .MuiAutocomplete-inputRoot": {
                            alignItems: "flex-start",
                            flexWrap: "wrap",
                            paddingTop: 1,
                            paddingBottom: 1,
                          },
                          "& .MuiAutocomplete-input": {
                            display: "block",
                            height: "auto",
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                            textOverflow: "unset",
                            width: "100% !important",
                            lineHeight: 1.4,
                          },
                        }}
                      />
                    </Grid>
                  </Grid>

                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="h6" flexGrow={1}>
                        Venues
                      </Typography>
                      {!readOnly && (
                        <Button startIcon={<Add />} variant="outlined" onClick={handleAddVenue}>
                          Add Venue
                        </Button>
                      )}
                    </Stack>
                    <Divider />
                    <Stack spacing={2}>
                      {formState.venues.map((venue, index) => {
                        const isOpenBar = index === OPEN_BAR_INDEX;
                        const availableOptions = (() => {
                          if (!venue.venueName) {
                            return venuesOptions;
                          }
                          const set = new Set(venuesOptions.map((name) => name.toLowerCase()));
                          if (!set.has(venue.venueName.toLowerCase())) {
                            return [...venuesOptions, venue.venueName];
                          }
                          return venuesOptions;
                        })();

                        return (
                          <Card variant="outlined" key={venue.id ?? `venue-${index}`}>
                            <CardContent>
                              <Stack spacing={2}>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                  <Typography fontWeight={600}>
                                    {isOpenBar ? "Open Bar (Venue 1)" : `Venue ${index + 1}`}
                                  </Typography>
                                  <Box flexGrow={1} />
                                  {!readOnly && !isOpenBar && (
                                    <Tooltip title="Remove venue">
                                      <IconButton size="small" onClick={() => handleRemoveVenue(index)}>
                                        <Delete fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                </Stack>
                                <Grid container spacing={2}>
                                  <Grid size={12}>
                                    <Autocomplete
                                      options={availableOptions}
                                      value={venue.venueName}
                                      onChange={(_, value) => handleVenueChange(index, "venueName", value ?? "")}
                                      renderInput={(params) => (
                                        <TextField
                                          {...params}
                                          label="Venue"
                                          required
                                          fullWidth
                                          sx={{
                                            "& .MuiInputBase-root": {
                                              alignItems: "flex-start",
                                            },
                                            "& .MuiInputBase-input": {
                                              whiteSpace: "normal",
                                              overflow: "visible",
                                              textOverflow: "unset",
                                              lineHeight: 1.4,
                                            },
                                          }}
                                        />
                                      )}
                                      disabled={readOnly}
                                      fullWidth
                                      componentsProps={{
                                        popper: {
                                          style: { width: "auto" },
                                        },
                                        paper: {
                                          sx: {
                                            width: "fit-content",
                                            minWidth: "auto",
                                            maxWidth: "min(440px, calc(100vw - 48px))",
                                          },
                                        },
                                      }}
                                      ListboxProps={{ style: { paddingRight: 8 } }}
                                      sx={{
                                        "& .MuiAutocomplete-inputRoot": {
                                          alignItems: "flex-start",
                                          flexWrap: "wrap",
                                          paddingTop: 1,
                                          paddingBottom: 1,
                                        },
                                        "& .MuiAutocomplete-input": {
                                          display: "block",
                                          height: "auto",
                                          whiteSpace: "normal",
                                          wordBreak: "break-word",
                                          textOverflow: "unset",
                                          width: "100% !important",
                                          lineHeight: 1.4,
                                        },
                                      }}
                                    />
                                  </Grid>
                                  {isOpenBar ? (
                                    <>
                                      <Grid size={{ xs: 12, md: 4 }}>
                                        <TextField
                                          label="Normal"
                                          value={venue.normalCount ?? ""}
                                          onChange={(event) =>
                                            handleVenueChange(index, "normalCount", event.target.value)
                                          }
                                          type="number"
                                          inputProps={{ min: 0 }}
                                          fullWidth
                                          disabled={readOnly}
                                        />
                                      </Grid>
                                      <Grid size={{ xs: 12, md: 4 }}>
                                        <TextField
                                          label="Cocktails"
                                          value={venue.cocktailsCount ?? ""}
                                          onChange={(event) =>
                                            handleVenueChange(index, "cocktailsCount", event.target.value)
                                          }
                                          type="number"
                                          inputProps={{ min: 0 }}
                                          fullWidth
                                          disabled={readOnly}
                                        />
                                      </Grid>
                                      <Grid size={{ xs: 12, md: 4 }}>
                                        <TextField
                                          label="Brunch"
                                          value={venue.brunchCount ?? ""}
                                          onChange={(event) =>
                                            handleVenueChange(index, "brunchCount", event.target.value)
                                          }
                                          type="number"
                                          inputProps={{ min: 0 }}
                                          fullWidth
                                          disabled={readOnly}
                                        />
                                      </Grid>
                                    </>
                                  ) : (
                                    <Grid size={{ xs: 12, md: 6 }}>
                                      <TextField
                                        label="Total People"
                                        value={venue.totalPeople}
                                        onChange={(event) =>
                                          handleVenueChange(index, "totalPeople", event.target.value)
                                        }
                                        type="number"
                                        inputProps={{ min: 0 }}
                                        fullWidth
                                        disabled={readOnly}
                                      />
                                    </Grid>
                                  )}
                                </Grid>
                              </Stack>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </Stack>
                  </Stack>

                  <Stack spacing={1}>
                    <Button variant="outlined" size="small" onClick={() => setNotesExpanded((prev) => !prev)}>
                      {notesExpanded || formState.notes
                        ? notesExpanded
                          ? "Hide Notes"
                          : "View Notes"
                        : "Add Notes"}
                    </Button>
                    {(notesExpanded || formState.notes) &&
                      (readOnly ? (
                        <TextField
                          label="Notes"
                          value={formState.notes}
                          multiline
                          minRows={3}
                          fullWidth
                          InputProps={{ readOnly: true }}
                        />
                      ) : (
                        <TextField
                          label="Notes"
                          value={formState.notes}
                          onChange={handleNotesChange}
                          multiline
                          minRows={3}
                          fullWidth
                        />
                      ))}
                  </Stack>

                  <Button
                    variant="contained"
                    color="success"
                    startIcon={<Send />}
                    onClick={handleSubmit}
                    disabled={!selectedReportId || submitting || readOnly}
                    sx={{ alignSelf: "center" }}
                  >
                    Submit Report
                  </Button>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Stack>
    </LocalizationProvider>
  );
};

export default VenueNumbersList;

