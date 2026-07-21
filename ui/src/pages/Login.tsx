import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
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
  ThemeIcon,
  SimpleGrid,
  Accordion,
  Modal,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import EmojiPicker, { EmojiStyle, Theme as EmojiPickerTheme, type EmojiClickData } from 'emoji-picker-react';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconLock,
  IconSparkles,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchSession, setUserState } from '../actions/sessionActions';
import { loginUser, createUser } from '../actions/userActions';
import { clearSessionError } from '../reducers/sessionReducer';
import { useShiftRoles } from '../api/shiftRoles';
import type { ShiftRole } from '../types/shiftRoles/ShiftRole';
import { useMediaQuery } from '@mantine/hooks';
import { useNavigate } from 'react-router-dom';
import PhoneCodeSelectField from '../components/common/PhoneCodeSelectField';
import { StaffBadgeFrontPreview } from '../components/badges/StaffBadgeFrontPreview';
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
  { key: 'badge', label: 'Badge', description: 'Staff badge setup' },
] as const;

type SignupStepKey = typeof SIGNUP_STEPS[number]['key'];

const PROFILE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const BADGE_GUIDE_TEMPLATE_SRC = '/assets/badges/ktk-guide-badge.svg';
const BADGE_MEDIA_TEMPLATE_SRC = '/assets/badges/ktk-media-badge.svg';
const SIGNUP_DRAFT_STORAGE_KEY = 'omnilodge.signupDraft.v1';
const SIGNUP_DRAFT_PHOTO_DB = 'omnilodge-signup-draft';
const SIGNUP_DRAFT_PHOTO_STORE = 'files';
const SIGNUP_DRAFT_PHOTO_KEY = 'profilePhoto';

type SignupDraft = {
  isSignup: boolean;
  activeStep: number;
  reviewedSignupStepKeys: SignupStepKey[];
  user: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  phoneCountryCode: string;
  phoneLocalNumber: string;
  countryOfCitizenship: string;
  dateOfBirth: string;
  preferredPronouns: string;
  customPronouns: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  emergencyPhoneCountryCode: string;
  emergencyPhoneLocalNumber: string;
  emergencyContactEmail: string;
  arrivalDate: string;
  departureDate: string;
  dietaryRestrictions: string;
  allergies: string;
  medicalNotes: string;
  whatsappHandle: string;
  useSameWhatsappNumber: boolean;
  whatsappCountryCode: string;
  whatsappLocalNumber: string;
  facebookProfileUrl: string;
  instagramProfileUrl: string;
  discoverySource: string;
  signupUserType: 'guide' | 'social_media';
  badgeName: string;
  badgePrefixEmoji: string;
  badgeSuffixEmoji: string;
  badgeNameTouched: boolean;
  staffType: 'volunteer' | 'long_term';
  livesInAccom: boolean;
  selectedShiftRoles: string[];
};

