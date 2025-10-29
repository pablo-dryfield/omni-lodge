import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import axiosInstance from "../../utils/axiosInstance";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import Table from "../../utils/Table";
import { modifyColumn } from "../../utils/modifyColumn";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import type { StaffProfile } from "../../types/staffProfiles/StaffProfile";
import type { MRT_ColumnDef } from "mantine-react-table";
import { staffProfilesColumnDef } from "./staffProfilesColumnDef";
import type { EditSelectOption } from "../../utils/CustomEditSelect";
import {
  createStaffProfile,
  deleteStaffProfile,
  fetchStaffProfiles,
  updateStaffProfile,
} from "../../actions/staffProfileActions";

type CompactUser = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
};

const MODULE_SLUG = "staff-profile-directory";

const coerceStaffProfilePayload = (payload: Partial<StaffProfile>): Partial<StaffProfile> => {
  const next: Partial<StaffProfile> = { ...payload };

  if (next.userId !== undefined && next.userId !== null) {
    next.userId = Number(next.userId);
  }

  if (next.livesInAccom !== undefined && next.livesInAccom !== null) {
    next.livesInAccom = Boolean(next.livesInAccom);
  }

  if (next.active !== undefined && next.active !== null) {
    next.active = Boolean(next.active);
  }

  if (next.staffType !== undefined && next.staffType !== null) {
    next.staffType = next.staffType as StaffProfile["staffType"];
  }

  return next;
};

const StaffProfilesList = () => {
  const dispatch = useAppDispatch();
  const staffProfileState = useAppSelector((state) => state.staffProfiles)[0];
  const { loggedUserId } = useAppSelector((state) => state.session);
  const [userOptions, setUserOptions] = useState<EditSelectOption[]>([]);
  const [userLabelById, setUserLabelById] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    dispatch(fetchStaffProfiles());
  }, [dispatch]);

  useEffect(() => {
    const fetchUserOptions = async () => {
      try {
        const response = await axiosInstance.get<CompactUser[]>("/users", {
          params: { format: "compact" },
          withCredentials: true,
        });

        const options: EditSelectOption[] = [];
        const labelMap = new Map<number, string>();

        response.data.forEach((user) => {
          if (typeof user.id !== "number") {
            return;
          }
          const fallbackName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
          const fullName = user.fullName ?? (fallbackName || `User #${user.id}`);
          labelMap.set(user.id, fullName);
          options.push({
            value: String(user.id),
            label: `${fullName} (#${user.id})`,
          });
        });

        setUserOptions(options);
        setUserLabelById(labelMap);
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error("Failed to load users", error.response?.data ?? error.message);
        } else {
          console.error("Failed to load users", error);
        }
      }
    };

    fetchUserOptions().catch((error) => console.error("Failed to load users", error));
  }, []);

  const staffProfiles = useMemo(
    () => staffProfileState.data[0]?.data ?? [],
    [staffProfileState.data],
  );

  const optionsWithStatus = useMemo<EditSelectOption[]>(() => {
    if (!userOptions.length) {
      return userOptions;
    }
    const assignedIds = new Set<number>(staffProfiles.map((profile) => Number(profile.userId)));
    return userOptions.map((option) => {
      const id = Number(option.value);
      if (!assignedIds.has(id)) {
        return option;
      }
      return {
        ...option,
        label: `${option.label} (has profile)`,
      };
    });
  }, [staffProfiles, userOptions]);

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<StaffProfile>>[]>(
    () =>
      modifyColumn(
        (staffProfileState.data[0]?.columns as MRT_ColumnDef<Partial<StaffProfile>>[]) ?? [],
        staffProfilesColumnDef({
          userLabelById,
          userOptions: optionsWithStatus,
        }),
      ),
    [optionsWithStatus, staffProfileState.data, userLabelById],
  );

  const initialState = useMemo(
    () => ({
      showColumnFilters: false,
      showGlobalFilter: true,
      columnVisibility: {
        createdAt: false,
        updatedAt: false,
        userEmail: false,
        userStatus: false,
      },
    }),
    [],
  );

  const sanitizePayload = (payload: Partial<StaffProfile>) => {
    const sanitized = removeEmptyKeys(coerceStaffProfilePayload(payload), loggedUserId ?? 0);
    delete sanitized.userName;
    delete sanitized.userEmail;
    delete sanitized.userStatus;
    delete sanitized.createdAt;
    delete sanitized.updatedAt;
    return sanitized;
  };

  const handleCreate = async (payload: Partial<StaffProfile>) => {
    const sanitized = sanitizePayload(payload);
    const userId = sanitized.userId;
    const staffType = sanitized.staffType;
    if (typeof userId !== "number" || !staffType) {
      console.warn("Staff profile requires a user and staff type");
      return;
    }

    try {
      await dispatch(createStaffProfile(sanitized)).unwrap();
      await dispatch(fetchStaffProfiles());
    } catch (error) {
      console.error("Failed to create staff profile", error);
    }
  };

  const handleUpdate = async (original: Partial<StaffProfile>, updated: Partial<StaffProfile>) => {
    const userId = original.userId;
    if (typeof userId !== "number") {
      console.warn("Unable to update staff profile without userId");
      return;
    }

    const delta = sanitizePayload(
      getChangedValues(original, coerceStaffProfilePayload(updated), loggedUserId ?? 0),
    );
    delete delta.userId;

    if (Object.keys(delta).length === 0) {
      return;
    }

    try {
      await dispatch(updateStaffProfile({ userId, data: delta })).unwrap();
      await dispatch(fetchStaffProfiles());
    } catch (error) {
      console.error("Failed to update staff profile", error);
    }
  };

  const handleDelete = async (record: Partial<StaffProfile>, count: number, iterator: number) => {
    const userId = record.userId;
    if (typeof userId !== "number") {
      console.warn("Unable to delete staff profile without userId");
      return;
    }

    try {
      await dispatch(deleteStaffProfile(userId)).unwrap();
      if (count === iterator) {
        await dispatch(fetchStaffProfiles());
      }
    } catch (error) {
      console.error("Failed to delete staff profile", error);
    }
  };

  return (
    <Table
      pageTitle="Staff Profiles"
      data={staffProfiles}
      loading={staffProfileState.loading}
      error={staffProfileState.error}
      columns={modifiedColumns}
      actions={{ handleCreate, handleUpdate, handleDelete }}
      initialState={initialState}
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default StaffProfilesList;
