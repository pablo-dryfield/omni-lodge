import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Divider,
  FileInput,
  Group,
  LoadingOverlay,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconDeviceFloppy, IconRefresh } from "@tabler/icons-react";

import { fetchUsers, updateUser } from "../actions/userActions";
import { fetchStaffProfiles } from "../actions/staffProfileActions";
import { setUserState } from "../actions/sessionActions";
import { useShiftRoleAssignments, useShiftRoles } from "../api/shiftRoles";
import type { StaffProfile } from "../types/staffProfiles/StaffProfile";
import type { User } from "../types/users/User";
import type { ShiftRole } from "../types/shiftRoles/ShiftRole";
import type { UserShiftRoleAssignment } from "../types/shiftRoles/UserShiftRoleAssignment";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { compressImageFile } from "../utils/imageCompression";
import { buildUserProfilePhotoUrl } from "../utils/profilePhoto";
import PhoneCodeSelectField from "../components/common/PhoneCodeSelectField";
import { PRONOUN_OPTIONS } from "../constants/pronouns";
import { DISCOVERY_SOURCE_OPTIONS } from "../constants/discoverySources";
import { EMAIL_REGEX, normalizePhoneNumber, isPhoneNumberValid } from "../utils/contactValidation";
import { DEFAULT_PHONE_CODE } from "../constants/phoneCodes";
import { buildPhoneFromParts, splitPhoneNumber } from "../utils/phone";

type FeedbackState = { type: "success" | "error"; message: string } | null;

const formatDateForInput = (value?: string | Date | null) => {
  if (!value) {
    return "";
  }
  if (typeof value === "string" && value.length >= 10) {
    return value.slice(0, 10);
  }
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toISOString().slice(0, 10);
  } catch {
    return "";
  }
};

type UserFormState = {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  countryOfCitizenship: string;
  dateOfBirth: string;
  preferredPronouns: string;
  whatsappHandle: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  emergencyContactEmail: string;
  arrivalDate: string;
  departureDate: string;
  dietaryRestrictions: string;
  allergies: string;
  medicalNotes: string;
  facebookProfileUrl: string;
  instagramProfileUrl: string;
  discoverySource: string;
};

type StaffProfileFormState = {
  staffType: StaffProfile["staffType"] | "";
  livesInAccom: boolean;
  active: boolean;
};

const PROFILE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PROFILE_PHOTO_COMPRESSION_OPTIONS = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.8,
  maxSizeBytes: 700 * 1024,
  force: true,
  outputMimeType: "image/jpeg" as const,
};

const userFieldMap: Record<keyof UserFormState, keyof User> = {
  username: "username",
  firstName: "firstName",
  lastName: "lastName",
  email: "email",
  phone: "phone",
  countryOfCitizenship: "countryOfCitizenship",
  dateOfBirth: "dateOfBirth",
  preferredPronouns: "preferredPronouns",
  whatsappHandle: "whatsappHandle",
  emergencyContactName: "emergencyContactName",
  emergencyContactRelationship: "emergencyContactRelationship",
  emergencyContactPhone: "emergencyContactPhone",
  emergencyContactEmail: "emergencyContactEmail",
  arrivalDate: "arrivalDate",
  departureDate: "departureDate",
  dietaryRestrictions: "dietaryRestrictions",
  allergies: "allergies",
  medicalNotes: "medicalNotes",
  facebookProfileUrl: "facebookProfileUrl",
  instagramProfileUrl: "instagramProfileUrl",
  discoverySource: "discoverySource",
};
const nullableUserFields: Array<keyof User> = [
  "phone",
  "countryOfCitizenship",
  "dateOfBirth",
  "preferredPronouns",
  "whatsappHandle",
  "emergencyContactName",
  "emergencyContactRelationship",
  "emergencyContactPhone",
  "emergencyContactEmail",
  "arrivalDate",
  "departureDate",
  "dietaryRestrictions",
  "allergies",
  "medicalNotes",
  "facebookProfileUrl",
  "instagramProfileUrl",
  "discoverySource",
];

const buildUserFormState = (user?: Partial<User>): UserFormState => ({
  username: user?.username ?? "",
  firstName: user?.firstName ?? "",
  lastName: user?.lastName ?? "",
  email: user?.email ?? "",
  phone: user?.phone ?? "",
  countryOfCitizenship: user?.countryOfCitizenship ?? "",
  dateOfBirth: formatDateForInput(user?.dateOfBirth ?? null),
  preferredPronouns: user?.preferredPronouns ?? "",
  whatsappHandle: user?.whatsappHandle ?? "",
  emergencyContactName: user?.emergencyContactName ?? "",
  emergencyContactRelationship: user?.emergencyContactRelationship ?? "",
  emergencyContactPhone: user?.emergencyContactPhone ?? "",
  emergencyContactEmail: user?.emergencyContactEmail ?? "",
  arrivalDate: formatDateForInput(user?.arrivalDate ?? null),
  departureDate: formatDateForInput(user?.departureDate ?? null),
  dietaryRestrictions: user?.dietaryRestrictions ?? "",
  allergies: user?.allergies ?? "",
  medicalNotes: user?.medicalNotes ?? "",
  facebookProfileUrl: user?.facebookProfileUrl ?? "",
  instagramProfileUrl: user?.instagramProfileUrl ?? "",
  discoverySource: user?.discoverySource ?? "",
});

const buildStaffProfileFormState = (profile?: Partial<StaffProfile>): StaffProfileFormState => ({
  staffType: profile?.staffType ?? "",
  livesInAccom: profile?.livesInAccom ?? false,
  active: profile?.active ?? true,
});

const toMessage = (error: unknown, fallback = "Something went wrong") => {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
};

const createNameFromUser = (user?: Partial<User>) => {
  const first = user?.firstName?.trim();
  const last = user?.lastName?.trim();
  if (first && last) {
    return `${first} ${last}`;
  }
  return user?.username ?? user?.email ?? user?.firstName ?? "Unknown user";
};

const makeInitials = (name: string | undefined) => {
  if (!name) {
    return "OL";
  }
  const segments = name.split(" ").filter(Boolean);
  if (segments.length === 0) {
    return "OL";
  }
  if (segments.length === 1) {
    return segments[0].slice(0, 2).toUpperCase();
  }
  return `${segments[0][0]}${segments[segments.length - 1][0]}`.toUpperCase();
};

const compareString = (value?: string | null) => value ?? "";

const derivePronounState = (value?: string | null) => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return { selection: "", custom: "" };
  }
  const matched = PRONOUN_OPTIONS.find(
    (option) => option.value.toLowerCase() === trimmed.toLowerCase(),
  );
  if (matched) {
    return { selection: matched.value, custom: "" };
  }
  return { selection: "custom", custom: trimmed };
};

