import React, { useEffect, useMemo, useRef, useState } from "react";
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
  MultiSelect,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconDeviceFloppy, IconRefresh } from "@tabler/icons-react";

import { fetchUsers, updateUser } from "../actions/userActions";
import {
  createStaffProfile,
  fetchStaffProfiles,
  updateStaffProfile,
} from "../actions/staffProfileActions";
import { setUserState } from "../actions/sessionActions";
import {
  useShiftRoleAssignments,
  useShiftRoles,
  useUpdateUserShiftRoles,
} from "../api/shiftRoles";
import type { StaffProfile } from "../types/staffProfiles/StaffProfile";
import type { User } from "../types/users/User";
import type { ShiftRole } from "../types/shiftRoles/ShiftRole";
import type { UserShiftRoleAssignment } from "../types/shiftRoles/UserShiftRoleAssignment";
import { useAppDispatch, useAppSelector } from "../store/hooks";

type FeedbackState = { type: "success" | "error"; message: string } | null;

type UserFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredPronouns: string;
  whatsappHandle: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactEmail: string;
};

type StaffProfileFormState = {
  staffType: StaffProfile["staffType"] | "";
  livesInAccom: boolean;
  active: boolean;
};

const PROFILE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const userFieldMap: Record<keyof UserFormState, keyof User> = {
  firstName: "firstName",
  lastName: "lastName",
  email: "email",
  phone: "phone",
  preferredPronouns: "preferredPronouns",
  whatsappHandle: "whatsappHandle",
  emergencyContactName: "emergencyContactName",
  emergencyContactPhone: "emergencyContactPhone",
  emergencyContactEmail: "emergencyContactEmail",
};
const nullableUserFields: Array<keyof User> = [
  "phone",
  "preferredPronouns",
  "whatsappHandle",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactEmail",
];