const openSignupDraftDb = () =>
  new Promise<IDBDatabase | null>((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    const request = window.indexedDB.open(SIGNUP_DRAFT_PHOTO_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SIGNUP_DRAFT_PHOTO_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

const runSignupPhotoRequest = async <T,>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
  const db = await openSignupDraftDb();
  if (!db) {
    return undefined;
  }
  return new Promise<T | undefined>((resolve) => {
    const transaction = db.transaction(SIGNUP_DRAFT_PHOTO_STORE, mode);
    const request = action(transaction.objectStore(SIGNUP_DRAFT_PHOTO_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
};

const saveSignupDraftPhoto = (file: File) =>
  runSignupPhotoRequest('readwrite', (store) => store.put(file, SIGNUP_DRAFT_PHOTO_KEY));

const loadSignupDraftPhoto = async () => {
  const file = await runSignupPhotoRequest<File>('readonly', (store) => store.get(SIGNUP_DRAFT_PHOTO_KEY));
  return file instanceof File ? file : null;
};

const clearSignupDraftPhoto = () =>
  runSignupPhotoRequest('readwrite', (store) => store.delete(SIGNUP_DRAFT_PHOTO_KEY));

const CENTERED_SELECT_STYLES = {
  input: { textAlign: 'center' },
  option: { justifyContent: 'center', textAlign: 'center' },
} as const;

const CENTERED_MULTI_SELECT_STYLES = {
  input: { justifyContent: 'center', textAlign: 'center' },
  pillsList: { justifyContent: 'center' },
  inputField: { flex: '0 0 auto', textAlign: 'center' },
  pill: { marginInline: 0 },
  option: { justifyContent: 'center', textAlign: 'center' },
} as const;

const formatDateInput = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const normalizeDateInput = (value: string) => {
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}/${month}/${year}`;
  }
  return formatDateInput(trimmed);
};

const parseDateForSubmit = (value: string) => {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return undefined;
  }
  const [, day, month, year] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getDate() !== Number(day)
  ) {
    return undefined;
  }
  return `${year}-${month}-${day}`;
};

const parseDateInputToDate = (value: string) => {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }
  const [, day, month, year] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateFromPicker = (value: Date | null) => {
  if (!value) {
    return '';
  }
  const day = value.getDate().toString().padStart(2, '0');
  const month = (value.getMonth() + 1).toString().padStart(2, '0');
  const year = value.getFullYear().toString();
  return `${day}/${month}/${year}`;
};

const validateRequiredDate = (value: string, fieldName: string) => {
  if (value.trim().length === 0) {
    return `${fieldName} is required`;
  }
  return parseDateForSubmit(value) ? null : 'Use dd/mm/yyyy';
};

const extractSocialUsername = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const normalized = trimmed.replace(/^@+/, '');
  try {
    const parsed = new URL(normalized.startsWith('http') ? normalized : `https://${normalized}`);
    const pathUsername = parsed.pathname.split('/').filter(Boolean)[0];
    return (pathUsername ?? parsed.hostname).replace(/^@+/, '');
  } catch {
    return normalized
      .replace(/^https?:\/\//i, '')
      .replace(/^(www\.)?(facebook|instagram)\.com\//i, '')
      .split(/[/?#]/)[0]
      .replace(/^@+/, '');
  }
};

const buildSocialProfileUrl = (platform: 'facebook' | 'instagram', usernameValue: string) => {
  const username = extractSocialUsername(usernameValue);
  return username.length > 0 ? `https://${platform}.com/${username}` : undefined;
};

const signupFlowCss = `
  .signup-flow .mantine-Input-input {
    min-height: 46px;
    border-color: #d7deea;
    background: #ffffff;
    font-size: 15px;
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }
  .signup-flow .mantine-Input-input:focus,
  .signup-flow .mantine-Input-input:focus-within {
    border-color: #228be6;
    box-shadow: 0 0 0 3px rgba(34, 139, 230, 0.12);
  }
  .signup-flow .mantine-InputWrapper-label {
    color: #172033;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .signup-flow .mantine-InputWrapper-description {
    color: #7a8597;
    margin-top: 5px;
  }
  .signup-flow .mantine-Textarea-input {
    min-height: 86px;
    padding-top: 12px;
  }
  .signup-flow .mantine-MultiSelect-pill {
    background: #e7f5ff;
    color: #0b66c3;
    font-weight: 700;
  }
  .signup-profile-card .mantine-InputWrapper-label,
  .signup-profile-card .mantine-InputWrapper-description,
  .signup-profile-card .mantine-InputWrapper-error {
    width: 100%;
    text-align: center;
  }
  .signup-profile-card .mantine-Input-input,
  .signup-profile-card .mantine-InputBase-input {
    text-align: center;
  }
  .signup-profile-card .mantine-Input-section {
    color: #8491a3;
  }
  .signup-section-body .mantine-InputWrapper-label,
  .signup-section-body .mantine-InputWrapper-description,
  .signup-section-body .mantine-InputWrapper-error {
    width: 100%;
    text-align: center;
  }
  .signup-section-body .mantine-Input-input,
  .signup-section-body .mantine-InputBase-input,
  .signup-section-body .mantine-Select-input,
  .signup-section-body .mantine-MultiSelect-input,
  .signup-section-body .mantine-Textarea-input {
    text-align: center;
  }
  .signup-section-body .mantine-MultiSelect-pillsList {
    justify-content: center;
  }
  .signup-section-body .mantine-PillsInput-input,
  .signup-section-body .mantine-PillsInput-field,
  .signup-section-body .mantine-MultiSelect-inputField {
    text-align: center;
  }
  .signup-section-body .mantine-PillsInput-input {
    justify-content: center;
  }
  .signup-flow .mantine-Select-option,
  .signup-flow .mantine-MultiSelect-option {
    text-align: center;
    justify-content: center;
  }
  .signup-photo-drop .mantine-Input-input {
    border-style: dashed;
    min-height: 58px;
    font-weight: 700;
  }
  .signup-phone-panel .mantine-InputWrapper-label {
    font-size: 12px;
    font-weight: 800;
    color: #6f7b8d;
  }
  .signup-phone-panel .mantine-Input-input,
  .signup-phone-panel .mantine-InputBase-input {
    text-align: center;
  }
`;

const LoginPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user, error } = useAppSelector((state) => state.session);
  const [isSignup, setIsSignup] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCountryCode, setPhoneCountryCode] = useState('');
  const [phoneLocalNumber, setPhoneLocalNumber] = useState('');
  const [countryOfCitizenship, setCountryOfCitizenship] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dateOfBirthError, setDateOfBirthError] = useState<string | null>(null);
  const [preferredPronouns, setPreferredPronouns] = useState('');
  const [customPronouns, setCustomPronouns] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactRelationship, setEmergencyContactRelationship] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [emergencyPhoneCountryCode, setEmergencyPhoneCountryCode] = useState('');
  const [emergencyPhoneLocalNumber, setEmergencyPhoneLocalNumber] = useState('');
  const [emergencyContactEmail, setEmergencyContactEmail] = useState('');
  const [arrivalDate, setArrivalDate] = useState('');
  const [arrivalDateError, setArrivalDateError] = useState<string | null>(null);
  const [departureDate, setDepartureDate] = useState('');
  const [departureDateError, setDepartureDateError] = useState<string | null>(null);
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
  const [signupUserType, setSignupUserType] = useState<'guide' | 'social_media'>('guide');
  const [badgeName, setBadgeName] = useState('');
  const [badgePrefixEmoji, setBadgePrefixEmoji] = useState('');
  const [badgeSuffixEmoji, setBadgeSuffixEmoji] = useState('');
  const [badgeEmojiPickerOpen, setBadgeEmojiPickerOpen] = useState<'prefix' | 'suffix' | null>(null);
  const [badgeNameTouched, setBadgeNameTouched] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [reviewedSignupStepKeys, setReviewedSignupStepKeys] = useState<SignupStepKey[]>([]);
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
  const signupDraftHydratedRef = useRef(false);
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
    let cancelled = false;

    const restoreSignupDraft = async () => {
      try {
        const storedDraft = window.localStorage.getItem(SIGNUP_DRAFT_STORAGE_KEY);
        if (storedDraft) {
          const draft = JSON.parse(storedDraft) as Partial<SignupDraft>;
          if (cancelled) {
            return;
          }
          setIsSignup(Boolean(draft.isSignup));
          setActiveStep(
            Number.isInteger(draft.activeStep)
              ? Math.min(Math.max(Number(draft.activeStep), 0), SIGNUP_STEPS.length - 1)
              : 0,
          );
          setReviewedSignupStepKeys(
            Array.isArray(draft.reviewedSignupStepKeys)
              ? draft.reviewedSignupStepKeys.filter((key): key is SignupStepKey =>
                SIGNUP_STEPS.some((step) => step.key === key),
              )
              : [],
          );
          dispatch(setUserState(draft.user ?? ''));
          setPassword(draft.password ?? '');
          setConfirmPassword(draft.confirmPassword ?? '');
          setPasswordsMatch((draft.password ?? '') === (draft.confirmPassword ?? ''));
          setFirstName(draft.firstName ?? '');
          setLastName(draft.lastName ?? '');
          setEmail(draft.email ?? '');
          setPhone(draft.phone ?? '');
          setPhoneCountryCode(draft.phoneCountryCode ?? '');
          setPhoneLocalNumber(draft.phoneLocalNumber ?? '');
          setCountryOfCitizenship(draft.countryOfCitizenship ?? '');
          setDateOfBirth(normalizeDateInput(draft.dateOfBirth ?? ''));
          setPreferredPronouns(draft.preferredPronouns ?? '');
          setCustomPronouns(draft.customPronouns ?? '');
          setEmergencyContactName(draft.emergencyContactName ?? '');
          setEmergencyContactRelationship(draft.emergencyContactRelationship ?? '');
          setEmergencyContactPhone(draft.emergencyContactPhone ?? '');
          setEmergencyPhoneCountryCode(draft.emergencyPhoneCountryCode ?? '');
          setEmergencyPhoneLocalNumber(draft.emergencyPhoneLocalNumber ?? '');
          setEmergencyContactEmail(draft.emergencyContactEmail ?? '');
          setArrivalDate(normalizeDateInput(draft.arrivalDate ?? ''));
          setDepartureDate(normalizeDateInput(draft.departureDate ?? ''));
          setDietaryRestrictions(draft.dietaryRestrictions ?? '');
          setAllergies(draft.allergies ?? '');
          setMedicalNotes(draft.medicalNotes ?? '');
          setWhatsappHandle(draft.whatsappHandle ?? '');
          setUseSameWhatsappNumber(draft.useSameWhatsappNumber ?? true);
          setWhatsappCountryCode(draft.whatsappCountryCode ?? DEFAULT_PHONE_CODE);
          setWhatsappLocalNumber(draft.whatsappLocalNumber ?? '');
          setFacebookProfileUrl(extractSocialUsername(draft.facebookProfileUrl ?? ''));
          setInstagramProfileUrl(extractSocialUsername(draft.instagramProfileUrl ?? ''));
          setDiscoverySource(draft.discoverySource ?? '');
          setSignupUserType(draft.signupUserType ?? 'guide');
          setBadgeName(draft.badgeName ?? '');
          setBadgePrefixEmoji(draft.badgePrefixEmoji ?? '');
          setBadgeSuffixEmoji(draft.badgeSuffixEmoji ?? '');
          setBadgeNameTouched(Boolean(draft.badgeNameTouched));
          setStaffType(draft.staffType ?? 'volunteer');
          setLivesInAccom(draft.livesInAccom ?? true);
          setSelectedShiftRoles(Array.isArray(draft.selectedShiftRoles) ? draft.selectedShiftRoles : []);
        }

        const savedPhoto = await loadSignupDraftPhoto();
        if (!cancelled && savedPhoto) {
          setProfilePhotoFile(savedPhoto);
          setProfilePhotoPreview(URL.createObjectURL(savedPhoto));
          setProfilePhotoError(null);
        }
      } catch (err) {
        console.warn('Unable to restore signup draft', err);
      } finally {
        signupDraftHydratedRef.current = true;
      }
    };

    void restoreSignupDraft();

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  useEffect(() => {
    if (!signupDraftHydratedRef.current || !isSignup) {
      return;
    }

    const draft: SignupDraft = {
      isSignup,
      activeStep,
      reviewedSignupStepKeys,
      user,
      password,
      confirmPassword,
      firstName,
      lastName,
      email,
      phone,
      phoneCountryCode,
      phoneLocalNumber,
      countryOfCitizenship,
      dateOfBirth,
      preferredPronouns,
      customPronouns,
      emergencyContactName,
      emergencyContactRelationship,
      emergencyContactPhone,
      emergencyPhoneCountryCode,
      emergencyPhoneLocalNumber,
      emergencyContactEmail,
      arrivalDate,
      departureDate,
      dietaryRestrictions,
      allergies,
      medicalNotes,
      whatsappHandle,
      useSameWhatsappNumber,
      whatsappCountryCode,
      whatsappLocalNumber,
      facebookProfileUrl,
      instagramProfileUrl,
      discoverySource,
      signupUserType,
      badgeName,
      badgePrefixEmoji,
      badgeSuffixEmoji,
      badgeNameTouched,
      staffType,
      livesInAccom,
      selectedShiftRoles,
    };

    try {
      window.localStorage.setItem(SIGNUP_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch (err) {
      console.warn('Unable to save signup draft', err);
    }
  }, [
    activeStep,
    allergies,
    arrivalDate,
    badgeName,
    badgeNameTouched,
    badgePrefixEmoji,
    badgeSuffixEmoji,
    countryOfCitizenship,
    confirmPassword,
    customPronouns,
    dateOfBirth,
    departureDate,
    dietaryRestrictions,
    discoverySource,
    email,
    emergencyContactEmail,
    emergencyContactName,
    emergencyContactPhone,
    emergencyContactRelationship,
    emergencyPhoneCountryCode,
    emergencyPhoneLocalNumber,
    facebookProfileUrl,
    firstName,
    instagramProfileUrl,
    isSignup,
    lastName,
    livesInAccom,
    medicalNotes,
    phone,
    phoneCountryCode,
    phoneLocalNumber,
    password,
    preferredPronouns,
    reviewedSignupStepKeys,
    selectedShiftRoles,
    signupUserType,
    staffType,
    useSameWhatsappNumber,
    user,
    whatsappCountryCode,
    whatsappHandle,
    whatsappLocalNumber,
  ]);

  useEffect(() => {
    if (!signupDraftHydratedRef.current || !isSignup) {
      return;
    }
    if (profilePhotoFile) {
      void saveSignupDraftPhoto(profilePhotoFile);
      return;
    }
    void clearSignupDraftPhoto();
  }, [isSignup, profilePhotoFile]);

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
  useEffect(() => {
    if (!badgeNameTouched) {
      setBadgeName(firstName.trim());
    }
  }, [badgeNameTouched, firstName]);

  const rules = [
    { regex: /(?=.*[0-9])/, description: 'At least one digit' },
    { regex: /(?=.*[a-z])/, description: 'At least one lowercase letter' },
    { regex: /(?=.*[A-Z])/, description: 'At least one uppercase letter' },
    { regex: /(?=.*[*.!@$%^&(){}[\]:;<>,.?/~_+-=|\\])/, description: 'At least one special character' },
    { regex: /.{8,32}/, description: 'Must be 8-32 characters long' },
  ];

  const PasswordRule: React.FC<{ rule: { regex: RegExp; description: string }; isValid: boolean }> = ({ rule, isValid }) => (
    <Group
      gap={6}
      wrap="nowrap"
      style={{
        border: `1px solid ${isValid ? '#b7ebc6' : '#f1c5c5'}`,
        background: isValid ? '#f0fff4' : '#fff5f5',
        borderRadius: 999,
        padding: '6px 10px',
      }}
    >
      {isValid ? <IconCheck color="#12b886" size={15} /> : <IconX color="#fa5252" size={15} />}
      <Text component="span" size="xs" fw={700} c={isValid ? 'green.7' : 'red.7'} lh={1.1}>
        {rule.description}
      </Text>
    </Group>
  );

  const handleToggleMode = () => {
    setIsSignup(!isSignup);
    setActiveStep(0);
    dispatch(clearSessionError());
    setStaffType('volunteer');
    setLivesInAccom(true);
    setSelectedShiftRoles([]);
    setReviewedSignupStepKeys([]);
    setEmail('');
    setEmailError(null);
    setFirstName('');
    setLastName('');
    setPhone('');
    setPhoneLocalNumber('');
    setPhoneCountryCode('');
    setPhoneError(null);
    setCountryOfCitizenship('');
    setDateOfBirth('');
    setDateOfBirthError(null);
    setPreferredPronouns('');
    setCustomPronouns('');
    setEmergencyContactName('');
    setEmergencyContactRelationship('');
    setEmergencyContactPhone('');
    setEmergencyPhoneLocalNumber('');
    setEmergencyPhoneCountryCode('');
    setEmergencyPhoneError(null);
    setEmergencyContactEmail('');
    setEmergencyEmailError(null);
    setArrivalDate('');
    setArrivalDateError(null);
    setDepartureDate('');
    setDepartureDateError(null);
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
    setSignupUserType('guide');
    setBadgeName('');
    setBadgePrefixEmoji('');
    setBadgeSuffixEmoji('');
    setBadgeNameTouched(false);
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
      setProfilePhotoError('Profile photo is required');
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
    setProfilePhotoError('Profile photo is required');
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
      const sessionPayload = await dispatch(fetchSession()).unwrap();
      const roleSlug = String(sessionPayload?.[0]?.roleSlug ?? '').trim().toLowerCase();
      navigate(roleSlug === 'affiliate' ? '/affiliates' : '/', { replace: true });
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
        goToSignupStep(activeStep + 1);
      } else if (activeStepKey === 'profile' && !profilePhotoFile) {
        setProfilePhotoError('Profile photo is required');
      } else if (activeStepKey === 'profile') {
        setDateOfBirthError(validateRequiredDate(dateOfBirth, 'Date of birth'));
      }
      return;
    }
    const birthDateError = validateRequiredDate(dateOfBirth, 'Date of birth');
    if (birthDateError) {
      setDateOfBirthError(birthDateError);
      goToStep(0);
      return;
    }
    if (!profilePhotoFile) {
      setProfilePhotoError('Profile photo is required');
      goToStep(0);
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
      appendField('signupUserType', signupUserType);
      appendField('staffType', staffType);
      appendField('livesInAccom', livesInAccom);
      appendField('shiftRoleIds', JSON.stringify(numericRoleIds));
      appendField('phone', normalizePhoneNumber(phone));
      appendField('countryOfCitizenship', normalizedCountry);
      appendField('dateOfBirth', parseDateForSubmit(dateOfBirth));
      appendField('preferredPronouns', normalizedPronouns);
      appendField('emergencyContactName', sanitize(emergencyContactName));
      appendField('emergencyContactRelationship', sanitize(emergencyContactRelationship));
      appendField('emergencyContactPhone', normalizePhoneNumber(emergencyContactPhone));
      appendField('emergencyContactEmail', sanitize(emergencyContactEmail));
      appendField('arrivalDate', parseDateForSubmit(arrivalDate));
      appendField('departureDate', parseDateForSubmit(departureDate));
      appendField('dietaryRestrictions', sanitize(dietaryRestrictions));
      appendField('allergies', sanitize(allergies));
      appendField('medicalNotes', sanitize(medicalNotes));
      appendField('whatsappHandle', normalizePhoneNumber(whatsappHandle));
      appendField('facebookProfileUrl', buildSocialProfileUrl('facebook', facebookProfileUrl));
      appendField('instagramProfileUrl', buildSocialProfileUrl('instagram', instagramProfileUrl));
      appendField('discoverySource', sanitize(discoverySource));
      appendField('badgeName', sanitize(badgeName) ?? sanitize(firstName));
      appendField('badgePrefixEmoji', sanitize(badgePrefixEmoji));
      appendField('badgeSuffixEmoji', sanitize(badgeSuffixEmoji));

      if (profilePhotoFile) {
        formPayload.append('profilePhoto', profilePhotoFile);
      }

      await dispatch(createUser(formPayload)).unwrap();
      window.localStorage.removeItem(SIGNUP_DRAFT_STORAGE_KEY);
      void clearSignupDraftPhoto();
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
    if (phoneCountryCode.trim().length === 0) {
      setPhoneError('Country code is required');
      return;
    }
    setPhoneError(isPhoneNumberValid(full) ? null : 'Enter a valid phone number');
  };

  const handlePhoneCodeChange = (code: string) => {
    setPhoneCountryCode(code);
    const full = buildPhoneFromParts(code, phoneLocalNumber);
    setPhone(full);
    if (code.trim().length === 0) {
      setPhoneError('Country code is required');
      return;
    }
    if (phoneLocalNumber.trim().length > 0) {
      setPhoneError(isPhoneNumberValid(full) ? null : 'Enter a valid phone number');
    } else if (phoneError === 'Country code is required') {
      setPhoneError(null);
    }
  };

  const handlePhoneBlur = () => {
    if (phoneCountryCode.trim().length === 0) {
      setPhoneError('Country code is required');
    } else if (phoneLocalNumber.trim().length === 0) {
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
    if (emergencyPhoneCountryCode.trim().length === 0) {
      setEmergencyPhoneError('Emergency country code is required');
      return;
    }
    setEmergencyPhoneError(isPhoneNumberValid(full) ? null : 'Enter a valid phone number');
  };

  const handleEmergencyPhoneCodeChange = (code: string) => {
    setEmergencyPhoneCountryCode(code);
    const full = buildPhoneFromParts(code, emergencyPhoneLocalNumber);
    setEmergencyContactPhone(full);
    if (code.trim().length === 0) {
      setEmergencyPhoneError('Emergency country code is required');
      return;
    }
    if (emergencyPhoneLocalNumber.trim().length > 0) {
      setEmergencyPhoneError(isPhoneNumberValid(full) ? null : 'Enter a valid phone number');
    } else if (emergencyPhoneError === 'Emergency country code is required') {
      setEmergencyPhoneError(null);
    }
  };

  const handleEmergencyPhoneBlur = () => {
    if (emergencyPhoneCountryCode.trim().length === 0) {
      setEmergencyPhoneError('Emergency country code is required');
    } else if (emergencyPhoneLocalNumber.trim().length === 0) {
      setEmergencyPhoneError('Emergency phone is required');
    } else if (!isPhoneNumberValid(emergencyContactPhone)) {
      setEmergencyPhoneError('Enter a valid phone number');
    }
  };

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
    if (parts.code.trim().length === 0) {
      setWhatsappHandle('');
      setWhatsappPhoneError('WhatsApp country code is required');
    } else if (parts.digits.length === 0) {
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
    if (code.trim().length === 0) {
      setWhatsappPhoneError('WhatsApp country code is required');
      return;
    }
    if (whatsappLocalNumber.length === 0) {
      setWhatsappHandle('');
      setWhatsappPhoneError(null);
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
    if (whatsappCountryCode.trim().length === 0) {
      setWhatsappPhoneError('WhatsApp country code is required');
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
    if (whatsappCountryCode.trim().length === 0) {
      setWhatsappPhoneError('WhatsApp country code is required');
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


  const handleEmergencyEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setEmergencyContactEmail(value);
    if (value.trim().length === 0) {
      setEmergencyEmailError('Emergency email is required');
      return;
    }
    setEmergencyEmailError(EMAIL_REGEX.test(value.trim().toLowerCase()) ? null : 'Enter a valid email');
  };

  const handleEmergencyEmailBlur = () => {
    if (emergencyContactEmail.trim().length === 0) {
      setEmergencyEmailError('Emergency email is required');
    } else if (!EMAIL_REGEX.test(emergencyContactEmail.trim().toLowerCase())) {
      setEmergencyEmailError('Enter a valid email');
    }
  };

  const isPasswordValid = (value: string) => rules.every((rule) => rule.regex.test(value));

const sanitize = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

  const phoneCodeSelected = phoneCountryCode.trim().length > 0;
  const phoneIsValid = phoneCodeSelected && isPhoneNumberValid(phone);
  const countrySelected = countryOfCitizenship.trim().length > 0;
  const dateOfBirthValid = Boolean(parseDateForSubmit(dateOfBirth));
  const arrivalDateValid = Boolean(parseDateForSubmit(arrivalDate));
  const departureDateValid = Boolean(parseDateForSubmit(departureDate));
  const pronounValid =
    preferredPronouns.trim().length > 0 &&
    (preferredPronouns !== 'custom' || customPronouns.trim().length > 0);
  const emailIsValid = EMAIL_REGEX.test(email.trim().toLowerCase());
  const emergencyPhoneCodeSelected = emergencyPhoneCountryCode.trim().length > 0;
  const emergencyPhoneIsValid = emergencyPhoneCodeSelected && isPhoneNumberValid(emergencyContactPhone);
  const emergencyEmailIsValid =
    emergencyContactEmail.trim().length > 0 &&
    EMAIL_REGEX.test(emergencyContactEmail.trim().toLowerCase());
  const normalizedWhatsappHandle = normalizePhoneNumber(whatsappHandle);
  const whatsappCodeSelected = whatsappCountryCode.trim().length > 0;
  const whatsappLocalNumberEntered = whatsappLocalNumber.trim().length > 0;
  const whatsappIsValid = useSameWhatsappNumber
    ? phoneIsValid
    : whatsappCodeSelected && whatsappLocalNumberEntered && isPhoneNumberValid(normalizedWhatsappHandle);
  const badgeTemplateSrc =
    signupUserType === 'social_media' ? BADGE_MEDIA_TEMPLATE_SRC : BADGE_GUIDE_TEMPLATE_SRC;
  const badgeDisplayName = (badgeName.trim() || firstName.trim() || 'Your name').slice(0, 28);

  const signupRequirementsMet =
    passwordsMatch &&
    isPasswordValid(password) &&
    Boolean(profilePhotoFile) &&
    selectedShiftRoles.length > 0 &&
    emailIsValid &&
    phoneIsValid &&
    dateOfBirthValid &&
    countrySelected &&
    arrivalDateValid &&
    departureDateValid &&
    emergencyContactName.trim().length > 0 &&
    emergencyContactRelationship.trim().length > 0 &&
    emergencyPhoneCodeSelected &&
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
  const isSmallScreen = useMediaQuery('(max-width: 48em)');

  const getStepCompletion = (stepKey: SignupStepKey) => {
    const percentage = (checks: boolean[]) => Math.round((checks.filter(Boolean).length / checks.length) * 100);

    switch (stepKey) {
      case 'profile':
        return percentage([
          firstName.trim().length > 0,
          lastName.trim().length > 0,
          user.trim().length > 0,
          emailIsValid,
          phoneCodeSelected,
          phoneIsValid,
          Boolean(profilePhotoFile),
          countrySelected,
          dateOfBirthValid,
          pronounValid,
          isPasswordValid(password),
          confirmPassword.length > 0 && passwordsMatch,
        ]);
      case 'roles':
        return percentage([
          staffType.trim().length > 0,
          typeof livesInAccom === 'boolean',
          selectedShiftRoles.length > 0,
        ]);
      case 'stay':
        return percentage([
          discoverySource.trim().length > 0,
          arrivalDateValid,
          departureDateValid,
        ]);
      case 'emergency':
        return percentage([
          emergencyContactName.trim().length > 0,
          emergencyContactRelationship.trim().length > 0,
          emergencyPhoneCodeSelected,
          emergencyPhoneIsValid,
          emergencyEmailIsValid,
        ]);
      case 'health': {
        const optionalValues = [dietaryRestrictions, allergies, medicalNotes];
        const filledOptional = optionalValues.filter((value) => value.trim().length > 0).length;
        return filledOptional > 0 ? Math.round((filledOptional / optionalValues.length) * 100) : 100;
      }
      case 'connect':
        return percentage([whatsappIsValid]);
      case 'badge':
        return percentage([
          signupUserType.trim().length > 0,
          (badgeName.trim() || firstName.trim()).length > 0,
        ]);
      default:
        return 0;
    }
  };

  const rawStepCompletionByKey = SIGNUP_STEPS.reduce<Record<SignupStepKey, number>>((acc, step) => {
    acc[step.key] = getStepCompletion(step.key);
    return acc;
  }, {} as Record<SignupStepKey, number>);
  const stepCompletionByKey = SIGNUP_STEPS.reduce<Record<SignupStepKey, number>>((acc, step) => {
    const hasBeenReviewed = reviewedSignupStepKeys.includes(step.key);
    acc[step.key] = hasBeenReviewed || step.key === activeStepKey ? rawStepCompletionByKey[step.key] : 0;
    return acc;
  }, {} as Record<SignupStepKey, number>);
  const stepProgress = Math.round(
    SIGNUP_STEPS.reduce((sum, step) => sum + stepCompletionByKey[step.key], 0) / totalSignupSteps,
  );

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
          Boolean(profilePhotoFile) &&
          dateOfBirthValid &&
          countrySelected &&
          pronounValid
        );
      case 'badge':
        return true;
      case 'roles':
        return selectedShiftRoles.length > 0;
      case 'stay':
        return (
          arrivalDateValid &&
          departureDateValid &&
          discoverySource.trim().length > 0
        );
      case 'emergency':
        return (
          emergencyContactName.trim().length > 0 &&
          emergencyContactRelationship.trim().length > 0 &&
          emergencyPhoneIsValid &&
          emergencyEmailIsValid
        );
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

  const markSignupStepReviewed = (stepKey: SignupStepKey) => {
    setReviewedSignupStepKeys((current) => (current.includes(stepKey) ? current : [...current, stepKey]));
  };

  const canOpenSignupStep = (target: number) => {
    const stepKey = SIGNUP_STEPS[target]?.key;
    if (!stepKey) {
      return false;
    }
    return target <= activeStep || reviewedSignupStepKeys.includes(stepKey);
  };

  const goToSignupStep = (target: number) => {
    const clamped = Math.min(Math.max(target, 0), totalSignupSteps - 1);
    if (clamped !== activeStep) {
      markSignupStepReviewed(activeStepKey);
    }
    setActiveStep(clamped);
  };

  const handleNextStep = () => {
    if (activeStepKey === 'profile') {
      handlePhoneBlur();
      setDateOfBirthError(validateRequiredDate(dateOfBirth, 'Date of birth'));
      if (!profilePhotoFile) {
        setProfilePhotoError('Profile photo is required');
      }
    }
    if (activeStepKey === 'connect') {
      handleWhatsappBlur();
    }
    if (activeStepKey === 'stay') {
      setArrivalDateError(validateRequiredDate(arrivalDate, 'Arrival date'));
      setDepartureDateError(validateRequiredDate(departureDate, 'Departure date'));
    }
    if (activeStepKey === 'emergency') {
      handleEmergencyPhoneBlur();
      handleEmergencyEmailBlur();
    }
    if (activeStep < totalSignupSteps - 1 && canAdvanceFromStep(activeStep)) {
      goToSignupStep(activeStep + 1);
    }
  };

  const handlePreviousStep = () => {
    goToSignupStep(activeStep - 1);
  };

  const renderSignupStepHeader = (step: typeof SIGNUP_STEPS[number], index: number) => {
    const completion = stepCompletionByKey[step.key];
    const isActive = index === activeStep;
    const isComplete = completion === 100;

    return (
      <Group gap="sm" wrap="nowrap" align="center" style={{ width: '100%' }}>
        <ThemeIcon
          variant={isComplete ? 'light' : isActive ? 'filled' : 'light'}
          color={isComplete ? 'green' : 'blue'}
          radius="xl"
          size={34}
          style={{ flexShrink: 0 }}
        >
          {isComplete ? <IconCheck size={16} /> : index + 1}
        </ThemeIcon>
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text component="span" fw={900} lh={1.15}>
                {step.label}
              </Text>
              <Text component="span" size="xs" c="dimmed" lh={1.15}>
                {step.description}
              </Text>
            </Stack>
            <Text component="span" size="sm" fw={900} c={isComplete ? 'green.7' : 'blue.6'} style={{ flexShrink: 0 }}>
              {completion}%
            </Text>
          </Group>
          <Progress value={completion} size={6} radius="xl" color={isComplete ? 'green' : 'blue'} />
        </Stack>
      </Group>
    );
  };

  const renderSignupStepFrame = (children: React.ReactNode, stepKey: SignupStepKey) => {
    const stepContentMaxWidth = stepKey === 'profile' || stepKey === 'badge' ? 960 : 680;

    return (
      <Box
        style={{
          border: '1px solid #e4e9f2',
          background: '#fbfcff',
          borderRadius: 16,
          padding: isSmallScreen ? 14 : 20,
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Box style={{ width: '100%', maxWidth: stepContentMaxWidth, marginInline: 'auto' }}>
          <Box className="signup-section-body">{children}</Box>
        </Box>
      </Box>
    );
  };

  const renderBadgeEmojiField = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    pickerKey: 'prefix' | 'suffix',
  ) => (
    <Stack gap="sm" align="center">
      <TextInput
        label={label}
        placeholder="Optional"
        value={value}
        readOnly
        onClick={() => setBadgeEmojiPickerOpen(pickerKey)}
        rightSection={value ? (
          <Button
            type="button"
            variant="subtle"
            color="gray"
            radius="xl"
            size="compact-xs"
            onClick={(event) => {
              event.stopPropagation();
              onChange('');
            }}
            style={{ minWidth: 28, paddingInline: 0 }}
          >
            <IconX size={16} />
          </Button>
        ) : undefined}
        styles={{ input: { cursor: 'pointer', fontSize: isSmallScreen ? 28 : 24, textAlign: 'center' } }}
        style={{ width: '100%', cursor: 'pointer' }}
      />
      <Group gap="xs" justify="center" style={{ width: '100%' }}>
        <Modal
          opened={badgeEmojiPickerOpen === pickerKey}
          onClose={() => setBadgeEmojiPickerOpen(null)}
          title={label}
          fullScreen
          radius="md"
          styles={{
            title: { width: '100%', textAlign: 'center', fontWeight: 900 },
            header: { justifyContent: 'center' },
            body: {
              height: 'calc(100vh - 70px)',
              display: 'flex',
              alignItems: 'stretch',
              justifyContent: 'center',
              padding: isSmallScreen ? 8 : 20,
            },
            content: { background: '#f8fbff' },
          }}
        >
          <Box style={{ width: '100%', maxWidth: 760 }}>
            <EmojiPicker
              width="100%"
              height="100%"
              theme={EmojiPickerTheme.LIGHT}
              emojiStyle={EmojiStyle.NATIVE}
              lazyLoadEmojis
              previewConfig={{ showPreview: false }}
              searchPlaceholder="Search emojis"
              onEmojiClick={(emojiData: EmojiClickData) => {
                onChange(emojiData.emoji);
                setBadgeEmojiPickerOpen(null);
              }}
            />
          </Box>
        </Modal>
      </Group>
    </Stack>
  );

  const renderSignupStep = (stepKey: SignupStepKey) => {
    switch (stepKey) {
      case 'profile':
        return renderSignupStepFrame(
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
              <Stack
                className="signup-profile-card"
                gap="md"
                align="center"
                style={{
                  border: '1px solid #e4e9f2',
                  borderRadius: 14,
                  padding: isSmallScreen ? 18 : 24,
                  background: '#ffffff',
                  boxShadow: '0 10px 26px rgba(22, 31, 54, 0.05)',
                }}
              >
                <Stack gap={2} align="center" ta="center">
                  <Text fw={900} size="lg">Your details</Text>
                </Stack>
                <Grid gutter="md" style={{ width: '100%' }}>
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <TextInput
                      label="First name"
                      placeholder="First name"
                      value={firstName}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => setFirstName(event.target.value)}
                      required
                      style={{ width: '100%' }}
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <TextInput
                      label="Last name"
                      placeholder="Last name"
                      value={lastName}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => setLastName(event.target.value)}
                      required
                      style={{ width: '100%' }}
                    />
                  </Grid.Col>
                </Grid>
                <TextInput
                  label="Username"
                  placeholder="Pick a username"
                  value={user}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => dispatch(setUserState(event.target.value))}
                  leftSection={<IconUser />}
                  required
                  style={{ width: '100%' }}
                />
                <TextInput
                  label="Email"
                  placeholder="name@email.com"
                  value={email}
                  onChange={handleEmailChange}
                  onBlur={handleEmailBlur}
                  required
                  error={emailError ?? undefined}
                  style={{ width: '100%' }}
                />
              </Stack>

              <Stack
                className="signup-profile-card signup-photo-drop"
                gap="md"
                align="center"
                style={{
                  border: `1px solid ${profilePhotoError ? '#ffc9c9' : profilePhotoFile ? '#b7ebc6' : '#d7e6f8'}`,
                  borderRadius: 14,
                  padding: isSmallScreen ? 18 : 24,
                  background: profilePhotoFile ? '#f6fffb' : '#fbfdff',
                  alignSelf: 'stretch',
                  justifyContent: 'center',
                  minHeight: isSmallScreen ? undefined : 286,
                  boxShadow: '0 10px 26px rgba(22, 31, 54, 0.05)',
                }}
              >
                <Stack gap="xs" align="center" ta="center">
                  <Avatar
                    size={isSmallScreen ? 92 : 108}
                    radius="50%"
                    src={profilePhotoPreview ?? undefined}
                    style={{
                      border: '6px solid #ffffff',
                      boxShadow: '0 16px 34px rgba(22, 31, 54, 0.12)',
                    }}
                  >
                    {!profilePhotoPreview ? <IconUser size={38} /> : null}
                  </Avatar>
                  <Text fw={900} size="lg">Profile photo</Text>
                  <Text size="sm" c={profilePhotoError ? 'red.6' : 'dimmed'}>
                    {profilePhotoError ?? (profilePhotoFile ? 'That looks sexy!' : 'Required. Upload a cool photo.')}
                  </Text>
                </Stack>
                <FileInput
                  placeholder="Upload an image"
                  accept="image/*"
                  value={profilePhotoFile}
                  onChange={handleProfilePhotoChange}
                  clearable
                  required
                  style={{ width: '100%', maxWidth: 340 }}
                />
                {profilePhotoFile ? (
                  <Button variant="subtle" size="xs" color="gray" onClick={handleRemoveProfilePhoto}>
                    Remove photo
                  </Button>
                ) : null}
              </Stack>
            </SimpleGrid>

            <Stack
              className="signup-profile-card"
              gap="md"
              style={{
                border: '1px solid #e4e9f2',
                borderRadius: 14,
                padding: isSmallScreen ? 18 : 24,
                background: '#ffffff',
                boxShadow: '0 10px 26px rgba(22, 31, 54, 0.05)',
              }}
            >
              <Stack gap={2} align="center" ta="center">
                <Text fw={900} size="lg">Contact and identity</Text>
                <Text size="sm" c="dimmed">
                  Contact details and personal info managers need for onboarding.
                </Text>
              </Stack>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" style={{ width: '100%' }}>
                <Stack
                  className="signup-phone-panel"
                  gap="sm"
                  align="center"
                  style={{
                    border: '1px solid #edf1f7',
                    borderRadius: 12,
                    padding: isSmallScreen ? 14 : 16,
                    background: '#fbfdff',
                  }}
                >
                  <Stack gap={2} align="center" ta="center">
                    <Text fw={900} size="lg">Phone number</Text>
                    <Text size="sm" c="dimmed">
                      Choose the country code, then enter the local number.
                    </Text>
                  </Stack>
                  <Box
                    style={{
                      width: '100%',
                      maxWidth: 480,
                      border: '1px solid #d7deea',
                      borderRadius: 12,
                      background: '#ffffff',
                      padding: isSmallScreen ? 12 : 14,
                      boxShadow: '0 8px 20px rgba(22, 31, 54, 0.05)',
                    }}
                  >
                    <Stack gap="sm" style={{ width: '100%' }}>
                      <Box style={{ width: '100%' }}>
                        <PhoneCodeSelectField
                          label="Country code"
                          value={phoneCountryCode}
                          onChange={handlePhoneCodeChange}
                          placeholder="Select country code"
                          textAlign="center"
                          required
                        />
                      </Box>
                      <Box style={{ width: '100%' }}>
                        <TextInput
                          label="Phone number"
                          placeholder="600 000 000"
                          value={phoneLocalNumber}
                          onChange={handlePhoneInputChange}
                          onBlur={handlePhoneBlur}
                          type="tel"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          required
                          error={phoneError ?? undefined}
                        />
                      </Box>
                    </Stack>
                  </Box>
                </Stack>

                <Stack
                  gap="sm"
                  align="center"
                  style={{
                    border: '1px solid #edf1f7',
                    borderRadius: 12,
                    padding: isSmallScreen ? 14 : 16,
                    background: '#fbfdff',
                  }}
                >
                  <Text fw={800}>Identity</Text>
                  <Select
                    label="Where are you from?"
                    placeholder="Select country"
                    data={COUNTRY_OPTIONS}
                    searchable
                    nothingFoundMessage="No countries"
                    value={countryOfCitizenship || null}
                    onChange={(value) => setCountryOfCitizenship(value ?? '')}
                    required
                    styles={CENTERED_SELECT_STYLES}
                    style={{ width: '100%' }}
                  />
                  <DatePickerInput
                    label="Date of birth"
                    placeholder="dd/mm/yyyy"
                    value={parseDateInputToDate(dateOfBirth)}
                    onChange={(value) => {
                      const nextValue = formatDateFromPicker(value);
                      setDateOfBirth(nextValue);
                      setDateOfBirthError(nextValue.length === 0 ? 'Date of birth is required' : validateRequiredDate(nextValue, 'Date of birth'));
                    }}
                    onBlur={() => setDateOfBirthError(validateRequiredDate(dateOfBirth, 'Date of birth'))}
                    error={dateOfBirthError ?? undefined}
                    valueFormat="DD/MM/YYYY"
                    clearable={false}
                    required
                    style={{ width: '100%' }}
                  />
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
                    styles={CENTERED_SELECT_STYLES}
                    style={{ width: '100%' }}
                  />
                </Stack>
              </SimpleGrid>
              {preferredPronouns === 'custom' ? (
                <TextInput
                  label="Self-described pronouns"
                  placeholder="e.g. Ze / Zir"
                  value={customPronouns}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setCustomPronouns(event.target.value)}
                  required
                  style={{ width: '100%', maxWidth: 420, marginInline: 'auto' }}
                />
              ) : null}
            </Stack>

            <Stack
              gap="md"
              style={{
                border: '1px solid #e4e9f2',
                borderRadius: 14,
                padding: isSmallScreen ? 14 : 18,
                background: '#ffffff',
              }}
            >
              <Stack gap={2} align="center" ta="center">
                <Text fw={900}>Password</Text>
                <Text size="sm" c="dimmed">
                  Use a secure password so only you can access your account.
                </Text>
              </Stack>
              <PasswordInput
                label="Password"
                placeholder="Password"
                value={password}
                onChange={handlePasswordChange}
                leftSection={<IconLock />}
                required
              />
              <Group gap="xs" justify="center">
                {rules.map((rule) => (
                  <PasswordRule key={rule.description} rule={rule} isValid={rule.regex.test(password)} />
                ))}
              </Group>
              <PasswordInput
                label="Confirm password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={handleConfirmPasswordChange}
                leftSection={<IconLock />}
                required
                error={!passwordsMatch ? 'Passwords do not match' : undefined}
              />
            </Stack>
          </Stack>,
          'profile',
        );
      case 'badge':
        return renderSignupStepFrame(
          <Stack
            gap="md"
            align="center"
            style={{
              border: '1px solid #e4e9f2',
              borderRadius: 14,
              padding: isSmallScreen ? 14 : 18,
              background: '#ffffff',
            }}
          >
            <Stack gap={2} align="center" ta="center">
              <Text fw={900}>Badge Setup</Text>
            </Stack>
            <Select
              label="What position did you apply for?"
              placeholder="Choose one"
              data={[
                { value: 'guide', label: 'Guide' },
                { value: 'social_media', label: 'Social Media' },
              ]}
              value={signupUserType}
              onChange={(value) => setSignupUserType(value === 'social_media' ? 'social_media' : 'guide')}
              required
              styles={CENTERED_SELECT_STYLES}
              style={{ width: '100%', maxWidth: 520 }}
            />
            <TextInput
              label="Badge Name"
              placeholder="Name shown on the badge"
              value={badgeName}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setBadgeNameTouched(true);
                setBadgeName(event.target.value);
              }}
              description="Defaults to your first name unless you change it."
              style={{ width: '100%', maxWidth: 520 }}
            />
            <Grid gutter="xs" style={{ width: '100%', maxWidth: 520 }}>
              <Grid.Col span={6}>
                {renderBadgeEmojiField('Prefix Emoji', badgePrefixEmoji, setBadgePrefixEmoji, 'prefix')}
              </Grid.Col>
              <Grid.Col span={6}>
                {renderBadgeEmojiField('Suffix Emoji', badgeSuffixEmoji, setBadgeSuffixEmoji, 'suffix')}
              </Grid.Col>
            </Grid>
            <Box
              style={{
                width: '100%',
                maxWidth: isSmallScreen ? 360 : 430,
                marginInline: 'auto',
                marginTop: isSmallScreen ? 8 : 4,
              }}
            >
              <StaffBadgeFrontPreview
                templateSrc={badgeTemplateSrc}
                badgeName={badgeDisplayName}
                prefixEmoji={badgePrefixEmoji}
                suffixEmoji={badgeSuffixEmoji}
                placeholder="Your name"
                maxWidth="100%"
                ariaLabel="Badge front preview"
              />
            </Box>
          </Stack>,
          'badge',
        );
      case 'roles':
        return renderSignupStepFrame(
          <Stack gap="md">
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
              styles={CENTERED_SELECT_STYLES}
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
              styles={CENTERED_SELECT_STYLES}
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
              styles={CENTERED_MULTI_SELECT_STYLES}
            />
          </Stack>,
          'roles',
        );
      case 'stay':
        return renderSignupStepFrame(
          <Stack gap="md">
            <Select
              label="How did you hear about the experience?"
              placeholder="Select one"
              data={DISCOVERY_SOURCE_OPTIONS}
              value={discoverySource || null}
              onChange={(value) => setDiscoverySource(value ?? '')}
              required
              styles={CENTERED_SELECT_STYLES}
            />
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 6 }}>
                <DatePickerInput
                  label="Arrival date"
                  placeholder="dd/mm/yyyy"
                  value={parseDateInputToDate(arrivalDate)}
                  onChange={(value) => {
                    const nextValue = formatDateFromPicker(value);
                    setArrivalDate(nextValue);
                    setArrivalDateError(nextValue.length === 0 ? 'Arrival date is required' : validateRequiredDate(nextValue, 'Arrival date'));
                  }}
                  onBlur={() => setArrivalDateError(validateRequiredDate(arrivalDate, 'Arrival date'))}
                  error={arrivalDateError ?? undefined}
                  valueFormat="DD/MM/YYYY"
                  clearable={false}
                  required
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <DatePickerInput
                  label="Departure date"
                  placeholder="dd/mm/yyyy"
                  value={parseDateInputToDate(departureDate)}
                  onChange={(value) => {
                    const nextValue = formatDateFromPicker(value);
                    setDepartureDate(nextValue);
                    setDepartureDateError(nextValue.length === 0 ? 'Departure date is required' : validateRequiredDate(nextValue, 'Departure date'));
                  }}
                  onBlur={() => setDepartureDateError(validateRequiredDate(departureDate, 'Departure date'))}
                  error={departureDateError ?? undefined}
                  valueFormat="DD/MM/YYYY"
                  clearable={false}
                  required
                />
              </Grid.Col>
            </Grid>
          </Stack>,
          'stay',
        );
      case 'emergency':
        return renderSignupStepFrame(
          <Stack gap="md" align="center">
            <Stack
              className="signup-profile-card"
              gap="md"
              align="center"
              style={{
                border: '1px solid #e4e9f2',
                borderRadius: 14,
                padding: isSmallScreen ? 18 : 24,
                background: '#ffffff',
                boxShadow: '0 10px 26px rgba(22, 31, 54, 0.05)',
                width: '100%',
              }}
            >
              <Stack gap={2} align="center" ta="center">
                <Text fw={900} size="lg">Emergency contact</Text>
                <Text size="sm" c="dimmed">
                  Someone managers can contact if urgent support is needed.
                </Text>
              </Stack>
              <Grid gutter="md" style={{ width: '100%' }}>
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <TextInput
                    label="Full name"
                    placeholder="Emergency contact name"
                    value={emergencyContactName}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setEmergencyContactName(event.target.value)}
                    required
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <TextInput
                    label="Relationship"
                    placeholder="e.g. sibling, parent, partner"
                    value={emergencyContactRelationship}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setEmergencyContactRelationship(event.target.value)}
                    required
                  />
                </Grid.Col>
              </Grid>
              <TextInput
                label="Emergency email"
                placeholder="contact@email.com"
                value={emergencyContactEmail}
                onChange={handleEmergencyEmailChange}
                onBlur={handleEmergencyEmailBlur}
                type="email"
                error={emergencyEmailError ?? undefined}
                required
                style={{ width: '100%', maxWidth: 480 }}
              />
              <Box
                className="signup-phone-panel"
                style={{
                  width: '100%',
                  maxWidth: 480,
                  border: '1px solid #d7deea',
                  borderRadius: 12,
                  background: '#ffffff',
                  padding: isSmallScreen ? 12 : 14,
                  boxShadow: '0 8px 20px rgba(22, 31, 54, 0.05)',
                }}
              >
                <Stack gap="sm" style={{ width: '100%' }}>
                  <Box style={{ width: '100%' }}>
                    <PhoneCodeSelectField
                      label="Country code"
                      value={emergencyPhoneCountryCode}
                      onChange={handleEmergencyPhoneCodeChange}
                      placeholder="Select country code"
                      textAlign="center"
                      required
                    />
                  </Box>
                  <Box style={{ width: '100%' }}>
                    <TextInput
                      label="Phone number"
                      placeholder="600 000 000"
                      value={emergencyPhoneLocalNumber}
                      onChange={handleEmergencyPhoneChange}
                      onBlur={handleEmergencyPhoneBlur}
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      required
                      error={emergencyPhoneError ?? undefined}
                    />
                  </Box>
                </Stack>
              </Box>
            </Stack>
          </Stack>,
          'emergency',
        );
      case 'health':
        return renderSignupStepFrame(
          <Stack gap="md">
            <Textarea
              label="Dietary preferences or restrictions (Optional)"
              placeholder="Vegan, vegetarian, gluten-free, etc."
              value={dietaryRestrictions}
              onChange={(event) => setDietaryRestrictions(event.currentTarget.value)}
              autosize
              minRows={1}
            />
            <Textarea
              label="Allergies (Optional)"
              placeholder="List any allergies we should be aware of"
              value={allergies}
              onChange={(event) => setAllergies(event.currentTarget.value)}
              autosize
              minRows={1}
            />
            <Textarea
              label="Medical Notes (Optional)"
              placeholder="Optional information you'd like the team to know"
              value={medicalNotes}
              onChange={(event) => setMedicalNotes(event.currentTarget.value)}
              autosize
              minRows={1}
            />
          </Stack>,
          'health',
        );
      case 'connect':
      default:
        return renderSignupStepFrame(
          <Stack gap="md">
            <Stack
              gap="xs"
              style={{
                border: '1px solid #e4e9f2',
                borderRadius: 14,
                padding: 14,
                background: '#ffffff',
              }}
            >
              <Switch
                label="Use same number for WhatsApp"
                checked={useSameWhatsappNumber}
                onChange={(event) => handleWhatsappSameToggle(event.currentTarget.checked)}
              />
              {!useSameWhatsappNumber && (
                <Box
                  className="signup-phone-panel"
                  style={{
                    width: '100%',
                    maxWidth: 480,
                    border: '1px solid #d7deea',
                    borderRadius: 12,
                    background: '#ffffff',
                    padding: isSmallScreen ? 12 : 14,
                    marginInline: 'auto',
                    boxShadow: '0 8px 20px rgba(22, 31, 54, 0.05)',
                  }}
                >
                  <Stack gap="sm" style={{ width: '100%' }}>
                    <Box style={{ width: '100%' }}>
                      <PhoneCodeSelectField
                        label="WhatsApp code"
                        value={whatsappCountryCode}
                        onChange={handleWhatsappCountryCodeChange}
                        placeholder="+48"
                        textAlign="center"
                        required
                      />
                    </Box>
                    <Box style={{ width: '100%' }}>
                      <TextInput
                        label="WhatsApp number"
                        placeholder="600 000 000"
                        value={whatsappLocalNumber}
                        onChange={handleWhatsappLocalNumberChange}
                        onBlur={handleWhatsappBlur}
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        required
                        error={whatsappPhoneError ?? undefined}
                      />
                    </Box>
                  </Stack>
                </Box>
              )}
              <Text size="sm" c={whatsappPhoneError ? 'red.6' : 'dimmed'}>
                {useSameWhatsappNumber
                  ? 'We will reuse your primary phone number for WhatsApp updates.'
                  : whatsappPhoneError ?? null}
              </Text>
            </Stack>
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Facebook User"
                  placeholder="Username"
                  value={facebookProfileUrl}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setFacebookProfileUrl(event.target.value)}
                  onBlur={() => setFacebookProfileUrl(extractSocialUsername(facebookProfileUrl))}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Instagram User"
                  placeholder="Username"
                  value={instagramProfileUrl}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setInstagramProfileUrl(event.target.value)}
                  onBlur={() => setInstagramProfileUrl(extractSocialUsername(instagramProfileUrl))}
                />
              </Grid.Col>
            </Grid>
          </Stack>,
          'connect',
        );
    }
  };

  const renderSignupActions = (stepIndex: number) => {
    const sharedButtonProps = { fullWidth: true };
    const isStepFinal = stepIndex === totalSignupSteps - 1;

    const previousButton = (
      <Button
        type="button"
        variant="subtle"
        color="gray"
        radius="md"
        size="md"
        leftSection={<IconArrowLeft size={16} />}
        onClick={handlePreviousStep}
        disabled={stepIndex === 0 || loading}
        {...sharedButtonProps}
      >
        Previous
      </Button>
    );

    const nextOrSubmitButton = isStepFinal ? (
      <Button
        type="submit"
        disabled={signupSubmitDisabled}
        loading={loading}
        radius="md"
        size="md"
        rightSection={<IconCheck size={16} />}
        {...sharedButtonProps}
      >
        Create account
      </Button>
    ) : (
      <Button
        type="button"
        radius="md"
        size="md"
        rightSection={<IconArrowRight size={16} />}
        onClick={handleNextStep}
        disabled={!canAdvanceFromStep(stepIndex) || loading}
        {...sharedButtonProps}
      >
        Next
      </Button>
    );

    return isSmallScreen ? (
      <Stack gap="xs" mt="md">
        {nextOrSubmitButton}
        {previousButton}
      </Stack>
    ) : (
      <Group grow mt="sm" align="stretch">
        <Box>{previousButton}</Box>
        <Box>{nextOrSubmitButton}</Box>
      </Group>
    );
  };

  const renderSignupStepFooter = (stepKey: SignupStepKey, index: number) => (
    <Stack gap="sm" mt="md">
      {renderSignupActions(index)}
    </Stack>
  );

  const renderSignupSections = () => (
    <Accordion
      value={activeStepKey}
      onChange={(value) => {
        if (!value) {
          return;
        }
        const nextIndex = SIGNUP_STEPS.findIndex((step) => step.key === value);
        if (nextIndex >= 0 && canOpenSignupStep(nextIndex)) {
          goToSignupStep(nextIndex);
        }
      }}
      variant="separated"
      radius="md"
      styles={{
        root: { width: '100%' },
        item: {
          border: '1px solid #dfe6f1',
          background: '#ffffff',
          boxShadow: '0 8px 22px rgba(22, 31, 54, 0.05)',
        },
        control: {
          padding: isSmallScreen ? '12px 12px' : '14px 16px',
        },
        content: {
          padding: isSmallScreen ? '0 12px 14px' : '0 16px 16px',
        },
        chevron: {
          display: 'none',
        },
      }}
    >
      {SIGNUP_STEPS.map((step, index) => (
        <Accordion.Item key={step.key} value={step.key}>
          <Accordion.Control disabled={loading || !canOpenSignupStep(index)}>
            {renderSignupStepHeader(step, index)}
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              {renderSignupStep(step.key)}
              {index === activeStep ? renderSignupStepFooter(step.key, index) : null}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );

  return (
    <Box
      style={{
        minHeight: '100vh',
        width: '100%',
        background:
          'radial-gradient(circle at top left, rgba(34, 139, 230, 0.13), transparent 30%), linear-gradient(135deg, #f7f9fc 0%, #edf4ff 52%, #fff5f7 100%)',
        padding: isSmallScreen ? '12px 0 28px' : '36px 24px 52px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflowY: 'auto',
      }}
    >
      <style>{signupFlowCss}</style>
      <Container
        size={isSignup ? 'md' : 'xs'}
        px={isSmallScreen ? 0 : 'md'}
        style={{ width: '100%', paddingTop: isSmallScreen ? 0 : 24 }}
      >
        <Paper
          className={isSignup ? 'signup-flow' : undefined}
          radius={isSmallScreen ? 0 : 20}
          p={isSmallScreen ? 'md' : isSignup ? 28 : 'xl'}
          withBorder
          shadow="xl"
          style={{
            maxWidth: isSignup ? 880 : 460,
            margin: '0 auto',
            borderColor: '#e5eaf3',
            boxShadow: isSmallScreen ? 'none' : '0 24px 70px rgba(22, 31, 54, 0.14)',
          }}
        >
          <Stack gap="sm" align="center">
            <Avatar variant="light" radius="xl" size={isSmallScreen ? 48 : 62} color="blue">
              {isSignup ? (
                <IconSparkles size={isSmallScreen ? 22 : 30} />
              ) : (
                <IconUser size={isSmallScreen ? 22 : 30} />
              )}
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
                <Stack gap="lg">
                  <Stack gap="xs">
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Text size="sm" fw={800} c="#172033">
                        Overall completion
                      </Text>
                      <Text size="sm" fw={800} c="blue.6">
                        {stepProgress}% complete
                      </Text>
                    </Group>
                    <Progress value={stepProgress} size={10} radius="xl" color="blue" />
                  </Stack>
                  {renderSignupSections()}
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
              {!isSignup ? (
                <Button fullWidth mt="sm" type="submit" disabled={loginDisabled} loading={loading} size="md">
                  Sign in
                </Button>
              ) : null}
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
