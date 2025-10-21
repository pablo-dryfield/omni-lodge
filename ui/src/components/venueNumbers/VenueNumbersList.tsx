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
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { ArrowBack, Add, Delete, Edit, Save, Send, UploadFile, Visibility } from "@mui/icons-material";
import dayjs from "dayjs";
import { ChangeEvent, SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { fetchVenues } from "../../actions/venueActions";
import { loadCatalog, selectCatalog } from "../../store/catalogSlice";
import axiosInstance from "../../utils/axiosInstance";

import type { NightReport, NightReportSummary, NightReportVenueInput } from "../../types/nightReports/NightReport";
import type { Counter } from "../../types/counters/Counter";
import type { StaffOption } from "../../types/counters/CounterRegistry";
import type { User } from "../../types/users/User";
import type { Venue } from "../../types/venues/Venue";

type EditableVenue = {
  tempKey: string;
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

const generateTempKey = (): string => `tmp-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;

const createEmptyVenue = (): EditableVenue => ({
  tempKey: generateTempKey(),
  id: undefined,
  venueName: "",
  totalPeople: "",
  normalCount: "",
  cocktailsCount: "",
  brunchCount: "",
});

const DID_NOT_OPERATE_NOTE = "The activity didn't operate.";
const SELECT_OPEN_BAR_PLACEHOLDER = "Select Open Bar";

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
      tempKey: generateTempKey(),
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

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let value = bytes;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = value % 1 === 0 ? value.toString() : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
};

const resolvePhotoDownloadUrl = (downloadUrl: string): string => {
  const base = axiosInstance.defaults.baseURL || (typeof window !== "undefined" ? window.location.origin : "");
  if (base) {
    try {
      return new URL(downloadUrl, base).toString();
    } catch {
      // fall through to return raw value
    }
  }
  return downloadUrl;
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

const formatUserFullName = (user: Partial<User> | StaffOption | undefined): string => {
  if (!user) {
    return "";
  }
  const full = (user as { fullName?: string }).fullName ?? "";
  if (full.trim()) {
    return full.trim();
  }
  const first = (user as { firstName?: string | null }).firstName ?? "";
  const last = (user as { lastName?: string | null }).lastName ?? "";
  const fallback = (user as Partial<User>).username ?? "";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const nightReportListState = useAppSelector((state) => state.nightReports.list[0]);
  const nightReportDetail = useAppSelector((state) => state.nightReports.detail);
  const nightReportUi = useAppSelector((state) => state.nightReports.ui);
  const countersState = useAppSelector((state) => state.counters[0]);
  const venuesState = useAppSelector((state) => state.venues[0]);
  const catalog = useAppSelector(selectCatalog);

  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [formState, setFormState] = useState<EditableReport>(() => toEditableReport(null));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [activeReportMode, setActiveReportMode] = useState<"view" | "edit" | null>(null);
  const [pendingChanges, setPendingChanges] = useState<boolean>(false);
  const [notesExpanded, setNotesExpanded] = useState<boolean>(false);
  const [didNotOperate, setDidNotOperate] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [editableVenueKeys, setEditableVenueKeys] = useState<Set<string>>(() => new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [photoPreviews, setPhotoPreviews] = useState<Record<number, string>>({});
  const [photoPreviewErrors, setPhotoPreviewErrors] = useState<Record<number, boolean>>({});
  const requestedPhotoIds = useRef<Set<number>>(new Set());
  const photoPreviewUrlsRef = useRef<Record<number, string>>({});
  const modeRequestRef = useRef<"view" | "edit" | null>(null);
  const lastLoadedReportIdRef = useRef<number | null>(null);
  const previousVenuesRef = useRef<EditableVenue[] | null>(null);
  const previousNotesRef = useRef<string | null>(null);
  const previousEditableVenueKeysRef = useRef<Set<string> | null>(null);

  const requestedCounterId = useMemo(() => {
    const raw = searchParams.get("counterId");
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }, [searchParams]);

  const { venuesOptions, openBarVenueOptions } = useMemo(() => {
    const venues = (venuesState.data[0]?.data as Venue[] | undefined) ?? [];
    const activeVenues = venues
      .filter((venue) => venue.isActive !== false)
      .sort((a, b) => {
        const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
      });

    const allVenueNames = activeVenues.map((venue) => venue.name);
    const openBarNames = activeVenues.filter((venue) => venue.allowsOpenBar === true).map((venue) => venue.name);

    return {
      venuesOptions: allVenueNames,
      openBarVenueOptions: openBarNames,
    };
  }, [venuesState.data]);

  const counters = useMemo(() => (countersState.data[0]?.data as Counter[] | undefined) ?? [], [countersState.data]);
  const reports = useMemo(
    () => (nightReportListState.data[0]?.data as NightReportSummary[] | undefined) ?? [],
    [nightReportListState.data],
  );
  const photos = useMemo(() => nightReportDetail.data?.photos ?? [], [nightReportDetail.data?.photos]);
  const photoLimitReached = photos.length >= 1;
  const limitedPhotos = useMemo(() => photos.slice(0, 1), [photos]);
  const leaderOptions = useMemo(() => {
    const base = (catalog.managers ?? []).filter((item): item is StaffOption => item != null);
    if (formState.leaderId == null) {
      return base;
    }
    if (base.some((manager) => manager.id === formState.leaderId)) {
      return base;
    }
    const reportLeader = nightReportDetail.data?.leader;
    if (reportLeader && reportLeader.id === formState.leaderId) {
      const nameParts = reportLeader.fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
      const firstName = nameParts[0] ?? "";
      const lastName = nameParts.slice(1).join(" ");
      const fallbackOption: StaffOption = {
        id: reportLeader.id,
        firstName,
        lastName,
        fullName: reportLeader.fullName,
        userTypeSlug: null,
        userTypeName: null,
      };
      return [...base, fallbackOption];
    }
    return base;
  }, [catalog.managers, formState.leaderId, nightReportDetail.data?.leader]);
  const selectedLeaderOption = useMemo(
    () => leaderOptions.find((leader) => leader.id === formState.leaderId) ?? null,
    [leaderOptions, formState.leaderId],
  );

  useEffect(() => {
    photoPreviewUrlsRef.current = photoPreviews;
  }, [photoPreviews]);

  useEffect(() => {
    dispatch(fetchNightReports());
    dispatch(fetchCounters());
    dispatch(fetchVenues());
  }, [dispatch]);

  useEffect(() => {
    if (!catalog.loaded && !catalog.loading) {
      dispatch(loadCatalog());
    }
  }, [catalog.loaded, catalog.loading, dispatch]);

  useEffect(() => {
    if (!reports.length) {
      if (selectedReportId !== null) {
        setSelectedReportId(null);
        setSearchParams({});
      }
      return;
    }
    if (selectedReportId !== null && !reports.some((report) => report.id === selectedReportId)) {
      setSelectedReportId(null);
      setSearchParams({});
    }
  }, [reports, selectedReportId, setSearchParams]);

  useEffect(() => {
    if (requestedCounterId == null) {
      return;
    }
    if (!reports.length) {
      return;
    }
    if (pendingChanges) {
      return;
    }
    const matching = reports.find((report) => report.counterId === requestedCounterId);
    if (matching && matching.id !== selectedReportId) {
      setSelectedReportId(matching.id);
    }
  }, [pendingChanges, requestedCounterId, reports, selectedReportId]);

  useEffect(() => {
    if (selectedReportId != null) {
      dispatch(fetchNightReportById(selectedReportId));
    }
  }, [dispatch, selectedReportId]);

  const getVenueKey = useCallback(
    (venue: EditableVenue, index: number) =>
      venue.id != null ? `id-${venue.id}` : venue.tempKey ?? `temp-${index}`,
    [],
  );

  const computeInitialEditableKeys = useCallback(
    (venues: EditableVenue[]) => {
      const initial = new Set<string>();
      venues.forEach((venue, idx) => {
        const trimmed = venue.venueName.trim().toLowerCase();
        if (!trimmed || trimmed === SELECT_OPEN_BAR_PLACEHOLDER.toLowerCase()) {
          initial.add(getVenueKey(venue, idx));
        }
      });
      return initial;
    },
    [getVenueKey],
  );

  useEffect(() => {
    if (selectedReportId == null) {
      return;
    }
    const detailId = nightReportDetail.data?.id ?? null;
    if (detailId !== selectedReportId) {
      return;
    }

    const next = toEditableReport(nightReportDetail.data);
    const serverVenues = nightReportDetail.data?.venues ?? [];
    const initialDidNotOperate = Array.isArray(serverVenues) && serverVenues.length === 0;

    const normalizedForm: EditableReport = initialDidNotOperate
      ? {
          ...next,
          venues: [],
          notes: next.notes?.trim().length ? next.notes : DID_NOT_OPERATE_NOTE,
        }
      : next;

    if (initialDidNotOperate) {
      previousVenuesRef.current = next.venues.map((venue) => ({ ...venue }));
      previousNotesRef.current = next.notes ?? "";
    } else {
      previousVenuesRef.current = null;
      previousNotesRef.current = null;
    }

    setFormState(normalizedForm);
    setDidNotOperate(initialDidNotOperate);
    setPendingChanges(false);
    const initialEditableKeys = computeInitialEditableKeys(normalizedForm.venues);
    setEditableVenueKeys(initialEditableKeys);
    previousEditableVenueKeysRef.current = null;
    setValidationError(null);
    setNotesExpanded(Boolean(normalizedForm.notes) || initialDidNotOperate);

    const status = nightReportDetail.data?.status ?? "draft";
    const requestedMode = modeRequestRef.current;
    modeRequestRef.current = null;

    setActiveReportMode((prev) => {
      const lastLoadedId = lastLoadedReportIdRef.current;
      const isNewReport = lastLoadedId == null || lastLoadedId !== selectedReportId;
      lastLoadedReportIdRef.current = selectedReportId;

      if (requestedMode) {
        return requestedMode;
      }
      if (prev === "edit" && status === "submitted") {
        return "view";
      }
      if (isNewReport) {
        return initialDidNotOperate ? "view" : prev;
      }
      return prev;
    });
  }, [nightReportDetail.data, selectedReportId, computeInitialEditableKeys]);

  useEffect(() => {
    if (selectedReportId === null) {
      setActiveReportMode(null);
      modeRequestRef.current = null;
      lastLoadedReportIdRef.current = null;
      setPendingChanges(false);
      previousEditableVenueKeysRef.current = null;
      setEditableVenueKeys(new Set());
      previousEditableVenueKeysRef.current = null;
      previousEditableVenueKeysRef.current = null;
      setValidationError(null);
      setNotesExpanded(false);
      setDidNotOperate(false);
      previousVenuesRef.current = null;
      previousNotesRef.current = null;
    }
  }, [selectedReportId]);

  useEffect(() => {
    if (openBarVenueOptions.length === 0 || didNotOperate) {
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
      updated[OPEN_BAR_INDEX] = { ...first, venueName: openBarVenueOptions[0] };
      return { ...prev, venues: updated };
    });
  }, [openBarVenueOptions, didNotOperate]);

  useEffect(() => {
    const currentIds = new Set(photos.map((photo) => photo.id));
    setPhotoPreviews((prev) => {
      let changed = false;
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([key, url]) => {
        const id = Number(key);
        if (currentIds.has(id)) {
          next[id] = url;
        } else {
          if (url) {
            URL.revokeObjectURL(url);
          }
          requestedPhotoIds.current.delete(id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setPhotoPreviewErrors((prev) => {
      let changed = false;
      const next: Record<number, boolean> = {};
      Object.entries(prev).forEach(([key, hasError]) => {
        const id = Number(key);
        if (currentIds.has(id)) {
          next[id] = hasError;
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [photos]);

  useEffect(() => {
    let isActive = true;
    const previews = photoPreviewUrlsRef.current;
    const pending = photos.filter(
      (photo) => photo.downloadUrl && !requestedPhotoIds.current.has(photo.id) && !previews[photo.id],
    );
    if (pending.length === 0) {
      return () => {
        isActive = false;
      };
    }
    pending.forEach((photo) => {
      requestedPhotoIds.current.add(photo.id);
      const downloadUrl = resolvePhotoDownloadUrl(photo.downloadUrl);
      axiosInstance
        .get(downloadUrl, { responseType: "blob", withCredentials: true, baseURL: undefined })
        .then((response) => {
          if (!isActive) {
            return;
          }
          const objectUrl = URL.createObjectURL(response.data);
          setPhotoPreviewErrors((prev) => {
            if (!prev[photo.id]) {
              return prev;
            }
            const next = { ...prev };
            delete next[photo.id];
            return next;
          });
          setPhotoPreviews((prev) => {
            const previousUrl = prev[photo.id];
            if (previousUrl) {
              URL.revokeObjectURL(previousUrl);
            }
            return { ...prev, [photo.id]: objectUrl };
          });
        })
        .catch(() => {
          if (!isActive) {
            return;
          }
          setPhotoPreviewErrors((prev) => ({ ...prev, [photo.id]: true }));
        });
    });
    return () => {
      isActive = false;
    };
  }, [photos]);

  useEffect(
    () => () => {
      Object.values(photoPreviewUrlsRef.current).forEach((url) => {
        if (url) {
          URL.revokeObjectURL(url);
        }
      });
    },
    [],
  );

  const handleOpenReport = useCallback(
    (report: NightReportSummary, mode: "view" | "edit") => {
      if (pendingChanges && selectedReportId && report.id !== selectedReportId) {
        setValidationError("Submit or discard your edits before switching reports.");
        return;
      }

      setValidationError(null);
      setSearchParams({ counterId: String(report.counterId) });

      if (report.id === selectedReportId) {
        setActiveReportMode(mode);
        modeRequestRef.current = null;
        return;
      }

      modeRequestRef.current = mode;
      setActiveReportMode(mode);
      setSelectedReportId(report.id);
    },
    [pendingChanges, selectedReportId, setSearchParams],
  );

  const handleCloseDetails = useCallback(() => {
    if (pendingChanges) {
      setValidationError("Submit or discard your edits before closing.");
      return;
    }

    setValidationError(null);
    setSelectedReportId(null);
    setActiveReportMode(null);
    modeRequestRef.current = null;
    lastLoadedReportIdRef.current = null;
    setFormState(toEditableReport(null));
    setNotesExpanded(false);
    setSearchParams({});
  }, [pendingChanges, setSearchParams]);

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
    if (didNotOperate) {
      return null;
    }
    if (report.venues.length === 0) {
      return "Add at least one venue.";
    }

    const venueSet = new Set(venuesOptions.map((name) => name.toLowerCase()));
    const openBarAllowedSet = new Set(openBarVenueOptions.map((name) => name.toLowerCase()));

    for (const [index, venue] of report.venues.entries()) {
      const trimmed = venue.venueName.trim();
      if (!trimmed) {
        return "Select a venue from the list.";
      }

      if (!venueSet.has(trimmed.toLowerCase())) {
        return `"${venue.venueName}" is not part of the venues directory.`;
      }

      if (index === OPEN_BAR_INDEX) {
        if (trimmed.toLowerCase() === SELECT_OPEN_BAR_PLACEHOLDER.toLowerCase()) {
          return "Select the open-bar venue.";
        }
        if (openBarAllowedSet.size > 0 && !openBarAllowedSet.has(trimmed.toLowerCase())) {
          return `"${venue.venueName}" cannot be used for the open bar.`;
        }

        const normal = normalizeNumber(venue.normalCount);
        const cocktails = normalizeNumber(venue.cocktailsCount);
        const brunch = normalizeNumber(venue.brunchCount);
        if (normal == null || cocktails == null || brunch == null) {
          return "Provide Normal, Cocktails, and Brunch counts for the open-bar venue.";
        }
      } else {
        const total = normalizeNumber(venue.totalPeople);
        if (total == null) {
          const fallbackVenueName = `Venue ${index}`;
          return `Provide total people for ${venue.venueName || fallbackVenueName}.`;
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
    const newVenue = { ...createEmptyVenue(), venueName: "" };
    const newKey = getVenueKey(newVenue, formState.venues.length);
    setFormState((prev) => {
      return {
        ...prev,
        venues: [...prev.venues, newVenue],
      };
    });
    setEditableVenueKeys((prev) => {
      const next = new Set(prev);
      next.add(newKey);
      return next;
    });
  };

  const handleRemoveVenue = (index: number) => {
    if (index === OPEN_BAR_INDEX) {
      return;
    }
    const venueToRemove = formState.venues[index];
    setValidationError(null);
    setPendingChanges(true);
    setFormState((prev) => ({
      ...prev,
      venues: prev.venues.filter((_, idx) => idx !== index),
    }));
    if (venueToRemove) {
      const keyToRemove = getVenueKey(venueToRemove, index);
      setEditableVenueKeys((prev) => {
        const next = new Set(prev);
        next.delete(keyToRemove);
        return next;
      });
    }
  };

  const handleVenueEditToggle = (index: number) => {
    setValidationError(null);
    const venue = formState.venues[index];
    if (!venue) {
      return;
    }
    const key = getVenueKey(venue, index);
    setEditableVenueKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleLeaderChange = (_: SyntheticEvent, value: StaffOption | null) => {
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

  const handlePhotoUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handlePhotoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file || !selectedReportId || photoLimitReached) {
      input.value = "";
      return;
    }
    dispatch(uploadNightReportPhoto({ reportId: selectedReportId, file }));
    input.value = "";
  };

  const handleDidNotOperateToggle = () => {
    setValidationError(null);
    setPendingChanges(true);
    if (didNotOperate) {
      const restoredVenues =
        previousVenuesRef.current && previousVenuesRef.current.length > 0
          ? previousVenuesRef.current.map((venue) => ({ ...venue }))
          : [createEmptyVenue()];
      const restoredNotes = previousNotesRef.current ?? "";
      const restoredEditableKeys =
        previousEditableVenueKeysRef.current ??
        computeInitialEditableKeys(restoredVenues);
      setFormState((prev) => ({
        ...prev,
        venues: restoredVenues,
        notes: restoredNotes,
      }));
      setDidNotOperate(false);
      setNotesExpanded(Boolean(restoredNotes));
      setEditableVenueKeys(restoredEditableKeys);
      previousVenuesRef.current = null;
      previousNotesRef.current = null;
      return;
    }

    previousVenuesRef.current = formState.venues.map((venue) => ({ ...venue }));
    previousNotesRef.current = formState.notes;
    previousEditableVenueKeysRef.current = new Set(editableVenueKeys);
    setFormState((prev) => ({
      ...prev,
      venues: [],
      notes: DID_NOT_OPERATE_NOTE,
    }));
    setNotesExpanded(true);
    setDidNotOperate(true);
    setEditableVenueKeys(new Set());
      previousEditableVenueKeysRef.current = null;
      previousEditableVenueKeysRef.current = null;
  };

  const handleDeletePhoto = (photoId: number) => {
    if (!selectedReportId) {
      return;
    }
    dispatch(deleteNightReportPhoto({ reportId: selectedReportId, photoId }));
  };

  const createUpdatePayload = useCallback(
    () => ({
      activityDate: formState.activityDate,
      leaderId: formState.leaderId ?? undefined,
      notes: formState.notes || undefined,
      venues: buildVenuePayload(formState),
    }),
    [formState],
  );

  const handleSaveVenues = async () => {
    if (!selectedReportId) {
      setValidationError("Select a report to save.");
      return;
    }
    const error = validateForm(formState);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    const payload = createUpdatePayload();
    try {
      setSaving(true);
      await dispatch(updateNightReport({ reportId: selectedReportId, payload })).unwrap();
      await dispatch(fetchNightReportById(selectedReportId));
      await dispatch(fetchNightReports());
      setPendingChanges(false);
      setEditableVenueKeys(new Set());
      previousEditableVenueKeysRef.current = null;
    } catch (saveError) {
      const message =
        typeof saveError === "string"
          ? saveError
          : saveError instanceof Error
            ? saveError.message
            : "Failed to save venues.";
      setValidationError(message);
    } finally {
      setSaving(false);
    }
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

    const payload = createUpdatePayload();

    const isAlreadySubmitted = currentStatus === "submitted";

    try {
      await dispatch(updateNightReport({ reportId: selectedReportId, payload })).unwrap();
      if (!isAlreadySubmitted) {
        await dispatch(submitNightReport(selectedReportId)).unwrap();
      }
      await dispatch(fetchNightReports());
      setEditableVenueKeys(new Set());
      previousEditableVenueKeysRef.current = null;
      setActiveReportMode("view");
      setPendingChanges(false);
    } catch (submissionError) {
      const fallbackMessage = isAlreadySubmitted ? "Failed to save report." : "Failed to submit report.";
      const message =
        typeof submissionError === "string"
          ? submissionError
          : submissionError instanceof Error
            ? submissionError.message
            : fallbackMessage;
      setValidationError(message);
    }
  };

  const reportsLoading = nightReportListState.loading;
  const detailLoading = nightReportDetail.loading;
  const submitting = nightReportUi.submitting;
  const uploadingPhoto = nightReportUi.uploadingPhoto;
  const currentStatus = nightReportDetail.data?.status ?? "draft";
  const isSubmittedReport = currentStatus === "submitted";
  const submitButtonLabel = isSubmittedReport ? "Save Changes" : "Submit Report";
  const readOnly = activeReportMode !== "edit";
  const inEditMode = activeReportMode === "edit";
  const showNoReportDetails = readOnly && didNotOperate;
  const showDetails = selectedReportId != null && activeReportMode != null;
  const currentCounter = counters.find((counter) => counter.id === formState.counterId);
  const formHasFieldErrors = useMemo(() => {
    if (readOnly || didNotOperate) {
      return false;
    }
    if (formState.venues.length === 0) {
      return true;
    }
    const venueSet = new Set(venuesOptions.map((name) => name.toLowerCase()));
    const openBarAllowedSet = new Set(openBarVenueOptions.map((name) => name.toLowerCase()));

    return formState.venues.some((venue, index) => {
      const trimmed = venue.venueName.trim();
      if (!trimmed) {
        return true;
      }
      if (index === OPEN_BAR_INDEX) {
        const lowerTrimmed = trimmed.toLowerCase();
        if (
          lowerTrimmed === SELECT_OPEN_BAR_PLACEHOLDER.toLowerCase() ||
          (openBarAllowedSet.size > 0 && !openBarAllowedSet.has(lowerTrimmed))
        ) {
          return true;
        }
        if (!venueSet.has(lowerTrimmed)) {
          return true;
        }
        const normal = normalizeNumber(venue.normalCount);
        const cocktails = normalizeNumber(venue.cocktailsCount);
        const brunch = normalizeNumber(venue.brunchCount);
        return normal == null || cocktails == null || brunch == null;
      }
      if (!venueSet.has(trimmed.toLowerCase())) {
        return true;
      }
      const total = normalizeNumber(venue.totalPeople);
      return total == null;
    });
  }, [readOnly, didNotOperate, formState.venues, venuesOptions, openBarVenueOptions]);

  const leaderHasError = useMemo(
    () => !readOnly && !didNotOperate && (!formState.leaderId || !selectedLeaderOption),
    [readOnly, didNotOperate, formState.leaderId, selectedLeaderOption],
  );

  const renderReportDetails = () => {
    const notesSection = (
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
    );

    if (showNoReportDetails) {
      return (
        <>
          <Typography variant="body2" color="text.secondary">
            No report information.
          </Typography>
          {notesSection}
        </>
      );
    }

    const venuesSection = (
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="h6" flexGrow={1}>
            Venues
          </Typography>
          {!readOnly && (
            <Button
              variant={didNotOperate ? "contained" : "outlined"}
              color={didNotOperate ? "warning" : "inherit"}
              onClick={handleDidNotOperateToggle}
            >
              DIDN'T OPERATE
            </Button>
          )}
        </Stack>
        <Divider />
        <Stack spacing={2}>
          {formState.venues.map((venue, index) => {
            const isOpenBar = index === OPEN_BAR_INDEX;
            const availableOptions = (() => {
              const baseOptions = isOpenBar ? openBarVenueOptions : venuesOptions;
              if (!venue.venueName) {
                return baseOptions;
              }
              const set = new Set(baseOptions.map((name) => name.toLowerCase()));
              if (!set.has(venue.venueName.toLowerCase())) {
                return [...baseOptions, venue.venueName];
              }
              return baseOptions;
            })();
            const venueKey = getVenueKey(venue, index);
            const isEditableVenue = editableVenueKeys.has(venueKey);
            const fieldsDisabled = readOnly || !isEditableVenue;
            const normalizedVenueName = venue.venueName.trim();
            const showVenueError =
              !fieldsDisabled &&
              (!normalizedVenueName ||
                (isOpenBar && normalizedVenueName.toLowerCase() === SELECT_OPEN_BAR_PLACEHOLDER.toLowerCase()));
            const showTotalError =
              !fieldsDisabled && !isOpenBar && (venue.totalPeople == null || venue.totalPeople.trim().length === 0);

            return (
              <Stack key={getVenueKey(venue, index)} spacing={1}>
                <Card variant="outlined">
                  <CardContent>
                    <Stack spacing={2}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography fontWeight={600}>
                          {isOpenBar ? "Open Bar" : `Venue ${index}`}
                        </Typography>
                        <Box flexGrow={1} />
                        {!readOnly && (
                          <Tooltip title={isEditableVenue ? "Lock venue" : "Edit venue"}>
                            <IconButton size="small" onClick={() => handleVenueEditToggle(index)}>
                              <Edit fontSize="small" color={isEditableVenue ? "primary" : "inherit"} />
                            </IconButton>
                          </Tooltip>
                        )}
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
                          <Autocomplete<string>
                            options={availableOptions}
                            value={venue.venueName}
                            onChange={(_, value) => handleVenueChange(index, "venueName", value ?? "")}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                label="Venue"
                                placeholder="Select venue"
                                required
                                error={showVenueError}
                                helperText={showVenueError ? "Select a venue." : undefined}
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
                            disabled={fieldsDisabled}
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
                            <Grid size={4}>
                              <TextField
                                label="Normal"
                                value={venue.normalCount ?? ""}
                                onChange={(event) => handleVenueChange(index, "normalCount", event.target.value)}
                                type="number"
                                inputProps={{ min: 0 }}
                                fullWidth
                                disabled={fieldsDisabled}
                              />
                            </Grid>
                            <Grid size={4}>
                              <TextField
                                label="Cocktails"
                                value={venue.cocktailsCount ?? ""}
                                onChange={(event) => handleVenueChange(index, "cocktailsCount", event.target.value)}
                                type="number"
                                inputProps={{ min: 0 }}
                                fullWidth
                                disabled={fieldsDisabled}
                              />
                            </Grid>
                            <Grid size={4}>
                              <TextField
                                label="Brunch"
                                value={venue.brunchCount ?? ""}
                                onChange={(event) => handleVenueChange(index, "brunchCount", event.target.value)}
                                type="number"
                                inputProps={{ min: 0 }}
                                fullWidth
                                disabled={fieldsDisabled}
                              />
                            </Grid>
                          </>
                        ) : (
                          <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                              label="Total People"
                              value={venue.totalPeople}
                              onChange={(event) => handleVenueChange(index, "totalPeople", event.target.value)}
                                type="number"
                                inputProps={{ min: 0 }}
                                fullWidth
                                disabled={fieldsDisabled}
                                required
                                error={showTotalError}
                                helperText={showTotalError ? "Total people is required." : undefined}
                              />
                          </Grid>
                        )}
                      </Grid>
                    </Stack>
                  </CardContent>
                </Card>
              </Stack>
            );
          })}
          {!readOnly && !didNotOperate ? (
            <Stack direction="row" spacing={1} justifyContent="center" alignItems="center">
              <Button startIcon={<Add />} variant="outlined" onClick={handleAddVenue} sx={{ minWidth: 160 }}>
                Add Venue
              </Button>
              <Button
                startIcon={<Save />}
                variant="contained"
                color="primary"
                onClick={handleSaveVenues}
                disabled={
                  !selectedReportId ||
                  readOnly ||
                  submitting ||
                  saving ||
                  formHasFieldErrors ||
                  leaderHasError ||
                  !pendingChanges
                }
              >
                Save
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </Stack>
    );

    const photosSection = (
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="h6" flexGrow={1}>
            Report Evidence
          </Typography>
          {!readOnly && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<UploadFile />}
              onClick={handlePhotoUploadClick}
              disabled={!selectedReportId || uploadingPhoto || photoLimitReached}
            >
              Upload Photo
            </Button>
          )}
        </Stack>
        {!readOnly && (
          <Typography variant="caption" color="text.secondary">
            Only one photo can be attached.
          </Typography>
        )}
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={handlePhotoFileChange}
        />
        {uploadingPhoto && <CircularProgress size={20} />}
        {photos.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {readOnly
              ? "No photos attached to this report."
              : "No photos yet. Upload supporting photos for this report."}
          </Typography>
        ) : (
          <Grid container spacing={2}>
            {limitedPhotos.map((photo) => {
              const previewUrl = photoPreviews[photo.id];
              const previewError = photoPreviewErrors[photo.id];
              const downloadHref = resolvePhotoDownloadUrl(photo.downloadUrl);
              return (
                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={photo.id}>
                  <Card variant="outlined">
                    <CardContent>
                      <Stack spacing={1}>
                        <Box
                          sx={{
                            width: "100%",
                            height: 180,
                            borderRadius: 1,
                            bgcolor: "grey.100",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            border: "1px solid",
                            borderColor: "divider",
                            position: "relative",
                          }}
                        >
                          {previewUrl ? (
                            <Box
                              component="img"
                              src={previewUrl}
                              alt={photo.originalName}
                              sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          ) : previewError ? (
                            <Typography variant="caption" color="text.secondary" align="center" px={2}>
                              Preview unavailable
                            </Typography>
                          ) : (
                            <CircularProgress size={24} />
                          )}
                          {!readOnly && (
                            <Tooltip title="Delete photo">
                              <span>
                                <IconButton
                                  size="small"
                                  aria-label="Delete photo"
                                  onClick={() => handleDeletePhoto(photo.id)}
                                  disabled={uploadingPhoto}
                                  sx={{
                                    position: "absolute",
                                    top: 8,
                                    right: 8,
                                    bgcolor: "rgba(0, 0, 0, 0.6)",
                                    color: "common.white",
                                    "&:hover": {
                                      bgcolor: "error.main",
                                      color: "common.white",
                                    },
                                  }}
                                >
                                  <Delete fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="flex-start">
                          <Box flexGrow={1}>
                            <Typography variant="body2" fontWeight={600} noWrap title={photo.originalName}>
                              {photo.originalName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {formatFileSize(photo.fileSize)}
                              {photo.capturedAt ? (
                                <>
                                  {" \u2022 "}
                                  {dayjs(photo.capturedAt).format("MMM D, YYYY h:mm A")}
                                </>
                              ) : null}
                            </Typography>
                          </Box>
                        </Stack>
                        <Button
                          variant="outlined"
                          size="small"
                          component="a"
                          href={downloadHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View Full Size
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        )}
      </Stack>
    );

    return (
      <>
        {venuesSection}
        {photosSection}
        {notesSection}
      </>
    );
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Button variant="text" startIcon={<ArrowBack />} onClick={() => navigate(-1)}>
            Back
          </Button>
          <Box flexGrow={1} />
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
                  {reports.map((report) => {
                    const isActive = selectedReportId === report.id && activeReportMode != null;
                    const isViewing = isActive && activeReportMode === "view";
                    const isEditing = isActive && activeReportMode === "edit";
                    const disableActions = pendingChanges && selectedReportId !== report.id;
                    const isDraftReport = (report.status ?? "").toLowerCase() === "draft";
                    const updateLabel = isDraftReport ? "Fill" : "Update";

                    return (
                      <ListItem
                        key={report.id}
                        disablePadding
                        sx={{
                          px: 2,
                          py: 1.5,
                          display: "block",
                          bgcolor: isActive ? "action.selected" : "inherit",
                          "&:not(:last-of-type)": { borderBottom: "1px solid", borderColor: "divider" },
                        }}
                      >
                        <Stack spacing={1}>
                          <Stack
                            direction={{ xs: "column", sm: "row" }}
                            spacing={1}
                            alignItems={{ xs: "flex-start", sm: "center" }}
                          >
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexGrow: 1 }}>
                              <Typography fontWeight={600}>
                                {dayjs(report.activityDate).format("MMM D, YYYY")}
                              </Typography>
                              <Chip
                                size="small"
                                label={report.status === "submitted" ? "Submitted" : "Draft"}
                                color={report.status === "submitted" ? "success" : "default"}
                              />
                            </Stack>
                            <Stack
                              direction="row"
                              spacing={1}
                              flexWrap="wrap"
                              justifyContent={{ xs: "flex-start", sm: "flex-end" }}
                              sx={{ width: { xs: "100%", sm: "auto" } }}
                            >
                              <Button
                                size="small"
                                variant={isViewing ? "contained" : "outlined"}
                                startIcon={<Visibility fontSize="small" />}
                                onClick={() => handleOpenReport(report, "view")}
                                disabled={disableActions}
                              >
                                View
                              </Button>
                              <Button
                                size="small"
                                variant={isEditing ? "contained" : "outlined"}
                                startIcon={<Edit fontSize="small" />}
                                onClick={() => handleOpenReport(report, "edit")}
                                disabled={disableActions}
                              >
                                {updateLabel}
                              </Button>
                            </Stack>
                          </Stack>
                          <Stack spacing={0.5}>
                            <Typography variant="body2" color="text.secondary">
                              Leader: {report.leaderName || "—"}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Venues: {report.venuesCount}
                            </Typography>
                          </Stack>
                        </Stack>
                      </ListItem>
                    );
                  })}
                </List>
              )}
            </CardContent>
          </Card>

          {showDetails ? (
            <Card sx={{ flex: 1, minHeight: 420 }}>
              <CardContent>
                {detailLoading ? (
                  <Stack alignItems="center" justifyContent="center" minHeight={220}>
                    <CircularProgress size={36} />
                  </Stack>
                ) : (
                  <Stack spacing={3}>
                    {currentStatus === "submitted" && !inEditMode && (
                      <Alert severity="info">Submitted - Click Update to make changes.</Alert>
                    )}
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Date:{" "}
                        <Typography component="span" variant="body1" fontWeight={600}>
                          {formState.activityDate ? dayjs(formState.activityDate).format("MMM D, YYYY") : "—"}
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
                        <Autocomplete<StaffOption>
                          options={leaderOptions}
                          value={selectedLeaderOption}
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
                              error={leaderHasError}
                              helperText={leaderHasError ? "Select a leader." : undefined}
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

                    {renderReportDetails()}

                    {inEditMode ? (
                      <Button
                        variant="contained"
                        color="success"
                        startIcon={<Send />}
                        onClick={handleSubmit}
                        disabled={!selectedReportId || submitting || readOnly || formHasFieldErrors || leaderHasError}
                        sx={{ alignSelf: "center" }}
                      >
                        {submitButtonLabel}
                      </Button>
                    ) : (
                      <Button variant="outlined" onClick={handleCloseDetails} sx={{ alignSelf: "center" }}>
                        Close
                      </Button>
                    )}
                  </Stack>
                )}
              </CardContent>
            </Card>
          ) : null}
        </Stack>
      </Stack>
    </LocalizationProvider>
  );
};

export default VenueNumbersList;