const buildUserFormState = (user?: Partial<User>): UserFormState => ({
  firstName: user?.firstName ?? "",
  lastName: user?.lastName ?? "",
  email: user?.email ?? "",
  phone: user?.phone ?? "",
  preferredPronouns: user?.preferredPronouns ?? "",
  whatsappHandle: user?.whatsappHandle ?? "",
  emergencyContactName: user?.emergencyContactName ?? "",
  emergencyContactPhone: user?.emergencyContactPhone ?? "",
  emergencyContactEmail: user?.emergencyContactEmail ?? "",
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

const MyAccount = () => {
  const dispatch = useAppDispatch();
  const { loggedUserId } = useAppSelector((state) => state.session);
  const usersState = useAppSelector((state) => state.users)[0];
  const staffProfilesState = useAppSelector((state) => state.staffProfiles)[0];

  const shiftRolesQuery = useShiftRoles();
  const shiftRoleAssignmentsQuery = useShiftRoleAssignments();
  const updateUserShiftRolesMutation = useUpdateUserShiftRoles();

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
  const remoteProfilePhotoUrl =
    currentUser?.profilePhotoUrl && currentUser.profilePhotoUrl.trim().length > 0
      ? currentUser.profilePhotoUrl
      : null;
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
  const [userForm, setUserForm] = useState<UserFormState>(userBaseline);
  const [profileForm, setProfileForm] = useState<StaffProfileFormState>(profileBaseline);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(
    () => userRoleAssignment?.roleIds?.map(String) ?? [],
  );
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(remoteProfilePhotoUrl);
  const [profilePhotoError, setProfilePhotoError] = useState<string | null>(null);
  const [profilePhotoDirty, setProfilePhotoDirty] = useState(false);
  const [removePhotoRequested, setRemovePhotoRequested] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState<FeedbackState>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
  const photoObjectUrlRef = useRef<string | null>(null);

  useEffect(() => setUserForm(userBaseline), [userBaseline]);
  useEffect(() => setProfileForm(profileBaseline), [profileBaseline]);
  useEffect(() => {
    setSelectedRoleIds(userRoleAssignment?.roleIds?.map(String) ?? []);
  }, [userRoleAssignment]);
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

  const [userFeedback, setUserFeedback] = useState<FeedbackState>(null);
  const [userSaving, setUserSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<FeedbackState>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [rolesFeedback, setRolesFeedback] = useState<FeedbackState>(null);

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

  const shiftRoleOptions = useMemo(
    () =>
      shiftRoleRecords.map((role) => ({
        value: String(role.id),
        label: role.name ?? `Role #${role.id}`,
      })),
    [shiftRoleRecords],
  );

  const baselineRoleIds = useMemo(() => {
    return (userRoleAssignment?.roleIds ?? []).map(String).sort();
  }, [userRoleAssignment]);

  const rolesDirty = useMemo(() => {
    const current = [...selectedRoleIds].sort();
    if (current.length !== baselineRoleIds.length) {
      return true;
    }
    return current.some((value, index) => value !== baselineRoleIds[index]);
  }, [baselineRoleIds, selectedRoleIds]);

  const userDirty = useMemo(
    () =>
      Object.keys(userForm).some((key) => {
        const typedKey = key as keyof UserFormState;
        return compareString(userForm[typedKey]) !== compareString(userBaseline[typedKey]);
      }),
    [userForm, userBaseline],
  );

  const profileDirty = useMemo(
    () =>
      profileForm.staffType !== profileBaseline.staffType ||
      profileForm.livesInAccom !== profileBaseline.livesInAccom ||
      profileForm.active !== profileBaseline.active,
    [profileForm, profileBaseline],
  );

  const saveUser = async () => {
    if (!loggedUserId || !currentUser || !userDirty) {
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
        const finalValue = allowNull && trimmed === "" ? null : trimmed;
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

  const saveStaffProfile = async () => {
    if (!loggedUserId || (!profileDirty && currentStaffProfile)) {
      return;
    }
    const payload: Partial<StaffProfile> = {
      staffType: profileForm.staffType || undefined,
      livesInAccom: profileForm.livesInAccom,
      active: profileForm.active,
    };
    setProfileFeedback(null);
    setProfileSaving(true);
    try {
      if (currentStaffProfile) {
        await dispatch(updateStaffProfile({ userId: loggedUserId, data: payload })).unwrap();
      } else {
        await dispatch(createStaffProfile({ ...payload, userId: loggedUserId })).unwrap();
      }
      setProfileFeedback({ type: "success", message: "Staff profile saved." });
    } catch (error) {
      setProfileFeedback({
        type: "error",
        message: toMessage(error, "Unable to save staff profile."),
      });
    } finally {
      setProfileSaving(false);
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
        const formData = new FormData();
        formData.append("profilePhoto", profilePhotoFile);
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

  const saveRoles = async () => {
    if (!loggedUserId || !rolesDirty) {
      return;
    }
    setRolesFeedback(null);
    try {
      await updateUserShiftRolesMutation.mutateAsync({
        userId: loggedUserId,
        roleIds: selectedRoleIds.map((value) => Number(value)).filter((value) => !Number.isNaN(value)),
      });
      setRolesFeedback({ type: "success", message: "Shift roles updated." });
    } catch (error) {
      setRolesFeedback({
        type: "error",
        message: toMessage(error, "Unable to update shift roles."),
      });
    }
  };

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
                    onClick={() => setUserForm(userBaseline)}
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
                  onChange={(event) =>
                    setUserForm((prev) => ({ ...prev, email: event.currentTarget.value }))
                  }
                />
                <TextInput
                  label="Phone"
                  placeholder="+1 555..."
                  value={userForm.phone}
                  onChange={(event) =>
                    setUserForm((prev) => ({ ...prev, phone: event.currentTarget.value }))
                  }
                />
                <TextInput
                  label="Preferred pronouns"
                  placeholder="They / them"
                  value={userForm.preferredPronouns}
                  onChange={(event) =>
                    setUserForm((prev) => ({
                      ...prev,
                      preferredPronouns: event.currentTarget.value,
                    }))
                  }
                />
                <TextInput
                  label="WhatsApp"
                  placeholder="@omnilodge"
                  value={userForm.whatsappHandle}
                  onChange={(event) =>
                    setUserForm((prev) => ({
                      ...prev,
                      whatsappHandle: event.currentTarget.value,
                    }))
                  }
                />
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
                  label="Emergency contact phone"
                  placeholder="+1 555..."
                  value={userForm.emergencyContactPhone}
                  onChange={(event) =>
                    setUserForm((prev) => ({
                      ...prev,
                      emergencyContactPhone: event.currentTarget.value,
                    }))
                  }
                />
                <TextInput
                  label="Emergency contact email"
                  placeholder="emergency@domain.com"
                  value={userForm.emergencyContactEmail}
                  onChange={(event) =>
                    setUserForm((prev) => ({
                      ...prev,
                      emergencyContactEmail: event.currentTarget.value,
                    }))
                  }
                />
              </SimpleGrid>
            </Stack>
          </Card>

          <Card withBorder radius="lg" shadow="sm">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Title order={4}>Staff profile</Title>
                  <Text size="sm" c="dimmed">
                    Update your staff preferences and housing status.
                  </Text>
                </div>
                <Group gap="xs">
                  <Button
                    variant="light"
                    size="sm"
                    disabled={!profileDirty || profileSaving}
                    onClick={() => setProfileForm(profileBaseline)}
                  >
                    Reset
                  </Button>
                  <Button
                    leftSection={<IconDeviceFloppy size={16} />}
                    size="sm"
                    onClick={saveStaffProfile}
                    disabled={!profileDirty && Boolean(currentStaffProfile)}
                    loading={profileSaving}
                  >
                    Save staff profile
                  </Button>
                </Group>
              </Group>
              {profileFeedback && (
                <Alert
                  color={profileFeedback.type === "success" ? "teal" : "red"}
                  icon={<IconAlertCircle size={16} />}
                  variant="light"
                >
                  {profileFeedback.message}
                </Alert>
              )}
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select
                  label="Staff type"
                  placeholder="Choose a staff archetype"
                  data={[
                    { value: "volunteer", label: "Volunteer" },
                    { value: "long_term", label: "Long-term" },
                  ]}
                  value={profileForm.staffType || null}
                  onChange={(value) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      staffType: (value as StaffProfile["staffType"]) ?? "",
                    }))
                  }
                  allowDeselect
                />
                <Switch
                  label="Lives in Omni housing"
                  checked={profileForm.livesInAccom}
                  onChange={(event) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      livesInAccom: event.currentTarget.checked,
                    }))
                  }
                />
              </SimpleGrid>
              <Switch
                label="Active staff profile"
                checked={profileForm.active}
                onChange={(event) =>
                  setProfileForm((prev) => ({
                    ...prev,
                    active: event.currentTarget.checked,
                  }))
                }
              />
            </Stack>
          </Card>

          <Card withBorder radius="lg" shadow="sm">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Title order={4}>Shift roles</Title>
                  <Text size="sm" c="dimmed">
                    Control which roles you&apos;re eligible to cover in the schedule.
                  </Text>
                </div>
                <Group gap="xs">
                  <Button
                    variant="light"
                    size="sm"
                    disabled={!rolesDirty || updateUserShiftRolesMutation.isPending}
                    onClick={() => {
                      setSelectedRoleIds(userRoleAssignment?.roleIds?.map(String) ?? []);
                      setRolesFeedback(null);
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    leftSection={<IconDeviceFloppy size={16} />}
                    size="sm"
                    onClick={saveRoles}
                    disabled={!rolesDirty}
                    loading={updateUserShiftRolesMutation.isPending}
                  >
                    Save roles
                  </Button>
                </Group>
              </Group>
              {rolesFeedback && (
                <Alert
                  color={rolesFeedback.type === "success" ? "teal" : "red"}
                  icon={<IconAlertCircle size={16} />}
                  variant="light"
                >
                  {rolesFeedback.message}
                </Alert>
              )}
              {shiftRolesQuery.isError || shiftRoleAssignmentsQuery.isError ? (
                <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
                  {shiftRolesQuery.isError
                    ? toMessage(shiftRolesQuery.error, "Unable to load shift roles.")
                    : toMessage(
                        shiftRoleAssignmentsQuery.error,
                        "Unable to load your current assignments.",
                      )}
                </Alert>
              ) : (
                <MultiSelect
                  label="Eligible roles"
                  placeholder={
                    shiftRoleOptions.length === 0 ? "No roles available" : "Select your roles"
                  }
                  value={selectedRoleIds}
                  onChange={setSelectedRoleIds}
                  data={shiftRoleOptions}
                  searchable
                  nothingFoundMessage="No matching roles"
                  disabled={shiftRoleOptions.length === 0}
                />
              )}
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
