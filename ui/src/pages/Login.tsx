import React, { ChangeEvent, useEffect, useMemo, useState } from 'react';
import {
  TextInput,
  PasswordInput,
  Button,
  Paper,
  Title,
  Container,
  Avatar,
  Alert,
  Select,
  MultiSelect,
  Text,
  Box,
  Stack,
  Grid,
  Textarea,
  Group,
  Progress,
  FileInput,
  Switch,
} from '@mantine/core';
import { IconUser, IconLock, IconCheck, IconX } from '@tabler/icons-react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setUserState } from '../actions/sessionActions';
import { loginUser, createUser } from '../actions/userActions';
import { clearSessionError } from '../reducers/sessionReducer';
import { useShiftRoles } from '../api/shiftRoles';
import type { ShiftRole } from '../types/shiftRoles/ShiftRole';
import { useMediaQuery } from '@mantine/hooks';
import PhoneCodeSelectField from '../components/common/PhoneCodeSelectField';
import { PRONOUN_OPTIONS } from '../constants/pronouns';
import { DEFAULT_PHONE_CODE } from '../constants/phoneCodes';
import { DISCOVERY_SOURCE_OPTIONS } from '../constants/discoverySources';
import { EMAIL_REGEX, isPhoneNumberValid, normalizePhoneNumber } from '../utils/contactValidation';
import { buildPhoneFromParts, splitPhoneNumber } from '../utils/phone';

const COUNTRY_NAMES = [
  'Afghanistan',
  'Albania',
  'Algeria',
  'Andorra',
  'Angola',
  'Antigua and Barbuda',
  'Argentina',
  'Armenia',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bahamas',
  'Bahrain',
  'Bangladesh',
  'Barbados',
  'Belarus',
  'Belgium',
  'Belize',
  'Benin',
  'Bhutan',
  'Bolivia',
  'Bosnia and Herzegovina',
  'Botswana',
  'Brazil',
  'Brunei',
  'Bulgaria',
  'Burkina Faso',
  'Burundi',
  'Cabo Verde',
  'Cambodia',
  'Cameroon',
  'Canada',
  'Central African Republic',
  'Chad',
  'Chile',
  'China',
  'Colombia',
  'Comoros',
  'Costa Rica',
  "Côte d'Ivoire",
  'Croatia',
  'Cuba',
  'Cyprus',
  'Czech Republic',
  'Democratic Republic of the Congo',
  'Denmark',
  'Djibouti',
  'Dominica',
  'Dominican Republic',
  'Ecuador',
  'Egypt',
  'El Salvador',
  'Equatorial Guinea',
  'Eritrea',
  'Estonia',
  'Eswatini',
  'Ethiopia',
  'Fiji',
  'Finland',
  'France',
  'Gabon',
  'Gambia',
  'Georgia',
  'Germany',
  'Ghana',
  'Greece',
  'Grenada',
  'Guatemala',
  'Guinea',
  'Guinea-Bissau',
  'Guyana',
  'Haiti',
  'Honduras',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Israel',
  'Italy',
  'Jamaica',
  'Japan',
  'Jordan',
  'Kazakhstan',
  'Kenya',
  'Kiribati',
  'Kuwait',
  'Kyrgyzstan',
  'Laos',
  'Latvia',
  'Lebanon',
  'Lesotho',
  'Liberia',
  'Libya',
  'Liechtenstein',
  'Lithuania',
  'Luxembourg',
  'Madagascar',
  'Malawi',
  'Malaysia',
  'Maldives',
  'Mali',
  'Malta',
  'Marshall Islands',
  'Mauritania',
  'Mauritius',
  'Mexico',
  'Micronesia',
  'Moldova',
  'Monaco',
  'Mongolia',
  'Montenegro',
  'Morocco',
  'Mozambique',
  'Myanmar',
  'Namibia',
  'Nauru',
  'Nepal',
  'Netherlands',
  'New Zealand',
  'Nicaragua',
  'Niger',
  'Nigeria',
  'North Korea',
  'North Macedonia',
  'Norway',
  'Oman',
  'Pakistan',
  'Palau',
  'Panama',
  'Papua New Guinea',
  'Paraguay',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Qatar',
  'Republic of the Congo',
  'Romania',
  'Russia',
  'Rwanda',
  'Saint Kitts and Nevis',
  'Saint Lucia',
  'Saint Vincent and the Grenadines',
  'Samoa',
  'San Marino',
  'São Tomé and Príncipe',
  'Saudi Arabia',
  'Senegal',
  'Serbia',
  'Seychelles',
  'Sierra Leone',
  'Singapore',
  'Slovakia',
  'Slovenia',
  'Solomon Islands',
  'Somalia',
  'South Africa',
  'South Korea',
  'South Sudan',
  'Spain',
  'Sri Lanka',
  'Sudan',
  'Suriname',
  'Sweden',
  'Switzerland',
  'Syria',
  'Taiwan',
  'Tajikistan',
  'Tanzania',
  'Thailand',
  'Timor-Leste',
  'Togo',
  'Tonga',
  'Trinidad and Tobago',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'Tuvalu',
  'Uganda',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Uruguay',
  'Uzbekistan',
  'Vanuatu',
  'Vatican City',
  'Venezuela',
  'Vietnam',
  'Yemen',
  'Zambia',
  'Zimbabwe',
];

