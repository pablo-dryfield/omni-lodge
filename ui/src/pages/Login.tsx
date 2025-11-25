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
  Combobox,
  InputBase,
  ScrollArea,
  useCombobox,
} from '@mantine/core';
import { IconUser, IconLock, IconCheck, IconX, IconChevronDown } from '@tabler/icons-react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setUserState } from '../actions/sessionActions';
import { loginUser, createUser } from '../actions/userActions';
import { clearSessionError } from '../reducers/sessionReducer';
import { useShiftRoles } from '../api/shiftRoles';
import type { ShiftRole } from '../types/shiftRoles/ShiftRole';
import { useMediaQuery } from '@mantine/hooks';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_PHONE_CODE = '+48';
const PHONE_CODE_OPTIONS = [
  { value: '+1', label: '+1 · United States / Canada' },
  { value: '+20', label: '+20 · Egypt' },
  { value: '+27', label: '+27 · South Africa' },
  { value: '+30', label: '+30 · Greece' },
  { value: '+31', label: '+31 · Netherlands' },
  { value: '+32', label: '+32 · Belgium' },
  { value: '+33', label: '+33 · France' },
  { value: '+34', label: '+34 · Spain' },
  { value: '+36', label: '+36 · Hungary' },
  { value: '+39', label: '+39 · Italy' },
  { value: '+40', label: '+40 · Romania' },
  { value: '+41', label: '+41 · Switzerland' },
  { value: '+43', label: '+43 · Austria' },
  { value: '+44', label: '+44 · United Kingdom' },
  { value: '+45', label: '+45 · Denmark' },
  { value: '+46', label: '+46 · Sweden' },
  { value: '+47', label: '+47 · Norway' },
  { value: '+48', label: '+48 · Poland' },
  { value: '+49', label: '+49 · Germany' },
  { value: '+51', label: '+51 · Peru' },
  { value: '+52', label: '+52 · Mexico' },
  { value: '+53', label: '+53 · Cuba' },
  { value: '+54', label: '+54 · Argentina' },
  { value: '+55', label: '+55 · Brazil' },
  { value: '+56', label: '+56 · Chile' },
  { value: '+57', label: '+57 · Colombia' },
  { value: '+58', label: '+58 · Venezuela' },
  { value: '+60', label: '+60 · Malaysia' },
  { value: '+61', label: '+61 · Australia' },
  { value: '+62', label: '+62 · Indonesia' },
  { value: '+63', label: '+63 · Philippines' },
  { value: '+64', label: '+64 · New Zealand' },
  { value: '+65', label: '+65 · Singapore' },
  { value: '+66', label: '+66 · Thailand' },
  { value: '+81', label: '+81 · Japan' },
  { value: '+82', label: '+82 · South Korea' },
  { value: '+84', label: '+84 · Vietnam' },
  { value: '+86', label: '+86 · China' },
  { value: '+90', label: '+90 · Turkey' },
  { value: '+91', label: '+91 · India' },
  { value: '+92', label: '+92 · Pakistan' },
  { value: '+93', label: '+93 · Afghanistan' },
  { value: '+94', label: '+94 · Sri Lanka' },
  { value: '+95', label: '+95 · Myanmar' },
  { value: '+98', label: '+98 · Iran' },
  { value: '+212', label: '+212 · Morocco' },
  { value: '+213', label: '+213 · Algeria' },
  { value: '+216', label: '+216 · Tunisia' },
  { value: '+218', label: '+218 · Libya' },
  { value: '+254', label: '+254 · Kenya' },
  { value: '+255', label: '+255 · Tanzania' },
  { value: '+256', label: '+256 · Uganda' },
  { value: '+260', label: '+260 · Zambia' },
  { value: '+263', label: '+263 · Zimbabwe' },
  { value: '+351', label: '+351 · Portugal' },
  { value: '+352', label: '+352 · Luxembourg' },
  { value: '+353', label: '+353 · Ireland' },
  { value: '+354', label: '+354 · Iceland' },
  { value: '+355', label: '+355 · Albania' },
  { value: '+356', label: '+356 · Malta' },
  { value: '+357', label: '+357 · Cyprus' },
  { value: '+358', label: '+358 · Finland' },
  { value: '+380', label: '+380 · Ukraine' },
  { value: '+381', label: '+381 · Serbia' },
  { value: '+386', label: '+386 · Slovenia' },
  { value: '+420', label: '+420 · Czechia' },
  { value: '+421', label: '+421 · Slovakia' },
  { value: '+507', label: '+507 · Panama' },
  { value: '+509', label: '+509 · Haiti' },
  { value: '+593', label: '+593 · Ecuador' },
  { value: '+595', label: '+595 · Paraguay' },
  { value: '+598', label: '+598 · Uruguay' },
];
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
const PHONE_CODE_LOOKUP: Record<string, { value: string; label: string }> = PHONE_CODE_OPTIONS.reduce(
  (acc, option) => {
    acc[option.value] = option;
    return acc;
  },
  {} as Record<string, { value: string; label: string }>,
);

