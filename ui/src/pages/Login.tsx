import React, { ChangeEvent, useMemo, useState } from 'react';
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
} from '@mantine/core';
import { IconUser, IconLock, IconCheck, IconX } from '@tabler/icons-react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setUserState } from '../actions/sessionActions';
import { loginUser, createUser } from '../actions/userActions';
import { clearSessionError } from '../reducers/sessionReducer';
import { useShiftRoles } from '../api/shiftRoles';
import type { ShiftRole } from '../types/shiftRoles/ShiftRole';
import { useMediaQuery } from '@mantine/hooks';

const LoginPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const { user, error } = useAppSelector((state) => state.session);
  const [isSignup, setIsSignup] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [passwordsMatch, setPasswordsMatch] = useState(true);
  const [loading, setLoading] = useState(false);
  const [staffType, setStaffType] = useState<'volunteer' | 'long_term'>('volunteer');
  const [livesInAccom, setLivesInAccom] = useState(false);
  const [selectedShiftRoles, setSelectedShiftRoles] = useState<string[]>([]);
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
    dispatch(clearSessionError());
    setStaffType('volunteer');
    setLivesInAccom(false);
    setSelectedShiftRoles([]);
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
    setLoading(true);
    try {
      const numericRoleIds = selectedShiftRoles
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      await dispatch(
        createUser({
          email,
          password,
          username: user,
          firstName,
          lastName,
          staffType,
          livesInAccom,
          shiftRoleIds: numericRoleIds,
        }),
      ).unwrap();
      handleToggleMode();
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('Sign up failed:', err);
    } finally {
      setLoading(false);
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

  const isPasswordValid = (value: string) => rules.every((rule) => rule.regex.test(value));

  const disableSubmit =
    loading ||
    password === '' ||
    user === '' ||
    (isSignup && (!passwordsMatch || !isPasswordValid(password) || selectedShiftRoles.length === 0));

  const isSmallScreen = useMediaQuery('(max-width: 48em)');

  return (
    <Box
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f6f8ff 0%, #f0edff 45%, #ffeef7 100%)',
        padding: isSmallScreen ? '32px 16px' : '64px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Container size="sm" px="md">
        <Paper
          radius={isSmallScreen ? 16 : 24}
          p={isSmallScreen ? 'lg' : 'xl'}
          withBorder
          shadow="xl"
          style={{ maxWidth: 560, margin: '0 auto', borderColor: '#edf0ff' }}
        >
          <Stack gap="md" align="center">
            <Avatar variant="light" radius="xl" size={isSmallScreen ? 64 : 80} color="indigo.6">
              <IconUser size={isSmallScreen ? 28 : 36} />
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
              <TextInput
                label="Username"
                placeholder="Username"
                value={user}
                onChange={(event: ChangeEvent<HTMLInputElement>) => dispatch(setUserState(event.target.value))}
                leftSection={<IconUser />}
                required
              />
              {isSignup ? (
                <Stack gap="md">
                  <TextInput
                    label="Email"
                    placeholder="Email"
                    value={email}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
                    required
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
                  <Select
                    label="Staff Type"
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
                    label="Will you live in Volunteers accomodation?"
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
                    label="Shift Roles"
                    placeholder={shiftRolesQuery.isLoading ? 'Loading roles...' : 'Select shift roles'}
                    data={shiftRoleOptions}
                    value={selectedShiftRoles}
                    onChange={setSelectedShiftRoles}
                    searchable
                    disabled={shiftRolesQuery.isLoading || shiftRolesQuery.isError}
                    required
                    nothingFoundMessage={shiftRolesQuery.isLoading ? 'Loading...' : 'No roles'}
                  />
                </Stack>
              ) : null}

              <PasswordInput
                label="Password"
                placeholder="Password"
                value={password}
                onChange={handlePasswordChange}
                leftSection={<IconLock />}
                required
              />
              {isSignup
                ? rules.map((rule, index) => (
                    <PasswordRule key={rule.description} rule={rule} isValid={rule.regex.test(password)} />
                  ))
                : null}
              {isSignup ? (
                <PasswordInput
                  label="Confirm Password"
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={handleConfirmPasswordChange}
                  leftSection={<IconLock />}
                  required
                />
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
              <Button fullWidth mt="sm" type="submit" disabled={disableSubmit} loading={loading} size="md">
                {isSignup ? 'Create account' : 'Sign in'}
              </Button>
            </Stack>
          </form>

          <Button variant="link" onClick={handleToggleMode} mt="md" fullWidth>
            {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </Button>
        </Paper>
      </Container>
    </Box>
  );
};

export default LoginPage;