const COUNTRY_OPTIONS = COUNTRY_NAMES.map((name) => ({ value: name, label: name }));

const SIGNUP_STEPS = [
  { key: 'profile', label: 'Profile', description: 'Contact & identity' },
  { key: 'roles', label: 'Roles', description: 'Staff type & shifts' },
  { key: 'stay', label: 'Stay', description: 'Arrival details' },
  { key: 'emergency', label: 'Emergency', description: 'Emergency contact' },
  { key: 'health', label: 'Health', description: 'Wellness notes' },
  { key: 'connect', label: 'Connect', description: 'Social & comms' },
] as const;

const PROFILE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const LoginPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const { user, error } = useAppSelector((state) => state.session);
  const [isSignup, setIsSignup] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCountryCode, setPhoneCountryCode] = useState(DEFAULT_PHONE_CODE);
  const [phoneLocalNumber, setPhoneLocalNumber] = useState('');
  const [countryOfCitizenship, setCountryOfCitizenship] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [preferredPronouns, setPreferredPronouns] = useState('');
  const [customPronouns, setCustomPronouns] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactRelationship, setEmergencyContactRelationship] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [emergencyPhoneCountryCode, setEmergencyPhoneCountryCode] = useState(DEFAULT_PHONE_CODE);
  const [emergencyPhoneLocalNumber, setEmergencyPhoneLocalNumber] = useState('');
  const [emergencyContactEmail, setEmergencyContactEmail] = useState('');
  const [arrivalDate, setArrivalDate] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [dietaryRestrictions, setDietaryRestrictions] = useState('');
  const [allergies, setAllergies] = useState('');
  const [medicalNotes, setMedicalNotes] = useState('');
  const [whatsappHandle, setWhatsappHandle] = useState('');
  const [useSameWhatsappNumber, setUseSameWhatsappNumber] = useState(true);
  const [whatsappCountryCode, setWhatsappCountryCode] = useState(DEFAULT_PHONE_CODE);
  const [whatsappLocalNumber, setWhatsappLocalNumber] = useState('');
  const [whatsappPhoneError, setWhatsappPhoneError] = useState<string | null>(null);
  const [facebookProfileUrl, setFacebookProfileUrl] = useState('');
  const [instagramProfileUrl, setInstagramProfileUrl] = useState('');
  const [discoverySource, setDiscoverySource] = useState('');
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);
  const [profilePhotoError, setProfilePhotoError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [passwordsMatch, setPasswordsMatch] = useState(true);
  const [loading, setLoading] = useState(false);
  const [staffType, setStaffType] = useState<'volunteer' | 'long_term'>('volunteer');
  const [livesInAccom, setLivesInAccom] = useState(true);
  const [selectedShiftRoles, setSelectedShiftRoles] = useState<string[]>([]);
  const [rolesDropdownOpened, setRolesDropdownOpened] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emergencyPhoneError, setEmergencyPhoneError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emergencyEmailError, setEmergencyEmailError] = useState<string | null>(null);
  const shiftRolesQuery = useShiftRoles();
  const shiftRoleOptions = useMemo(() => {
    const rawRoles = (shiftRolesQuery.data?.[0]?.data ?? []) as ShiftRole[];
    const excludedSlugs = new Set(['leader', 'manager']);
    return rawRoles
      .filter((role) => {
        const slug = (role.slug ?? role.name ?? '').toLowerCase();
        return !excludedSlugs.has(slug);
      })
      .map((role) => ({
        value: role.id.toString(),
        label: role.name,
      }));
  }, [shiftRolesQuery.data]);

  useEffect(() => {
    return () => {
      if (profilePhotoPreview) {
        URL.revokeObjectURL(profilePhotoPreview);
      }
    };
  }, [profilePhotoPreview]);
  useEffect(() => {
    if (!useSameWhatsappNumber) {
      return;
    }
    setWhatsappCountryCode(phoneCountryCode);
    setWhatsappLocalNumber(phoneLocalNumber);
    setWhatsappHandle(phone);
    setWhatsappPhoneError(null);
  }, [useSameWhatsappNumber, phone, phoneCountryCode, phoneLocalNumber]);

  const rules = [
    { regex: /(?=.*[0-9])/, description: 'At least one digit' },
    { regex: /(?=.*[a-z])/, description: 'At least one lowercase letter' },
    { regex: /(?=.*[A-Z])/, description: 'At least one uppercase letter' },
    { regex: /(?=.*[*.!@$%^&(){}[\]:;<>,.?/~_+-=|\\])/, description: 'At least one special character' },
    { regex: /.{8,32}/, description: 'Must be 8-32 characters long' },
  ];

  const PasswordRule: React.FC<{ rule: { regex: RegExp; description: string }; isValid: boolean }> = ({ rule, isValid }) => (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {isValid ? <IconCheck color="green" /> : <IconX color="red" />}
      <span style={{ fontSize: '0.9rem', marginLeft: 4 }}>{rule.description}</span>
    </div>
  );

  const handleToggleMode = () => {
    setIsSignup(!isSignup);
    setActiveStep(0);
    dispatch(clearSessionError());
    setStaffType('volunteer');
    setLivesInAccom(true);
    setSelectedShiftRoles([]);
    setEmail('');
    setEmailError(null);
    setFirstName('');
    setLastName('');
    setPhone('');
    setPhoneLocalNumber('');
    setPhoneCountryCode(DEFAULT_PHONE_CODE);
    setPhoneError(null);
    setCountryOfCitizenship('');
    setDateOfBirth('');
    setPreferredPronouns('');
    setCustomPronouns('');
    setEmergencyContactName('');
    setEmergencyContactRelationship('');
    setEmergencyContactPhone('');
    setEmergencyPhoneLocalNumber('');
    setEmergencyPhoneCountryCode(DEFAULT_PHONE_CODE);
    setEmergencyPhoneError(null);
    setEmergencyContactEmail('');
    setEmergencyEmailError(null);
    setArrivalDate('');
    setDepartureDate('');
    setDietaryRestrictions('');
    setAllergies('');
    setMedicalNotes('');
    setWhatsappHandle('');
    setUseSameWhatsappNumber(true);
    setWhatsappCountryCode(DEFAULT_PHONE_CODE);
    setWhatsappLocalNumber('');
    setWhatsappPhoneError(null);
    setFacebookProfileUrl('');
    setInstagramProfileUrl('');
    setDiscoverySource('');
    setProfilePhotoError(null);
    setProfilePhotoFile(null);
    setProfilePhotoPreview(null);
  };

  const handleOpenMiniGame = () => {
    if (typeof window === 'undefined') {
      return;
    }
    window.dispatchEvent(new CustomEvent('omni-open-game'));
  };

  const handleProfilePhotoChange = (file: File | null) => {
    if (!file) {
      setProfilePhotoFile(null);
      setProfilePhotoPreview(null);
      setProfilePhotoError(null);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setProfilePhotoError('Upload an image file (JPG, PNG, HEIC, or WEBP)');
      setProfilePhotoFile(null);
      setProfilePhotoPreview(null);
      return;
    }

    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
      setProfilePhotoError('Image must be 10 MB or less');
      setProfilePhotoFile(null);
      setProfilePhotoPreview(null);
      return;
    }

    setProfilePhotoError(null);
    setProfilePhotoFile(file);
    setProfilePhotoPreview(URL.createObjectURL(file));
  };

  const handleRemoveProfilePhoto = () => {
    setProfilePhotoFile(null);
    setProfilePhotoPreview(null);
    setProfilePhotoError(null);
  };

  const handleShiftRolesChange = (values: string[]) => {
    setSelectedShiftRoles(values);
    setRolesDropdownOpened(false);
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await dispatch(loginUser({ email: user, password })).unwrap();
    } catch (err) {
      console.error('Login failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isFinalSignupStep) {
      if (canAdvanceFromStep(activeStep)) {
        goToStep(activeStep + 1);
      }
      return;
    }
    if (!useSameWhatsappNumber) {
      if (whatsappLocalNumber.length === 0) {
        setWhatsappPhoneError('WhatsApp number is required');
        return;
      }
      if (!isPhoneNumberValid(normalizePhoneNumber(whatsappHandle))) {
        setWhatsappPhoneError('Enter a valid phone number');
        return;
      }
    }
    setLoading(true);
    try {
      const numericRoleIds = selectedShiftRoles
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      const normalizedPronounsValue = preferredPronouns === 'custom' ? customPronouns : preferredPronouns;
      const normalizedCountry = sanitize(countryOfCitizenship);
      const normalizedPronouns = sanitize(normalizedPronounsValue);
      const formPayload = new FormData();
      const appendField = (
        key: string,
        value: string | number | boolean | null | undefined,
      ) => {
        if (value === undefined || value === null) {
          return;
        }
        if (typeof value === 'boolean') {
          formPayload.append(key, value ? 'true' : 'false');
          return;
        }
        const text = value.toString().trim();
        if (text.length === 0) {
          return;
        }
        formPayload.append(key, text);
      };

      appendField('username', user);
      appendField('email', email);
      appendField('password', password);
      appendField('firstName', firstName);
      appendField('lastName', lastName);
      appendField('staffType', staffType);
      appendField('livesInAccom', livesInAccom);
      appendField('shiftRoleIds', JSON.stringify(numericRoleIds));
      appendField('phone', normalizePhoneNumber(phone));
      appendField('countryOfCitizenship', normalizedCountry);
      appendField('dateOfBirth', sanitize(dateOfBirth));
      appendField('preferredPronouns', normalizedPronouns);
      appendField('emergencyContactName', sanitize(emergencyContactName));
      appendField('emergencyContactRelationship', sanitize(emergencyContactRelationship));
      appendField('emergencyContactPhone', normalizePhoneNumber(emergencyContactPhone));
      appendField('emergencyContactEmail', sanitize(emergencyContactEmail));
      appendField('arrivalDate', sanitize(arrivalDate));
      appendField('departureDate', sanitize(departureDate));
      appendField('dietaryRestrictions', sanitize(dietaryRestrictions));
      appendField('allergies', sanitize(allergies));
      appendField('medicalNotes', sanitize(medicalNotes));
      appendField('whatsappHandle', normalizePhoneNumber(whatsappHandle));
      appendField('facebookProfileUrl', sanitize(facebookProfileUrl));
      appendField('instagramProfileUrl', sanitize(instagramProfileUrl));
      appendField('discoverySource', sanitize(discoverySource));

      if (profilePhotoFile) {
        formPayload.append('profilePhoto', profilePhotoFile);
      }

      await dispatch(createUser(formPayload)).unwrap();
      handleToggleMode();
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('Sign up failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setEmail(value);
    if (value.trim().length === 0) {
      setEmailError('Email is required');
      return;
    }
    setEmailError(EMAIL_REGEX.test(value.trim().toLowerCase()) ? null : 'Enter a valid email');
  };

  const handleEmailBlur = () => {
    if (email.trim().length === 0) {
      setEmailError('Email is required');
    } else if (!EMAIL_REGEX.test(email.trim().toLowerCase())) {
      setEmailError('Enter a valid email');
    }
  };

  const handlePasswordChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPassword(event.target.value);
    setPasswordsMatch(event.target.value === confirmPassword);
    dispatch(clearSessionError());
  };

  const handleConfirmPasswordChange = (event: ChangeEvent<HTMLInputElement>) => {
    setConfirmPassword(event.target.value);
    setPasswordsMatch(event.target.value === password);
    dispatch(clearSessionError());
  };

  const handlePhoneInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = event.target.value.replace(/\D/g, '');
    setPhoneLocalNumber(digitsOnly);
    const full = buildPhoneFromParts(phoneCountryCode, digitsOnly);
    setPhone(full);
    if (digitsOnly.length === 0) {
      setPhoneError('Phone number is required');
      return;
    }
    setPhoneError(isPhoneNumberValid(full) ? null : 'Enter a valid phone number');
  };

  const handlePhoneCodeChange = (code: string) => {
    setPhoneCountryCode(code);
    const full = buildPhoneFromParts(code, phoneLocalNumber);
    setPhone(full);
    if (phoneLocalNumber.trim().length > 0) {
      setPhoneError(isPhoneNumberValid(full) ? null : 'Enter a valid phone number');
    }
  };

  const handlePhoneBlur = () => {
    if (phoneLocalNumber.trim().length === 0) {
      setPhoneError('Phone number is required');
    } else if (!isPhoneNumberValid(phone)) {
      setPhoneError('Enter a valid phone number');
    }
  };

  const handleEmergencyPhoneChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = event.target.value.replace(/\D/g, '');
    setEmergencyPhoneLocalNumber(digitsOnly);
    const full = buildPhoneFromParts(emergencyPhoneCountryCode, digitsOnly);
    setEmergencyContactPhone(full);
    if (digitsOnly.length === 0) {
      setEmergencyPhoneError('Emergency phone is required');
      return;
    }
    setEmergencyPhoneError(isPhoneNumberValid(full) ? null : 'Enter a valid phone number');
  };

  const handleEmergencyPhoneCodeChange = (code: string) => {
    setEmergencyPhoneCountryCode(code);
    const full = buildPhoneFromParts(code, emergencyPhoneLocalNumber);
    setEmergencyContactPhone(full);
    if (emergencyPhoneLocalNumber.trim().length > 0) {
      setEmergencyPhoneError(isPhoneNumberValid(full) ? null : 'Enter a valid phone number');
    }
  };

  const handleEmergencyPhoneBlur = () => {
    if (emergencyPhoneLocalNumber.trim().length === 0) {
      setEmergencyPhoneError('Emergency phone is required');
    } else if (!isPhoneNumberValid(emergencyContactPhone)) {
      setEmergencyPhoneError('Enter a valid phone number');
    }
  };


  const handleEmergencyEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setEmergencyContactEmail(value);
    if (value.trim().length === 0) {
      setEmergencyEmailError(null);
      return;
    }
    setEmergencyEmailError(EMAIL_REGEX.test(value.trim().toLowerCase()) ? null : 'Enter a valid email');
  };

  const handleEmergencyEmailBlur = () => {
    if (emergencyContactEmail.trim().length === 0) {
      setEmergencyEmailError(null);
    } else if (!EMAIL_REGEX.test(emergencyContactEmail.trim().toLowerCase())) {
      setEmergencyEmailError('Enter a valid email');
    }
  };

  const isPasswordValid = (value: string) => rules.every((rule) => rule.regex.test(value));