const MyAccount = () => {
  const dispatch = useAppDispatch();
  const { loggedUserId } = useAppSelector((state) => state.session);
  const usersState = useAppSelector((state) => state.users)[0];
  const staffProfilesState = useAppSelector((state) => state.staffProfiles)[0];

  const shiftRolesQuery = useShiftRoles();
  const shiftRoleAssignmentsQuery = useShiftRoleAssignments();

  const userRecords = useMemo(
    () => (usersState.data?.[0]?.data ?? []) as Partial<User>[],
    [usersState],
  );
  const staffProfileRecords = useMemo(
    () => (staffProfilesState.data?.[0]?.data ?? []) as Partial<StaffProfile>[],
    [staffProfilesState],
  );

  const currentUser = useMemo(
    () => userRecords.find((record) => record.id === loggedUserId),
    [userRecords, loggedUserId],
  );
  const remoteProfilePhotoUrl = useMemo(
    () => buildUserProfilePhotoUrl({ user: currentUser }),
    [currentUser],
  );
  const currentStaffProfile = useMemo(
    () => staffProfileRecords.find((record) => record.userId === loggedUserId),
    [staffProfileRecords, loggedUserId],
  );
  const shiftRoleRecords = useMemo(
    () => (shiftRolesQuery.data?.[0]?.data ?? []) as ShiftRole[],
    [shiftRolesQuery.data],
  );
  const userRoleAssignment = useMemo(() => {
    const assignments = (shiftRoleAssignmentsQuery.data?.[0]?.data ?? []) as UserShiftRoleAssignment[];
    return assignments.find((assignment) => assignment.userId === loggedUserId);
  }, [shiftRoleAssignmentsQuery.data, loggedUserId]);

  const userBaseline = useMemo(() => buildUserFormState(currentUser), [currentUser]);
  const profileBaseline = useMemo(
    () => buildStaffProfileFormState(currentStaffProfile),
    [currentStaffProfile],
  );
  const pronounBaselineState = useMemo(
    () => derivePronounState(userBaseline.preferredPronouns),
    [userBaseline.preferredPronouns],
  );
  const [userForm, setUserForm] = useState<UserFormState>(userBaseline);
  const [pronounSelection, setPronounSelection] = useState(pronounBaselineState.selection);
  const [customPronouns, setCustomPronouns] = useState(pronounBaselineState.custom);
  const [pronounTouched, setPronounTouched] = useState(false);
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(remoteProfilePhotoUrl);
  const [profilePhotoError, setProfilePhotoError] = useState<string | null>(null);
  const [profilePhotoDirty, setProfilePhotoDirty] = useState(false);
  const [removePhotoRequested, setRemovePhotoRequested] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState<FeedbackState>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
  const photoObjectUrlRef = useRef<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emergencyPhoneError, setEmergencyPhoneError] = useState<string | null>(null);
  const [emergencyEmailError, setEmergencyEmailError] = useState<string | null>(null);
  const [phoneCountryCode, setPhoneCountryCode] = useState(DEFAULT_PHONE_CODE);
  const [phoneLocalNumber, setPhoneLocalNumber] = useState("");
  const [emergencyPhoneCountryCode, setEmergencyPhoneCountryCode] = useState(DEFAULT_PHONE_CODE);
  const [emergencyPhoneLocalNumber, setEmergencyPhoneLocalNumber] = useState("");
  const [useSameWhatsappNumber, setUseSameWhatsappNumber] = useState(true);
  const [whatsappCountryCode, setWhatsappCountryCode] = useState(DEFAULT_PHONE_CODE);
  const [whatsappLocalNumber, setWhatsappLocalNumber] = useState("");
  const [whatsappPhoneError, setWhatsappPhoneError] = useState<string | null>(null);

  useEffect(() => setUserForm(userBaseline), [userBaseline]);
  useEffect(() => {
    const phoneParts = splitPhoneNumber(userBaseline.phone);
    setPhoneCountryCode(phoneParts.code);
    setPhoneLocalNumber(phoneParts.digits);
    const emergencyParts = splitPhoneNumber(userBaseline.emergencyContactPhone);
    setEmergencyPhoneCountryCode(emergencyParts.code);
    setEmergencyPhoneLocalNumber(emergencyParts.digits);
  }, [userBaseline.phone, userBaseline.emergencyContactPhone]);
  useEffect(() => {
    const normalizedPhone = normalizePhoneNumber(compareString(userBaseline.phone));
    const normalizedWhatsapp = normalizePhoneNumber(compareString(userBaseline.whatsappHandle));
    const same = normalizedWhatsapp.length === 0 || normalizedWhatsapp === normalizedPhone;
    const phoneParts = splitPhoneNumber(userBaseline.phone);
    const whatsappParts = splitPhoneNumber(userBaseline.whatsappHandle);
    setUseSameWhatsappNumber(same);
    setWhatsappCountryCode(same ? phoneParts.code : whatsappParts.code);
    setWhatsappLocalNumber(same ? phoneParts.digits : whatsappParts.digits);
    setWhatsappPhoneError(null);
  }, [userBaseline.phone, userBaseline.whatsappHandle]);
  useEffect(() => {
    setPronounSelection(pronounBaselineState.selection);
    setCustomPronouns(pronounBaselineState.custom);
    setPronounTouched(false);
  }, [pronounBaselineState]);
  useEffect(() => {
    if (!profilePhotoDirty && !profilePhotoFile) {
      setProfilePhotoPreview(remoteProfilePhotoUrl);
    }
  }, [remoteProfilePhotoUrl, profilePhotoDirty, profilePhotoFile]);
  useEffect(
    () => () => {
      if (photoObjectUrlRef.current) {
        URL.revokeObjectURL(photoObjectUrlRef.current);
        photoObjectUrlRef.current = null;
      }
    },
    [],
  );
  useEffect(() => {
    setEmailError(null);
    setPhoneError(null);
    setEmergencyPhoneError(null);
    setEmergencyEmailError(null);
    setWhatsappPhoneError(null);
  }, [userBaseline]);
  useEffect(() => {
    if (!useSameWhatsappNumber) {
      return;
    }
    const normalizedPhone = normalizePhoneNumber(compareString(userForm.phone));
    const currentWhatsapp = compareString(userForm.whatsappHandle);
    if (currentWhatsapp !== normalizedPhone) {
      setUserForm((prev) => ({ ...prev, whatsappHandle: normalizedPhone }));
    }
    const phoneParts = splitPhoneNumber(userForm.phone);
    setWhatsappCountryCode(phoneParts.code);
    setWhatsappLocalNumber(phoneParts.digits);
    setWhatsappPhoneError(null);
  }, [useSameWhatsappNumber, userForm.phone, userForm.whatsappHandle]);

  const [userFeedback, setUserFeedback] = useState<FeedbackState>(null);
  const [userSaving, setUserSaving] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" });
  const [passwordFeedback, setPasswordFeedback] = useState<FeedbackState>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [usersRequested, setUsersRequested] = useState(false);
  const [staffProfilesRequested, setStaffProfilesRequested] = useState(false);

  useEffect(() => {
    if (loggedUserId && !currentUser && !usersState.loading && !usersRequested) {
      setUsersRequested(true);
      dispatch(fetchUsers());
    }
  }, [dispatch, loggedUserId, currentUser, usersRequested, usersState.loading]);

  useEffect(() => {
    if (loggedUserId && !currentStaffProfile && !staffProfilesState.loading && !staffProfilesRequested) {
      setStaffProfilesRequested(true);
      dispatch(fetchStaffProfiles());
    }
  }, [dispatch, loggedUserId, currentStaffProfile, staffProfilesRequested, staffProfilesState.loading]);

  const initialLoading =
    (usersState.loading && !currentUser) ||
    (staffProfilesState.loading && !currentStaffProfile) ||
    shiftRolesQuery.isLoading ||
    shiftRoleAssignmentsQuery.isLoading;

  const shiftRoleNameMap = useMemo(() => {
    const entries = new Map<number, string>();
    shiftRoleRecords.forEach((role) => {
      if (role?.id) {
        entries.set(role.id, role.name ?? `Role #${role.id}`);
      }
    });
    return entries;
  }, [shiftRoleRecords]);

  const assignedRoleEntries = useMemo(() => {
    if (!userRoleAssignment?.roleIds) {
      return [];
    }
    return userRoleAssignment.roleIds
      .map((roleId) => ({
        id: roleId,
        label: shiftRoleNameMap.get(roleId) ?? `Role #${roleId}`,
      }));
  }, [userRoleAssignment, shiftRoleNameMap]);

  const staffTypeLabel = currentStaffProfile?.staffType
    ? currentStaffProfile.staffType === "long_term"
      ? "Long-term"
      : "Volunteer"
    : "Not set";

  const livesInAccomLabel =
    currentStaffProfile?.livesInAccom === undefined || currentStaffProfile?.livesInAccom === null
      ? "Not set"
      : currentStaffProfile.livesInAccom
        ? "Yes"
        : "No";

  const staffActiveState = currentStaffProfile?.active;
  const staffActiveLabel =
    staffActiveState === undefined || staffActiveState === null
      ? "Not set"
      : staffActiveState
        ? "Active"
        : "Inactive";
  const staffActiveColor =
    staffActiveState === undefined || staffActiveState === null
      ? "gray"
      : staffActiveState
        ? "teal"
        : "red";

  const userDirty = useMemo(
    () =>
      Object.keys(userForm).some((key) => {
        const typedKey = key as keyof UserFormState;
        return compareString(userForm[typedKey]) !== compareString(userBaseline[typedKey]);
      }),
    [userForm, userBaseline],
  );

  const saveUser = async () => {
    if (!loggedUserId || !currentUser || !userDirty) {
      return;
    }
    let validationFailed = false;
    if (!emailIsValid) {
      setEmailError(emailValue.length === 0 ? "Email is required" : "Enter a valid email");
      validationFailed = true;
    } else {
      setEmailError(null);
    }
    if (!phoneIsValid) {
      setPhoneError(
        compareString(userForm.phone).length === 0
          ? "Phone number is required"
          : "Enter a valid phone number",
      );
      validationFailed = true;
    } else {
      setPhoneError(null);
    }
    if (!emergencyPhoneIsValid) {
      setEmergencyPhoneError(
        compareString(userForm.emergencyContactPhone).length === 0
          ? "Emergency phone is required"
          : "Enter a valid phone number",
      );
      validationFailed = true;
    } else {
      setEmergencyPhoneError(null);
    }
    if (!emergencyEmailIsValid) {
      setEmergencyEmailError("Enter a valid email");
      validationFailed = true;
    } else {
      setEmergencyEmailError(null);
    }
    if (!useSameWhatsappNumber && !whatsappIsValid) {
      setWhatsappPhoneError(
        whatsappLocalNumber.length === 0
          ? "WhatsApp number is required"
          : "Enter a valid phone number",
      );
      validationFailed = true;
    } else if (!useSameWhatsappNumber) {
      setWhatsappPhoneError(null);
    }
    if (!pronounsAreValid) {
      setPronounTouched(true);
      validationFailed = true;
    }
    if (validationFailed) {
      setUserFeedback({ type: "error", message: "Fix the highlighted fields before saving." });
      return;
    }
    const payload: Partial<User> = {};
    (Object.keys(userForm) as Array<keyof UserFormState>).forEach((key) => {
      const baseValue = compareString(userBaseline[key]);
      const nextValue = compareString(userForm[key]);
      if (baseValue !== nextValue) {
        const mappedKey = userFieldMap[key];
        const trimmed = nextValue.trim();
        const allowNull = nullableUserFields.includes(mappedKey);
        let finalValue: string | null = allowNull && trimmed === "" ? null : trimmed;
        if (
          finalValue &&
          (mappedKey === "phone" ||
            mappedKey === "emergencyContactPhone" ||
            mappedKey === "whatsappHandle")
        ) {
          finalValue = normalizePhoneNumber(finalValue);
        }
        (payload as Record<string, string | null>)[mappedKey as string] = finalValue;
      }
    });
    if (Object.keys(payload).length === 0) {
      setUserFeedback({ type: "success", message: "Everything is already up to date." });
      return;
    }
    setUserFeedback(null);
    setUserSaving(true);
    try {
      await dispatch(updateUser({ userId: loggedUserId, userData: payload })).unwrap();
      const combined = `${compareString(userForm.firstName)} ${compareString(userForm.lastName)}`.trim();
      if (combined) {
        dispatch(setUserState(combined));
      }
      setUserFeedback({ type: "success", message: "Profile updated successfully." });
    } catch (error) {
      setUserFeedback({ type: "error", message: toMessage(error, "Unable to save user changes.") });
    } finally {
      setUserSaving(false);
    }
  };

  const handleUserEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setUserForm((prev) => ({ ...prev, email: value }));
    if (value.trim().length === 0) {
      setEmailError("Email is required");
      return;
    }
    setEmailError(EMAIL_REGEX.test(value.trim().toLowerCase()) ? null : "Enter a valid email");
  };

  const handleUserEmailBlur = () => {
    const value = emailValue;
    if (value.length === 0) {
      setEmailError("Email is required");
    } else if (!EMAIL_REGEX.test(value.toLowerCase())) {
      setEmailError("Enter a valid email");
    }
  };

  const updatePhoneFromParts = (code: string, digits: string) => {
    const cleanedDigits = digits.replace(/\D/g, "");
    if (cleanedDigits.length === 0) {
      setUserForm((prev) => ({ ...prev, phone: "" }));
      return "";
    }
    const full = buildPhoneFromParts(code, cleanedDigits);
    setUserForm((prev) => ({ ...prev, phone: full }));
    return full;
  };

  const updateEmergencyPhoneFromParts = (code: string, digits: string) => {
    const cleanedDigits = digits.replace(/\D/g, "");
    if (cleanedDigits.length === 0) {
      setUserForm((prev) => ({ ...prev, emergencyContactPhone: "" }));
      return "";
    }
    const full = buildPhoneFromParts(code, cleanedDigits);
    setUserForm((prev) => ({ ...prev, emergencyContactPhone: full }));
    return full;
  };

  const handlePhoneLocalNumberChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = event.currentTarget.value.replace(/\D/g, "");
    setPhoneLocalNumber(digitsOnly);
    if (digitsOnly.length === 0) {
      setUserForm((prev) => ({ ...prev, phone: "" }));
      setPhoneError("Phone number is required");
      return;
    }
    const full = updatePhoneFromParts(phoneCountryCode, digitsOnly);
    setPhoneError(
      isPhoneNumberValid(normalizePhoneNumber(full)) ? null : "Enter a valid phone number",
    );
  };

  const handlePhoneCountryCodeChange = (code: string) => {
    setPhoneCountryCode(code);
    if (phoneLocalNumber.length === 0) {
      setUserForm((prev) => ({ ...prev, phone: "" }));
      return;
    }
    const full = updatePhoneFromParts(code, phoneLocalNumber);
    setPhoneError(
      isPhoneNumberValid(normalizePhoneNumber(full)) ? null : "Enter a valid phone number",
    );
  };

  const handlePhoneBlur = () => {
    if (phoneLocalNumber.length === 0) {
      setPhoneError("Phone number is required");
      return;
    }
    const value = compareString(userForm.phone);
    if (!isPhoneNumberValid(normalizePhoneNumber(value))) {
      setPhoneError("Enter a valid phone number");
    }
  };

  const handleEmergencyPhoneLocalChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = event.currentTarget.value.replace(/\D/g, "");
    setEmergencyPhoneLocalNumber(digitsOnly);
    if (digitsOnly.length === 0) {
      setUserForm((prev) => ({ ...prev, emergencyContactPhone: "" }));
      setEmergencyPhoneError("Emergency phone is required");
      return;
    }
    const full = updateEmergencyPhoneFromParts(emergencyPhoneCountryCode, digitsOnly);
    setEmergencyPhoneError(
      isPhoneNumberValid(normalizePhoneNumber(full)) ? null : "Enter a valid phone number",
    );
  };

  const handleEmergencyPhoneCountryCodeChange = (code: string) => {
    setEmergencyPhoneCountryCode(code);
    if (emergencyPhoneLocalNumber.length === 0) {
      setUserForm((prev) => ({ ...prev, emergencyContactPhone: "" }));
      return;
    }
    const full = updateEmergencyPhoneFromParts(code, emergencyPhoneLocalNumber);
    setEmergencyPhoneError(
      isPhoneNumberValid(normalizePhoneNumber(full)) ? null : "Enter a valid phone number",
    );
  };

  const handleEmergencyPhoneBlur = () => {
    if (emergencyPhoneLocalNumber.length === 0) {
      setEmergencyPhoneError("Emergency phone is required");
      return;
    }
    const value = compareString(userForm.emergencyContactPhone);
    if (!isPhoneNumberValid(normalizePhoneNumber(value))) {
      setEmergencyPhoneError("Enter a valid phone number");
    }
  };

  const updateWhatsappFromParts = (code: string, digits: string) => {
    const cleanedDigits = digits.replace(/\D/g, "");
    if (cleanedDigits.length === 0) {
      setUserForm((prev) => ({ ...prev, whatsappHandle: "" }));
      return "";
    }
    const full = buildPhoneFromParts(code, cleanedDigits);
    setUserForm((prev) => ({ ...prev, whatsappHandle: full }));
    return full;
  };

  const handleUseSameWhatsappToggle = (checked: boolean) => {
    setUseSameWhatsappNumber(checked);
    if (checked) {
      const normalizedPhone = normalizePhoneNumber(compareString(userForm.phone));
      setUserForm((prev) => ({ ...prev, whatsappHandle: normalizedPhone }));
      setWhatsappPhoneError(null);
      return;
    }
    const sourceValue = compareString(userForm.whatsappHandle) || compareString(userForm.phone);
    const parts = splitPhoneNumber(sourceValue);
    setWhatsappCountryCode(parts.code);
    setWhatsappLocalNumber(parts.digits);
    if (parts.digits.length === 0) {
      setUserForm((prev) => ({ ...prev, whatsappHandle: "" }));
      setWhatsappPhoneError("WhatsApp number is required");
    } else {
      const full = buildPhoneFromParts(parts.code, parts.digits);
      setUserForm((prev) => ({ ...prev, whatsappHandle: full }));
      setWhatsappPhoneError(
        isPhoneNumberValid(normalizePhoneNumber(full)) ? null : "Enter a valid phone number",
      );
    }
  };

  const handleWhatsappCountryCodeChange = (code: string) => {
    setWhatsappCountryCode(code);
    if (useSameWhatsappNumber) {
      return;
    }
    if (whatsappLocalNumber.length === 0) {
      setUserForm((prev) => ({ ...prev, whatsappHandle: "" }));
      return;
    }
    const full = updateWhatsappFromParts(code, whatsappLocalNumber);
    setWhatsappPhoneError(
      isPhoneNumberValid(normalizePhoneNumber(full)) ? null : "Enter a valid phone number",
    );
  };

  const handleWhatsappLocalNumberChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = event.currentTarget.value.replace(/\D/g, "");
    setWhatsappLocalNumber(digitsOnly);
    if (useSameWhatsappNumber) {
      return;
    }
    if (digitsOnly.length === 0) {
      setUserForm((prev) => ({ ...prev, whatsappHandle: "" }));
      setWhatsappPhoneError("WhatsApp number is required");
      return;
    }
    const full = updateWhatsappFromParts(whatsappCountryCode, digitsOnly);
    setWhatsappPhoneError(
      isPhoneNumberValid(normalizePhoneNumber(full)) ? null : "Enter a valid phone number",
    );
  };

  const handleWhatsappBlur = () => {
    if (useSameWhatsappNumber) {
      return;
    }
    if (whatsappLocalNumber.length === 0) {
      setWhatsappPhoneError("WhatsApp number is required");
      return;
    }
    const value = compareString(userForm.whatsappHandle);
    if (!isPhoneNumberValid(normalizePhoneNumber(value))) {
      setWhatsappPhoneError("Enter a valid phone number");
    }
  };

  const handleEmergencyEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setUserForm((prev) => ({ ...prev, emergencyContactEmail: value }));
    if (value.trim().length === 0) {
      setEmergencyEmailError(null);
      return;
    }
    setEmergencyEmailError(
      EMAIL_REGEX.test(value.trim().toLowerCase()) ? null : "Enter a valid email",
    );
  };

  const handleEmergencyEmailBlur = () => {
    const value = compareString(userForm.emergencyContactEmail);
    if (value.length === 0) {
      setEmergencyEmailError(null);
    } else if (!EMAIL_REGEX.test(value.toLowerCase())) {
      setEmergencyEmailError("Enter a valid email");
    }
  };

  const handlePronounSelectionChange = (value: string | null) => {
    const normalized = value ?? "";
    setPronounTouched(true);
    setPronounSelection(normalized);
    if (normalized === "custom") {
      setUserForm((prev) => ({ ...prev, preferredPronouns: customPronouns }));
    } else {
      setCustomPronouns("");
      setUserForm((prev) => ({ ...prev, preferredPronouns: normalized }));
    }
  };

  const handleCustomPronounChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setPronounTouched(true);
    setCustomPronouns(value);
    if (pronounSelection === "custom") {
      setUserForm((prev) => ({ ...prev, preferredPronouns: value }));
    }
  };

  const handleProfilePhotoChange = (file: File | null) => {
    setPhotoFeedback(null);
    setProfilePhotoError(null);
    if (!file) {
      if (photoObjectUrlRef.current) {
        URL.revokeObjectURL(photoObjectUrlRef.current);
        photoObjectUrlRef.current = null;
      }
      setProfilePhotoFile(null);
      setProfilePhotoDirty(false);
      setRemovePhotoRequested(false);
      setProfilePhotoPreview(remoteProfilePhotoUrl);
      return;
    }

    if (!file.type.startsWith("image/")) {
      setProfilePhotoError("Upload an image file (JPG, PNG, HEIC, or WEBP)");
      return;
    }

    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
      setProfilePhotoError("Image must be 10 MB or less");
      return;
    }

    if (photoObjectUrlRef.current) {
      URL.revokeObjectURL(photoObjectUrlRef.current);
    }

    const nextUrl = URL.createObjectURL(file);
    photoObjectUrlRef.current = nextUrl;
    setProfilePhotoFile(file);
    setProfilePhotoPreview(nextUrl);
    setProfilePhotoDirty(true);
    setRemovePhotoRequested(false);
  };

  const handleRemoveProfilePhoto = () => {
    if (photoObjectUrlRef.current) {
      URL.revokeObjectURL(photoObjectUrlRef.current);
      photoObjectUrlRef.current = null;
    }
    setProfilePhotoFile(null);
    setProfilePhotoPreview(null);
    setProfilePhotoDirty(true);
    setRemovePhotoRequested(true);
    setPhotoFeedback(null);
    setProfilePhotoError(null);
  };

  const handleResetProfilePhoto = () => {
    if (photoObjectUrlRef.current) {
      URL.revokeObjectURL(photoObjectUrlRef.current);
      photoObjectUrlRef.current = null;
    }
    setProfilePhotoFile(null);
    setProfilePhotoPreview(remoteProfilePhotoUrl);
    setProfilePhotoDirty(false);
    setRemovePhotoRequested(false);
    setPhotoFeedback(null);
    setProfilePhotoError(null);
  };

  const saveProfilePhoto = async () => {
    if (!loggedUserId || (!profilePhotoFile && !removePhotoRequested)) {
      return;
    }
    setPhotoFeedback(null);
    setPhotoSaving(true);
    try {
      if (profilePhotoFile) {
        let uploadFile = profilePhotoFile;
        try {
          uploadFile = await compressImageFile(profilePhotoFile, PROFILE_PHOTO_COMPRESSION_OPTIONS);
        } catch (compressionError) {
          console.error("Failed to compress profile photo before upload", compressionError);
        }
        const formData = new FormData();
        formData.append("profilePhoto", uploadFile);
        await dispatch(updateUser({ userId: loggedUserId, userData: formData })).unwrap();
      } else if (removePhotoRequested) {
        await dispatch(
          updateUser({
            userId: loggedUserId,
            userData: { profilePhotoUrl: null, profilePhotoPath: null },
          }),
        ).unwrap();
      }
      setPhotoFeedback({
        type: "success",
        message: profilePhotoFile ? "Profile photo updated." : "Profile photo removed.",
      });
      if (photoObjectUrlRef.current) {
        URL.revokeObjectURL(photoObjectUrlRef.current);
        photoObjectUrlRef.current = null;
      }
      setProfilePhotoFile(null);
      setProfilePhotoDirty(false);
      setRemovePhotoRequested(false);
    } catch (error) {
      setPhotoFeedback({ type: "error", message: toMessage(error, "Unable to update photo.") });
    } finally {
      setPhotoSaving(false);
    }
  };

  const passwordRequirementsMet =
    passwordForm.newPassword.trim().length >= 8 &&
    passwordForm.newPassword === passwordForm.confirmPassword &&
    passwordForm.newPassword.trim().length > 0;

  const passwordMismatch =
    passwordForm.confirmPassword.length > 0 &&
    passwordForm.newPassword !== passwordForm.confirmPassword;

  const savePassword = async () => {
    if (!loggedUserId || !passwordRequirementsMet) {
      return;
    }
    setPasswordFeedback(null);
    setPasswordSaving(true);
    try {
      await dispatch(
        updateUser({
          userId: loggedUserId,
          userData: { password: passwordForm.newPassword },
        }),
      ).unwrap();
      setPasswordFeedback({ type: "success", message: "Password updated successfully." });
      setPasswordForm({ newPassword: "", confirmPassword: "" });
    } catch (error) {
      setPasswordFeedback({
        type: "error",
        message: toMessage(error, "Unable to update password."),
      });
    } finally {
      setPasswordSaving(false);
    }
  };

  const normalizedPhoneValue = normalizePhoneNumber(compareString(userForm.phone));
  const normalizedEmergencyPhoneValue = normalizePhoneNumber(compareString(userForm.emergencyContactPhone));
  const emailValue = compareString(userForm.email);
  const emergencyEmailValue = compareString(userForm.emergencyContactEmail);
  const emailIsValid = emailValue.length > 0 && EMAIL_REGEX.test(emailValue.toLowerCase());
  const phoneIsValid =
    normalizedPhoneValue.length > 0 && isPhoneNumberValid(normalizedPhoneValue);
  const emergencyPhoneIsValid =
    normalizedEmergencyPhoneValue.length > 0 && isPhoneNumberValid(normalizedEmergencyPhoneValue);
  const emergencyEmailIsValid =
    emergencyEmailValue.length === 0 || EMAIL_REGEX.test(emergencyEmailValue.toLowerCase());
  const normalizedWhatsappValue = normalizePhoneNumber(compareString(userForm.whatsappHandle));
  const whatsappIsValid =
    useSameWhatsappNumber ||
    (normalizedWhatsappValue.length > 0 && isPhoneNumberValid(normalizedWhatsappValue));
  const pronounsAreValid =
    pronounSelection.trim().length > 0 &&
    (pronounSelection !== "custom" || customPronouns.trim().length > 0);
  const pronounError =
    pronounTouched && !pronounsAreValid
      ? pronounSelection.trim().length === 0
        ? "Select your pronouns"
        : "Enter your pronouns"
      : null;

  const photoDirty = profilePhotoDirty && (Boolean(profilePhotoFile) || removePhotoRequested);

  if (!loggedUserId) {
    return (
      <Container size="sm" py="xl">
        <Card withBorder radius="lg" shadow="sm">
          <Stack>
            <Title order={3}>My Account</Title>
            <Text c="dimmed">Sign in to view and edit your profile.</Text>
            <Button component="a" href="/login" variant="filled">
              Go to login
            </Button>
          </Stack>
        </Card>
      </Container>
    );
  }

  const fullName = createNameFromUser(currentUser);
  const initials = makeInitials(fullName);

  return (
    <Container size="lg" py="xl">
      <LoadingOverlay
        visible={initialLoading}
        overlayProps={{ radius: "lg", blur: 1 }}
        zIndex={200}
      />

      <Stack gap="xl">
        <Box>
          <Title order={2}>My Account</Title>
          <Text c="dimmed">Manage your OmniLodge identity, staff profile, and shift access.</Text>
        </Box>

        {(usersState.error || staffProfilesState.error) && (
          <Alert
            color="red"
            icon={<IconAlertCircle size={16} />}
            title="Sync issue"
            variant="light"
          >
            <Stack gap="xs">
              {usersState.error && (
                <Group gap="xs" justify="space-between" wrap="nowrap">
                  <Text size="sm" c="red.1">
                    {usersState.error}
                  </Text>
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconRefresh size={14} />}
                    onClick={() => {
                      setUsersRequested(true);
                      dispatch(fetchUsers());
                    }}
                  >
                    Retry profile
                  </Button>
                </Group>
              )}
              {staffProfilesState.error && (
                <Group gap="xs" justify="space-between" wrap="nowrap">
                  <Text size="sm" c="red.1">
                    {staffProfilesState.error}
                  </Text>
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconRefresh size={14} />}
                    onClick={() => {
                      setStaffProfilesRequested(true);
                      dispatch(fetchStaffProfiles());
                    }}
                  >
                    Retry staff profile
                  </Button>
                </Group>
              )}
            </Stack>
          </Alert>
        )}

        <Card withBorder radius="lg" shadow="sm">
          <Group align="flex-start" gap="md">
            <Avatar
              size={72}
              radius="xl"
              src={profilePhotoPreview ?? undefined}
              style={{
                background: profilePhotoPreview ? "transparent" : "linear-gradient(135deg, #4dabf7, #2148c0)",
                color: profilePhotoPreview ? undefined : "white",
                fontSize: "1.5rem",
                fontWeight: 600,
              }}
            >
              {!profilePhotoPreview ? initials : null}
            </Avatar>
            <Stack gap={4} flex={1}>
              <Title order={3}>{fullName}</Title>
              <Group gap="xs" wrap="wrap">
                {currentUser?.email && (
                  <Badge variant="light" color="gray">
                    {currentUser.email}
                  </Badge>
                )}
                {currentUser?.phone && (
                  <Badge variant="light" color="gray">
                    {currentUser.phone}
                  </Badge>
                )}
                {profileBaseline.staffType && (
                  <Badge color="indigo" variant="light">
                    {profileBaseline.staffType === "long_term" ? "Long-term" : "Volunteer"}
                  </Badge>
                )}
                <Badge color={profileBaseline.active ? "teal" : "red"} variant="light">
                  {profileBaseline.active ? "Active" : "Inactive"}
                </Badge>
              </Group>
            </Stack>
          </Group>
        </Card>

        <Stack gap="xl">
          <Card withBorder radius="lg" shadow="sm">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Title order={4}>Profile photo</Title>
                  <Text size="sm" c="dimmed">
                    Upload a new photo or remove your current avatar.
                  </Text>
                </div>
                <Group gap="xs">
                  <Button
                    variant="light"
                    size="sm"
                    disabled={!photoDirty || photoSaving}
                    onClick={handleResetProfilePhoto}
                  >
                    Reset
                  </Button>
                  <Button
                    leftSection={<IconDeviceFloppy size={16} />}
                    size="sm"
                    disabled={!photoDirty}
                    loading={photoSaving}
                    onClick={saveProfilePhoto}
                  >
                    Save photo
                  </Button>
                </Group>
              </Group>
              {photoFeedback && (
                <Alert
                  color={photoFeedback.type === "success" ? "teal" : "red"}
                  icon={<IconAlertCircle size={16} />}
                  variant="light"
                >
                  {photoFeedback.message}
                </Alert>
              )}
              <Group align="flex-start" gap="md" wrap="wrap">
                <Avatar
                  size={96}
                  radius="xl"
                  src={profilePhotoPreview ?? undefined}
                  style={{
                    background: profilePhotoPreview ? "transparent" : "linear-gradient(135deg, #4dabf7, #2148c0)",
                    color: profilePhotoPreview ? undefined : "white",
                    fontSize: "2rem",
                    fontWeight: 700,
                  }}
                >
                  {!profilePhotoPreview ? initials : null}
                </Avatar>
                <Stack gap="xs" style={{ flex: 1 }}>
                  <FileInput
                    accept="image/*"
                    label="Upload a new photo"
                    placeholder="Choose an image"
                    value={profilePhotoFile}
                    onChange={handleProfilePhotoChange}
                    clearable
                  />
                  <Group gap="xs">
                    {(profilePhotoFile || removePhotoRequested) && (
                      <Button variant="light" size="xs" onClick={handleResetProfilePhoto} disabled={photoSaving}>
                        Cancel changes
                      </Button>
                    )}
                    {(profilePhotoPreview || remoteProfilePhotoUrl) && !removePhotoRequested && (
                      <Button
                        variant="subtle"
                        size="xs"
                        color="gray"
                        onClick={handleRemoveProfilePhoto}
                        disabled={photoSaving}
                      >
                        Remove current photo
                      </Button>
                    )}
                  </Group>
                  <Text size="xs" c={profilePhotoError ? "red.6" : "dimmed"}>
                    {profilePhotoError ?? "JPG, PNG, HEIC, or WEBP up to 10 MB."}
                  </Text>
                </Stack>
              </Group>
            </Stack>
          </Card>
          <Card withBorder radius="lg" shadow="sm">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Title order={4}>Personal details</Title>
                  <Text size="sm" c="dimmed">
                    Keep your contact details up to date so the team can reach you.
                  </Text>
                </div>
                <Group gap="xs">
                  <Button
                    variant="light"
                    size="sm"
                    disabled={!userDirty || userSaving}
                    onClick={() => {
                      setUserForm(userBaseline);
                      setPronounSelection(pronounBaselineState.selection);
                      setCustomPronouns(pronounBaselineState.custom);
                      setPronounTouched(false);
                      setEmailError(null);
                      setPhoneError(null);
                      setEmergencyPhoneError(null);
                      setEmergencyEmailError(null);
                      const nextPhoneParts = splitPhoneNumber(userBaseline.phone);
                      setPhoneCountryCode(nextPhoneParts.code);
                      setPhoneLocalNumber(nextPhoneParts.digits);
                      const nextEmergencyParts = splitPhoneNumber(userBaseline.emergencyContactPhone);
                      setEmergencyPhoneCountryCode(nextEmergencyParts.code);
                      setEmergencyPhoneLocalNumber(nextEmergencyParts.digits);
                      const normalizedBaselinePhone = normalizePhoneNumber(compareString(userBaseline.phone));
                      const normalizedBaselineWhatsapp = normalizePhoneNumber(
                        compareString(userBaseline.whatsappHandle),
                      );
                      const baselineWhatsappSame =
                        normalizedBaselineWhatsapp.length === 0 ||
                        normalizedBaselineWhatsapp === normalizedBaselinePhone;
                      setUseSameWhatsappNumber(baselineWhatsappSame);
                      const nextWhatsappParts = splitPhoneNumber(userBaseline.whatsappHandle);
                      setWhatsappCountryCode(baselineWhatsappSame ? nextPhoneParts.code : nextWhatsappParts.code);
                      setWhatsappLocalNumber(baselineWhatsappSame ? nextPhoneParts.digits : nextWhatsappParts.digits);
                      setWhatsappPhoneError(null);
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    leftSection={<IconDeviceFloppy size={16} />}
                    size="sm"
                    onClick={saveUser}
                    disabled={!userDirty}
                    loading={userSaving}
                  >
                    Save changes
                  </Button>
                </Group>
              </Group>
              {userFeedback && (
                <Alert
                  color={userFeedback.type === "success" ? "teal" : "red"}
                  icon={<IconAlertCircle size={16} />}
                  variant="light"
                >
                  {userFeedback.message}
                </Alert>
              )}
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <TextInput
                  label="Username"
                  placeholder="Your OmniLodge username"
                  value={userForm.username}
                  onChange={(event) =>
                    setUserForm((prev) => ({ ...prev, username: event.currentTarget.value }))
                  }
                />
                <TextInput
                  label="First name"
                  placeholder="John"
                  value={userForm.firstName}
                  onChange={(event) =>
                    setUserForm((prev) => ({ ...prev, firstName: event.currentTarget.value }))
                  }
                />
                <TextInput
                  label="Last name"
                  placeholder="Smith"
                  value={userForm.lastName}
                  onChange={(event) =>
                    setUserForm((prev) => ({ ...prev, lastName: event.currentTarget.value }))
                  }
                />
                <TextInput
                  label="Email"
                  placeholder="you@example.com"
                  value={userForm.email}
                  onChange={handleUserEmailChange}
                  onBlur={handleUserEmailBlur}
                  error={emailError ?? undefined}
                />
                <PhoneCodeSelectField
                  label="Phone country code"
                  value={phoneCountryCode}
                  onChange={handlePhoneCountryCodeChange}
                  placeholder="+48"
                />
                <TextInput
                  label="Phone number"
                  placeholder="555123456"
                  value={phoneLocalNumber}
                  onChange={handlePhoneLocalNumberChange}
                  onBlur={handlePhoneBlur}
                  error={phoneError ?? undefined}
                />
                <TextInput
                  label="Country of citizenship"
                  placeholder="Country"
                  value={userForm.countryOfCitizenship}
                  onChange={(event) =>
                    setUserForm((prev) => ({
                      ...prev,
                      countryOfCitizenship: event.currentTarget.value,
                    }))
                  }
                />
                <TextInput
                  label="Date of birth"
                  placeholder="YYYY-MM-DD"
                  type="date"
                  value={userForm.dateOfBirth}
                  onChange={(event) =>
                    setUserForm((prev) => ({
                      ...prev,
                      dateOfBirth: event.currentTarget.value,
                    }))
                  }
                />
                <Select
                  label="Preferred pronouns"
                  placeholder="Select pronouns"
                  data={PRONOUN_OPTIONS}
                  value={pronounSelection || null}
                  onChange={handlePronounSelectionChange}
                  error={pronounError ?? undefined}
                />
                <Box style={{ gridColumn: "span 2" }}>
                  <Stack gap="xs">
                    <Switch
                      label="Use same number for WhatsApp"
                      checked={useSameWhatsappNumber}
                      onChange={(event) => handleUseSameWhatsappToggle(event.currentTarget.checked)}
                    />
                    {!useSameWhatsappNumber && (
                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                        <PhoneCodeSelectField
                          label="WhatsApp country code"
                          value={whatsappCountryCode}
                          onChange={handleWhatsappCountryCodeChange}
                          placeholder="+48"
                        />
                        <TextInput
                          label="WhatsApp number"
                          placeholder="555123456"
                          value={whatsappLocalNumber}
                          onChange={handleWhatsappLocalNumberChange}
                          onBlur={handleWhatsappBlur}
                          error={whatsappPhoneError ?? undefined}
                        />
                      </SimpleGrid>
                    )}
                    <Text size="xs" c={whatsappPhoneError ? "red.6" : "dimmed"}>
                      {useSameWhatsappNumber
                        ? "We'll use your primary phone number for WhatsApp."
                        : whatsappPhoneError ?? "Digits only; we'll format it automatically."}
                    </Text>
                  </Stack>
                </Box>
                <TextInput
                  label="Emergency contact name"
                  placeholder="Emergency contact"
                  value={userForm.emergencyContactName}
                  onChange={(event) =>
                    setUserForm((prev) => ({
                      ...prev,
                      emergencyContactName: event.currentTarget.value,
                    }))
                  }
                />
                <TextInput
                  label="Emergency contact relationship"
                  placeholder="Parent, sibling..."
                  value={userForm.emergencyContactRelationship}
                  onChange={(event) =>
                    setUserForm((prev) => ({
                      ...prev,
                      emergencyContactRelationship: event.currentTarget.value,
                    }))
                  }
                />
                <PhoneCodeSelectField
                  label="Emergency phone country code"
                  value={emergencyPhoneCountryCode}
                  onChange={handleEmergencyPhoneCountryCodeChange}
                  placeholder="+48"
                />
                <TextInput
                  label="Emergency contact phone"
                  placeholder="555123456"
                  value={emergencyPhoneLocalNumber}
                  onChange={handleEmergencyPhoneLocalChange}
                  onBlur={handleEmergencyPhoneBlur}
                  error={emergencyPhoneError ?? undefined}
                />
                <TextInput
                  label="Emergency contact email"
                  placeholder="emergency@domain.com"
                  value={userForm.emergencyContactEmail}
                  onChange={handleEmergencyEmailChange}
                  onBlur={handleEmergencyEmailBlur}
                  error={emergencyEmailError ?? undefined}
                />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <TextInput
                  label="Arrival date"
                  type="date"
                  value={userForm.arrivalDate}
                  onChange={(event) =>
                    setUserForm((prev) => ({ ...prev, arrivalDate: event.currentTarget.value }))
                  }
                  placeholder="YYYY-MM-DD"
                />
                <TextInput
                  label="Departure date"
                  type="date"
                  value={userForm.departureDate}
                  onChange={(event) =>
                    setUserForm((prev) => ({ ...prev, departureDate: event.currentTarget.value }))
                  }
                  placeholder="YYYY-MM-DD"
                />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Select
                  label="Discovery source"
                  placeholder="How you heard about OmniLodge"
                  data={DISCOVERY_SOURCE_OPTIONS}
                  value={userForm.discoverySource || null}
                  onChange={(value) =>
                    setUserForm((prev) => ({
                      ...prev,
                      discoverySource: value ?? "",
                    }))
                  }
                  searchable
                  clearable
                />
                <TextInput
                  label="Facebook profile URL"
                  placeholder="https://facebook.com/username"
                  value={userForm.facebookProfileUrl}
                  onChange={(event) =>
                    setUserForm((prev) => ({
                      ...prev,
                      facebookProfileUrl: event.currentTarget.value,
                    }))
                  }
                />
                <TextInput
                  label="Instagram profile URL"
                  placeholder="https://instagram.com/username"
                  value={userForm.instagramProfileUrl}
                  onChange={(event) =>
                    setUserForm((prev) => ({
                      ...prev,
                      instagramProfileUrl: event.currentTarget.value,
                    }))
                  }
                />
              </SimpleGrid>
              <Textarea
                label="Dietary restrictions"
                placeholder="Vegan, gluten-free, etc."
                minRows={2}
                value={userForm.dietaryRestrictions}
                onChange={(event) =>
                  setUserForm((prev) => ({ ...prev, dietaryRestrictions: event.currentTarget.value }))
                }
              />
              <Textarea
                label="Allergies"
                placeholder="List any allergies we should know about"
                minRows={2}
                value={userForm.allergies}
                onChange={(event) =>
                  setUserForm((prev) => ({ ...prev, allergies: event.currentTarget.value }))
                }
              />
              <Textarea
                label="Medical notes"
                placeholder="Optional medical information for coordinators"
                minRows={2}
                value={userForm.medicalNotes}
                onChange={(event) =>
                  setUserForm((prev) => ({ ...prev, medicalNotes: event.currentTarget.value }))
                }
              />
              {pronounSelection === "custom" && (
                <TextInput
                  label="Self-described pronouns"
                  placeholder="e.g. Ze / Zir"
                  value={customPronouns}
                  onChange={handleCustomPronounChange}
                  error={pronounError ?? undefined}
                />
              )}
            </Stack>
          </Card>

          <Card withBorder radius="lg" shadow="sm">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Title order={4}>Password</Title>
                  <Text size="sm" c="dimmed">
                    Use a unique password to keep your account secure.
                  </Text>
                </div>
                <Button
                  leftSection={<IconDeviceFloppy size={16} />}
                  size="sm"
                  onClick={savePassword}
                  disabled={!passwordRequirementsMet || passwordSaving}
                  loading={passwordSaving}
                >
                  Update password
                </Button>
              </Group>
              {passwordFeedback && (
                <Alert
                  color={passwordFeedback.type === "success" ? "teal" : "red"}
                  icon={<IconAlertCircle size={16} />}
                  variant="light"
                >
                  {passwordFeedback.message}
                </Alert>
              )}
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <PasswordInput
                  label="New password"
                  placeholder="Enter a new password"
                  value={passwordForm.newPassword}
                  onChange={(event) =>
                    setPasswordForm((prev) => ({ ...prev, newPassword: event.currentTarget.value }))
                  }
                />
                <PasswordInput
                  label="Confirm password"
                  placeholder="Repeat the new password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) =>
                    setPasswordForm((prev) => ({
                      ...prev,
                      confirmPassword: event.currentTarget.value,
                    }))
                  }
                />
              </SimpleGrid>
              <Text size="xs" c={passwordMismatch ? "red.6" : "dimmed"}>
                {passwordMismatch
                  ? "Passwords do not match."
                  : "Password must have at least 8 characters."}
              </Text>
            </Stack>
          </Card>

          <Card withBorder radius="lg" shadow="sm">
            <Stack gap="md">
              <div>
                <Title order={4}>Staff profile</Title>
                <Text size="sm" c="dimmed">
                  These details are managed by the OmniLodge leadership team.
                </Text>
              </div>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Stack gap={2}>
                  <Text size="sm" c="dimmed">
                    Staff type
                  </Text>
                  <Text fw={600}>{staffTypeLabel}</Text>
                </Stack>
                <Stack gap={2}>
                  <Text size="sm" c="dimmed">
                    Lives in volunteer&apos;s accommodation
                  </Text>
                  <Text fw={600}>{livesInAccomLabel}</Text>
                </Stack>
              </SimpleGrid>
              <Stack gap={2}>
                <Text size="sm" c="dimmed">
                  Staff status
                </Text>
                <Badge
                  color={staffActiveColor}
                  variant="light"
                  style={{ alignSelf: "flex-start" }}
                >
                  {staffActiveLabel}
                </Badge>
              </Stack>
              {!currentStaffProfile && (
                <Text size="sm" c="dimmed">
                  No staff profile has been configured yet.
                </Text>
              )}
              <Text size="xs" c="dimmed">
                Contact your coordinator if any of these values need to be updated.
              </Text>
            </Stack>
          </Card>

          <Card withBorder radius="lg" shadow="sm">
            <Stack gap="md">
              <div>
                <Title order={4}>Shift roles</Title>
                <Text size="sm" c="dimmed">
                  Review the roles you&apos;re currently cleared to cover.
                </Text>
              </div>
              {shiftRolesQuery.isError || shiftRoleAssignmentsQuery.isError ? (
                <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
                  {shiftRolesQuery.isError
                    ? toMessage(shiftRolesQuery.error, "Unable to load shift roles.")
                    : toMessage(
                        shiftRoleAssignmentsQuery.error,
                        "Unable to load your current assignments.",
                      )}
                </Alert>
              ) : assignedRoleEntries.length > 0 ? (
                <Group gap="xs" wrap="wrap">
                  {assignedRoleEntries.map((entry) => (
                    <Badge key={entry.id} variant="light">
                      {entry.label}
                    </Badge>
                  ))}
                </Group>
              ) : (
                <Text size="sm" c="dimmed">
                  No shift roles have been assigned yet.
                </Text>
              )}
              <Text size="xs" c="dimmed">
                Reach out to the scheduling team if your availability or permissions change.
              </Text>
            </Stack>
          </Card>
        </Stack>
        <Divider />
        <Text size="sm" c="dimmed">
          Changes are saved securely and synced across OmniLodge after submission.
        </Text>
      </Stack>
    </Container>
  );
};

export default MyAccount;