const PRONOUN_OPTIONS = [
  { value: 'She / Her', label: 'She / Her' },
  { value: 'He / Him', label: 'He / Him' },
  { value: 'They / Them', label: 'They / Them' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
  { value: 'custom', label: 'Self describe' },
];

const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

const SIGNUP_STEPS = [
  { key: 'profile', label: 'Profile', description: 'Contact & identity' },
  { key: 'roles', label: 'Roles', description: 'Staff type & shifts' },
  { key: 'stay', label: 'Stay', description: 'Arrival details' },
  { key: 'emergency', label: 'Emergency', description: 'Emergency contact' },
  { key: 'health', label: 'Health', description: 'Wellness notes' },
  { key: 'connect', label: 'Connect', description: 'Social & comms' },
] as const;

const PROFILE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

type PhoneCodeSelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

const PhoneCodeSelectField: React.FC<PhoneCodeSelectFieldProps> = ({ label, value, onChange, placeholder = 'Select code' }) => {
  const [search, setSearch] = useState('');
  const combobox = useCombobox({
    onDropdownClose: () => setSearch(''),
  });

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return PHONE_CODE_OPTIONS;
    }
    return PHONE_CODE_OPTIONS.filter((option) => {
      const normalized = option.label.toLowerCase();
      return normalized.includes(query) || option.value.replace('+', '').includes(query.replace('+', ''));
    });
  }, [search]);

  const selectedLabel = value ? PHONE_CODE_LOOKUP[value]?.label ?? value : null;

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    combobox.closeDropdown();
    setSearch('');
  };

  return (
    <Combobox store={combobox} onOptionSubmit={handleSelect} withinPortal>
      <Combobox.Target>
        <InputBase
          component="button"
          type="button"
          pointer
          onClick={() => combobox.toggleDropdown()}
          rightSection={<IconChevronDown size={16} />}
          rightSectionPointerEvents="none"
          label={label}
          styles={{ input: { textAlign: 'left' } }}
        >
          {selectedLabel ? (
            <Text size="sm" c="dark">
              {selectedLabel}
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              {placeholder}
            </Text>
          )}
        </InputBase>
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Search
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search by country or code"
          aria-label="Search country calling codes"
        />
        <ScrollArea h={220} scrollHideDelay={0}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <Combobox.Option value={option.value} key={option.value}>
                {option.label}
              </Combobox.Option>
            ))
          ) : (
            <Text size="sm" c="dimmed" px="sm" py="xs">
              No matches
            </Text>
          )}
        </ScrollArea>
      </Combobox.Dropdown>
    </Combobox>
  );
};

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

  const discoveryOptions = useMemo(
    () => [
      { value: 'worldpackers', label: 'Worldpackers' },
      { value: 'workaway', label: 'Workaway' },
      { value: 'referral', label: 'Friend referral' },
      { value: 'email', label: 'Email newsletter' },
      { value: 'social_media', label: 'Social media' },
      { value: 'search', label: 'Web search' },
      { value: 'returning', label: 'I am a returning volunteer' },
      { value: 'other', label: 'Other' },
    ],
    [],
  );

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
    setFacebookProfileUrl('');
    setInstagramProfileUrl('');
    setDiscoverySource('');
    setProfilePhotoError(null);
    setProfilePhotoFile(null);
    setProfilePhotoPreview(null);
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
      appendField('whatsappHandle', sanitize(whatsappHandle));
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

const isPhoneNumberValid = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('+')) {
    return false;
  }
  const digits = trimmed
    .slice(1)
    .replace(/\D/g, '')
    .trim();
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
};

const normalizePhoneNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('+')) {
    return trimmed;
  }
  const digits = trimmed
    .slice(1)
    .replace(/\D/g, '')
    .trim();
  return digits.length > 0 ? `+${digits}` : trimmed;
};

const buildPhoneFromParts = (code: string, digits: string) => {
  const cleanedDigits = digits.replace(/\D/g, '');
  if (code.trim().length === 0 || cleanedDigits.length === 0) {
    return '';
  }
  return `${code}${cleanedDigits}`;
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
              data={discoveryOptions}
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
            <TextInput
              label="WhatsApp or preferred messaging handle"
              placeholder="WhatsApp number or @handle"
              value={whatsappHandle}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setWhatsappHandle(event.target.value)}
            />
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
      </Container>
    </Box>
  );
};
export default LoginPage;