const sanitize = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

  const phoneIsValid = isPhoneNumberValid(phone);
  const countrySelected = countryOfCitizenship.trim().length > 0;
  const pronounValid =
    preferredPronouns.trim().length > 0 &&
    (preferredPronouns !== 'custom' || customPronouns.trim().length > 0);
  const emailIsValid = EMAIL_REGEX.test(email.trim().toLowerCase());
  const emergencyPhoneIsValid = isPhoneNumberValid(emergencyContactPhone);
  const emergencyEmailIsValid =
    emergencyContactEmail.trim().length === 0 ||
    EMAIL_REGEX.test(emergencyContactEmail.trim().toLowerCase());
  const normalizedWhatsappHandle = normalizePhoneNumber(whatsappHandle);
  const whatsappIsValid = useSameWhatsappNumber
    ? phoneIsValid
    : normalizedWhatsappHandle.length > 0 && isPhoneNumberValid(normalizedWhatsappHandle);

  const signupRequirementsMet =
    passwordsMatch &&
    isPasswordValid(password) &&
    selectedShiftRoles.length > 0 &&
    emailIsValid &&
    phoneIsValid &&
    countrySelected &&
    arrivalDate.trim().length > 0 &&
    departureDate.trim().length > 0 &&
    emergencyContactName.trim().length > 0 &&
    emergencyPhoneIsValid &&
    emergencyEmailIsValid &&
    whatsappIsValid &&
    discoverySource.trim().length > 0 &&
    pronounValid;

  const loginDisabled = loading || password === '' || user === '';
  const signupSubmitDisabled = loading || password === '' || user === '' || !signupRequirementsMet;

  const totalSignupSteps = SIGNUP_STEPS.length;
  const isFinalSignupStep = activeStep === totalSignupSteps - 1;
  const activeStepKey = SIGNUP_STEPS[activeStep]?.key ?? SIGNUP_STEPS[0].key;
  const stepProgress = Math.round(((activeStep + 1) / totalSignupSteps) * 100);

  const canAdvanceFromStep = (stepIndex: number) => {
    const stepKey = SIGNUP_STEPS[stepIndex]?.key;
    switch (stepKey) {
      case 'profile':
        return (
          user.trim().length > 0 &&
          email.trim().length > 0 &&
          firstName.trim().length > 0 &&
          lastName.trim().length > 0 &&
          phoneIsValid &&
          countrySelected &&
          pronounValid
        );
      case 'roles':
        return selectedShiftRoles.length > 0;
      case 'stay':
        return (
          arrivalDate.trim().length > 0 &&
          departureDate.trim().length > 0 &&
          discoverySource.trim().length > 0
        );
      case 'emergency':
        return emergencyContactName.trim().length > 0 && emergencyContactPhone.trim().length > 0;
      case 'health':
        return true;
      case 'connect':
      default:
        return signupRequirementsMet;
    }
  };

  const goToStep = (target: number) => {
    const clamped = Math.min(Math.max(target, 0), totalSignupSteps - 1);
    setActiveStep(clamped);
  };

  const handleNextStep = () => {
    if (activeStepKey === 'profile') {
      handlePhoneBlur();
    }
    if (activeStepKey === 'connect') {
      handleWhatsappBlur();
    }
    if (activeStep < totalSignupSteps - 1 && canAdvanceFromStep(activeStep)) {
      goToStep(activeStep + 1);
    }
  };

  const handlePreviousStep = () => {
    goToStep(activeStep - 1);
  };

  const renderSignupStep = () => {
    switch (activeStepKey) {
      case 'profile':
        return (
          <Stack gap="sm">
            <Stack gap={4}>
              <Text fw={600}>Profile photo (optional)</Text>
              <Group gap="md" align="flex-start" wrap="nowrap">
                <Avatar size={72} radius="xl" src={profilePhotoPreview ?? undefined}>
                  {!profilePhotoPreview ? <IconUser size={28} /> : null}
                </Avatar>
                <Stack gap={4} style={{ flex: 1 }}>
                  <FileInput
                    placeholder="Upload an image"
                    accept="image/*"
                    value={profilePhotoFile}
                    onChange={handleProfilePhotoChange}
                    clearable
                  />
                  {profilePhotoFile ? (
                    <Group gap="xs">
                      <Button variant="subtle" size="xs" color="gray" onClick={handleRemoveProfilePhoto}>
                        Remove photo
                      </Button>
                    </Group>
                  ) : null}
                  <Text size="xs" c={profilePhotoError ? 'red.6' : 'dimmed'}>
                    {profilePhotoError ?? 'JPG, PNG, HEIC, or WEBP (max 10 MB).'}
                  </Text>
                </Stack>
              </Group>
            </Stack>
            <TextInput
              label="Username"
              placeholder="Pick a username"
              value={user}
              onChange={(event: ChangeEvent<HTMLInputElement>) => dispatch(setUserState(event.target.value))}
              leftSection={<IconUser />}
              required
            />
            <TextInput
              label="Email"
              placeholder="Email"
              value={email}
              onChange={handleEmailChange}
              onBlur={handleEmailBlur}
              required
              error={emailError ?? undefined}
            />
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="First Name"
                  placeholder="First Name"
                  value={firstName}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setFirstName(event.target.value)}
                  required
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Last Name"
                  placeholder="Last Name"
                  value={lastName}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setLastName(event.target.value)}
                  required
                />
              </Grid.Col>
            </Grid>
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Grid gutter="xs">
                  <Grid.Col span={{ base: 12, sm: 5 }}>
                    <PhoneCodeSelectField label="Country Code" value={phoneCountryCode} onChange={handlePhoneCodeChange} placeholder="+48" />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 7 }}>
                    <TextInput
                      label="Phone number"
                      placeholder="600 000 000"
                      value={phoneLocalNumber}
                      onChange={handlePhoneInputChange}
                      onBlur={handlePhoneBlur}
                      type="tel"
                      required
                      error={phoneError ?? undefined}
                      description="Digits only"
                    />
                  </Grid.Col>
                </Grid>
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label="Where are you from?"
                  placeholder="Select country"
                  data={COUNTRY_OPTIONS}
                  searchable
                  nothingFoundMessage="No countries"
                  value={countryOfCitizenship || null}
                  onChange={(value) => setCountryOfCitizenship(value ?? '')}
                  required
                />
              </Grid.Col>
            </Grid>
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Date of birth"
                  placeholder="Select date"
                  value={dateOfBirth}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setDateOfBirth(event.target.value)}
                  type="date"
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Select
                  label="Preferred pronouns"
                  placeholder="Select pronouns"
                  data={PRONOUN_OPTIONS}
                  value={preferredPronouns || null}
                  onChange={(value) => {
                    setPreferredPronouns(value ?? '');
                    if (value !== 'custom') {
                      setCustomPronouns('');
                    }
                  }}
                  required
                />
              </Grid.Col>
            </Grid>
            {preferredPronouns === 'custom' ? (
              <TextInput
                label="Self-described pronouns"
                placeholder="e.g. Ze / Zir"
                value={customPronouns}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setCustomPronouns(event.target.value)}
                required
              />
            ) : null}
            <PasswordInput
              label="Password"
              placeholder="Password"
              value={password}
              onChange={handlePasswordChange}
              leftSection={<IconLock />}
              required
            />
            {rules.map((rule) => (
              <PasswordRule key={rule.description} rule={rule} isValid={rule.regex.test(password)} />
            ))}
            <PasswordInput
              label="Confirm Password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={handleConfirmPasswordChange}
              leftSection={<IconLock />}
              required
            />
          </Stack>
        );
      case 'roles':
        return (
          <Stack gap="sm">
            <Select
              label="What kind of staff will you be?"
              placeholder="Select staff type"
              data={[
                { value: 'volunteer', label: 'Volunteer' },
                { value: 'long_term', label: 'Long Term' },
              ]}
              value={staffType}
              onChange={(value) => value && setStaffType(value as 'volunteer' | 'long_term')}
              required
            />
            <Select
              label="Will you live in the volunteers accommodation?"
              placeholder="Choose one"
              data={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
              value={livesInAccom ? 'yes' : 'no'}
              onChange={(value) => setLivesInAccom(value === 'yes')}
              required
            />
            <MultiSelect
              label="What roles are you going to perform?"
              placeholder={shiftRolesQuery.isLoading ? 'Loading roles...' : 'Select shift roles'}
              data={shiftRoleOptions}
              value={selectedShiftRoles}
              onChange={handleShiftRolesChange}
              searchable
              disabled={shiftRolesQuery.isLoading || shiftRolesQuery.isError}
              required
              nothingFoundMessage={shiftRolesQuery.isLoading ? 'Loading...' : 'No roles'}
              dropdownOpened={rolesDropdownOpened}
              onDropdownOpen={() => setRolesDropdownOpened(true)}
              onDropdownClose={() => setRolesDropdownOpened(false)}
            />
          </Stack>
        );
      case 'stay':
        return (
          <Stack gap="sm">
            <Select
              label="How did you hear about the experience?"
              placeholder="Select one"
              data={DISCOVERY_SOURCE_OPTIONS}
              value={discoverySource || null}
              onChange={(value) => setDiscoverySource(value ?? '')}
              required
            />
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Arrival date"
                  type="date"
                  value={arrivalDate}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setArrivalDate(event.target.value)}
                  required
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Departure date"
                  type="date"
                  value={departureDate}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setDepartureDate(event.target.value)}
                  required
                />
              </Grid.Col>
            </Grid>
          </Stack>
        );
      case 'emergency':
        return (
          <Stack gap="sm">
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Emergency contact name"
                  placeholder="Full name"
                  value={emergencyContactName}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setEmergencyContactName(event.target.value)}
                  required
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Relationship"
                  placeholder="e.g. sibling"
                  value={emergencyContactRelationship}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setEmergencyContactRelationship(event.target.value)}
                />
              </Grid.Col>
            </Grid>
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Grid gutter="xs">
                  <Grid.Col span={{ base: 12, sm: 5 }}>
                    <PhoneCodeSelectField
                      label="Code"
                      value={emergencyPhoneCountryCode}
                      onChange={handleEmergencyPhoneCodeChange}
                      placeholder="+48"
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 7 }}>
                    <TextInput
                      label="Emergency phone"
                      placeholder="600 000 000"
                      value={emergencyPhoneLocalNumber}
                      onChange={handleEmergencyPhoneChange}
                      onBlur={handleEmergencyPhoneBlur}
                      type="tel"
                      required
                      description="Digits only"
                      error={emergencyPhoneError ?? undefined}
                    />
                  </Grid.Col>
                </Grid>
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Emergency email"
                  placeholder="contact@email.com"
                  value={emergencyContactEmail}
                  onChange={handleEmergencyEmailChange}
                  onBlur={handleEmergencyEmailBlur}
                  type="email"
                  error={emergencyEmailError ?? undefined}
                />
              </Grid.Col>
            </Grid>
          </Stack>
        );
      case 'health':
        return (
          <Stack gap="sm">
            <Textarea
              label="Dietary preferences or restrictions"
              placeholder="Vegan, vegetarian, gluten-free, etc."
              value={dietaryRestrictions}
              onChange={(event) => setDietaryRestrictions(event.currentTarget.value)}
              autosize
              minRows={1}
            />
            <Textarea
              label="Allergies"
              placeholder="List any allergies we should be aware of"
              value={allergies}
              onChange={(event) => setAllergies(event.currentTarget.value)}
              autosize
              minRows={1}
            />
            <Textarea
              label="Medical notes (optional)"
              placeholder="Optional information you'd like the team to know"
              value={medicalNotes}
              onChange={(event) => setMedicalNotes(event.currentTarget.value)}
              autosize
              minRows={1}
            />
          </Stack>
        );
      case 'connect':
      default:
        return (
          <Stack gap="sm">
            <Stack gap="xs">
              <Switch
                label="Use same number for WhatsApp"
                checked={useSameWhatsappNumber}
                onChange={(event) => handleWhatsappSameToggle(event.currentTarget.checked)}
              />
              {!useSameWhatsappNumber && (
                <Grid gutter="xs">
                  <Grid.Col span={{ base: 12, sm: 5 }}>
                    <PhoneCodeSelectField
                      label="WhatsApp code"
                      value={whatsappCountryCode}
                      onChange={handleWhatsappCountryCodeChange}
                      placeholder="+48"
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 7 }}>
                    <TextInput
                      label="WhatsApp number"
                      placeholder="600 000 000"
                      value={whatsappLocalNumber}
                      onChange={handleWhatsappLocalNumberChange}
                      onBlur={handleWhatsappBlur}
                      type="tel"
                      description="Digits only"
                      error={whatsappPhoneError ?? undefined}
                    />
                  </Grid.Col>
                </Grid>
              )}
              <Text size="sm" c={whatsappPhoneError ? 'red.6' : 'dimmed'}>
                {useSameWhatsappNumber
                  ? 'We will reuse your primary phone number for WhatsApp updates.'
                  : whatsappPhoneError ?? 'Enter digits only; we will format it automatically.'}
              </Text>
            </Stack>
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Facebook profile URL"
                  placeholder="https://facebook.com/username"
                  value={facebookProfileUrl}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setFacebookProfileUrl(event.target.value)}
                  type="url"
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Instagram profile URL"
                  placeholder="https://instagram.com/username"
                  value={instagramProfileUrl}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setInstagramProfileUrl(event.target.value)}
                  type="url"
                />
              </Grid.Col>
            </Grid>
          </Stack>
        );
    }
  };

  const renderSignupActions = () => {
    const sharedButtonProps = isSmallScreen ? { fullWidth: true } : {};

    const previousButton = (
      <Button
        type="button"
        variant="subtle"
        onClick={handlePreviousStep}
        disabled={activeStep === 0 || loading}
        {...sharedButtonProps}
      >
        Previous
      </Button>
    );

    const nextOrSubmitButton = isFinalSignupStep ? (
      <Button type="submit" disabled={signupSubmitDisabled} loading={loading} {...sharedButtonProps}>
        Create account
      </Button>
    ) : (
      <Button
        type="button"
        onClick={handleNextStep}
        disabled={!canAdvanceFromStep(activeStep) || loading}
        {...sharedButtonProps}
      >
        Next
      </Button>
    );

    return isSmallScreen ? (
      <Stack gap="xs" mt="md">
        {previousButton}
        {nextOrSubmitButton}
      </Stack>
    ) : (
      <Group justify="space-between" mt="sm">
        {previousButton}
        {nextOrSubmitButton}
      </Group>
    );
  };

  const isSmallScreen = useMediaQuery('(max-width: 48em)');

  return (
    <Box
      style={{
        minHeight: '100vh',
        width: '100%',
        background: 'linear-gradient(135deg, #f6f8ff 0%, #f0edff 45%, #ffeef7 100%)',
        padding: isSmallScreen ? '16px 12px 32px' : '32px 24px 48px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflowY: 'auto',
      }}
    >
      <Container size="lg" px="md" style={{ paddingTop: isSmallScreen ? 8 : 24 }}>
        <Paper
          radius={isSmallScreen ? 12 : 20}
          p={isSmallScreen ? 'md' : 'xl'}
          withBorder
          shadow="xl"
          style={{ maxWidth: 640, margin: '0 auto', borderColor: '#edf0ff' }}
        >
          <Stack gap="md" align="center">
            <Avatar variant="light" radius="xl" size={isSmallScreen ? 52 : 64} color="indigo.6">
              <IconUser size={isSmallScreen ? 22 : 30} />
            </Avatar>
            <Stack gap={2} align="center" ta="center">
              <Title order={isSmallScreen ? 3 : 2} style={{ fontWeight: 800 }}>
                {isSignup ? 'Join OmniLodge' : 'Welcome Back'}
              </Title>
              <Text size="sm" c="dimmed">
                {isSignup
                  ? 'Create an account to manage your shifts and stay connected.'
                  : 'Sign in to view your schedule and team updates.'}
              </Text>
            </Stack>
          </Stack>

          {!isSignup && error ? (
            <Alert color="red" title="Login failed" mt="lg">
              {error}
            </Alert>
          ) : null}

          <form onSubmit={isSignup ? handleSignUp : handleLogin}>
            <Stack gap="md" mt="lg">
              {!isSignup ? (
                <TextInput
                  label="Username"
                  placeholder="Username"
                  value={user}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => dispatch(setUserState(event.target.value))}
                  leftSection={<IconUser />}
                  required
                />
              ) : null}
              {isSignup ? (
                <Stack gap="sm">
                  <Progress value={stepProgress} size="lg" radius="lg" />
                  <Text size="sm" c="dimmed" ta="center">
                    Step {activeStep + 1} of {totalSignupSteps} • {stepProgress}% complete ·{' '}
                    {SIGNUP_STEPS[activeStep]?.description}
                  </Text>
                  <Box style={{ minHeight: isSmallScreen ? undefined : 220 }}>
                    {renderSignupStep()}
                  </Box>
                </Stack>
              ) : null}

              {!isSignup ? (
                <>
                  <PasswordInput
                    label="Password"
                    placeholder="Password"
                    value={password}
                    onChange={handlePasswordChange}
                    leftSection={<IconLock />}
                    required
                  />
                </>
              ) : null}
              {isSignup && shiftRolesQuery.isError ? (
                <Text size="sm" c="red.6">
                  {(shiftRolesQuery.error as Error).message}
                </Text>
              ) : null}
              {isSignup && !passwordsMatch ? (
                <Text size="sm" c="red.6">
                  Passwords do not match
                </Text>
              ) : null}
              {isSignup ? (
                renderSignupActions()
              ) : (
                <Button fullWidth mt="sm" type="submit" disabled={loginDisabled} loading={loading} size="md">
                  Sign in
                </Button>
              )}
            </Stack>
          </form>

          <Button variant="link" onClick={handleToggleMode} mt="md" mb="xs" fullWidth>
            {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </Button>
        </Paper>
        <Button variant="outline" onClick={handleOpenMiniGame} mt="md" fullWidth>
          Play Krakow Runner
        </Button>
      </Container>
    </Box>
  );
};
export default LoginPage;
  const updateWhatsappFromParts = (code: string, digits: string) => {
    const cleaned = digits.replace(/\D/g, '');
    if (cleaned.length === 0) {
      setWhatsappHandle('');
      return '';
    }
    const full = buildPhoneFromParts(code, cleaned);
    setWhatsappHandle(full);
    return full;
  };

  const handleWhatsappSameToggle = (checked: boolean) => {
    setUseSameWhatsappNumber(checked);
    if (checked) {
      setWhatsappHandle(phone);
      setWhatsappPhoneError(null);
      return;
    }
    const parts = splitPhoneNumber(whatsappHandle || phone);
    setWhatsappCountryCode(parts.code);
    setWhatsappLocalNumber(parts.digits);
    if (parts.digits.length === 0) {
      setWhatsappHandle('');
      setWhatsappPhoneError('WhatsApp number is required');
    } else {
      const full = buildPhoneFromParts(parts.code, parts.digits);
      setWhatsappHandle(full);
      setWhatsappPhoneError(
        isPhoneNumberValid(normalizePhoneNumber(full)) ? null : 'Enter a valid phone number',
      );
    }
  };

  const handleWhatsappCountryCodeChange = (code: string) => {
    setWhatsappCountryCode(code);
    if (useSameWhatsappNumber) {
      return;
    }
    if (whatsappLocalNumber.length === 0) {
      setWhatsappHandle('');
      return;
    }
    const full = updateWhatsappFromParts(code, whatsappLocalNumber);
    setWhatsappPhoneError(
      isPhoneNumberValid(normalizePhoneNumber(full)) ? null : 'Enter a valid phone number',
    );
  };

  const handleWhatsappLocalNumberChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = event.target.value.replace(/\D/g, '');
    setWhatsappLocalNumber(digitsOnly);
    if (useSameWhatsappNumber) {
      return;
    }
    if (digitsOnly.length === 0) {
      setWhatsappHandle('');
      setWhatsappPhoneError('WhatsApp number is required');
      return;
    }
    const full = updateWhatsappFromParts(whatsappCountryCode, digitsOnly);
    setWhatsappPhoneError(
      isPhoneNumberValid(normalizePhoneNumber(full)) ? null : 'Enter a valid phone number',
    );
  };

  const handleWhatsappBlur = () => {
    if (useSameWhatsappNumber) {
      return;
    }
    if (whatsappLocalNumber.length === 0) {
      setWhatsappPhoneError('WhatsApp number is required');
      return;
    }
    if (!isPhoneNumberValid(normalizePhoneNumber(whatsappHandle))) {
      setWhatsappPhoneError('Enter a valid phone number');
    }
  };
